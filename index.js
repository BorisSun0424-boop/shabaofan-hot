/**
 * dsh-trending-digest — DeepSeek Harness Cordis host plugin
 * Typert Remote namespace `trending` + agent tools + Chinese translation cache
 * + daily auto-intro (Asia/Shanghai).
 * Remote methods: see TRENDING_REMOTE_METHODS (must match client).
 */
import { TypertRemoteService, Remote } from "@deepseek-ai/dsh-typert-protocol";
import { defineTool } from "@deepseek-ai/dsh-tools";
import {
  SECTION_META,
  buildDigest,
  fetchCatalog,
} from "./lib/fetch.js";
import { TranslationCache, ImageCache, CACHE_SCHEMA_VERSION } from "./lib/cache.js";
import {
  buildIntroSourcePacket,
  createInflightGuard,
  fetchRepoReadmeExcerpt,
  introduceItem,
} from "./lib/ai.js";
import { resolveItemImage } from "./lib/images.js";
import {
  AutoIntroSettingsStore,
  forEachWithPool,
  formatShanghaiLabel,
  msUntilNextShanghai,
  shanghaiParts,
  shanghaiPastDailyTime,
} from "./lib/schedule.js";

function text(value) {
  return [{ type: "text", text: value }];
}

function normalizeSections(value) {
  if (value == null || value === "" || value === "all") return undefined;
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value;
  return undefined;
}

function clampLimit(value) {
  return Math.min(Math.max(Number(value) || 10, 1), 25);
}

function normalizeSection(value) {
  const key = String(value || "github_weekly");
  if (!SECTION_META[key]) throw new Error(`未知板块：${key}`);
  return key;
}

function makeScheduler(ctx) {
  if (typeof ctx.timeout === "function") {
    return function schedule(fn, ms) {
      return ctx.timeout(fn, ms);
    };
  }
  return function schedule(fn, ms) {
    const timer = setTimeout(fn, ms);
    timer.unref?.();
    return function cancel() {
      clearTimeout(timer);
    };
  };
}

var TrendingDigestService = class extends TypertRemoteService {
  static inject = ["tools", "llm", "agentDefaultModel", "timer"];

  constructor(ctx) {
    super(ctx, "trending");
    this.ctx = ctx;
    this.cache = new TranslationCache(ctx.logger);
    this.imageCache = new ImageCache(ctx.logger);
    this.settingsStore = new AutoIntroSettingsStore(ctx.logger);
    this.schedule = makeScheduler(ctx);
    this.cancelDaily = undefined;
    this.catchUpScheduled = false;
    this.ready = Promise.all([
      this.cache.load(),
      this.imageCache.load(),
      this.settingsStore.load(),
    ]).then(() => {
      // Drop entries from older intro schemas (prefix scan used to leak them).
      let pruned = 0;
      for (const key of [...this.cache.map.keys()]) {
        if (!key.includes(`#${CACHE_SCHEMA_VERSION}#`)) {
          this.cache.map.delete(key);
          pruned += 1;
        }
      }
      if (pruned) {
        this.cache.dirty = true;
        this.cache.touch();
        this.ctx.logger?.info?.(
          `dsh-trending-digest: pruned ${pruned} stale intro cache entries`,
        );
      }
      // Migrate away from removed github_daily section and persist settings.json.
      this.settingsStore.updateSettings({
        sections: this.settingsStore.snapshot().settings.sections,
      });
      this.settingsStore.ensurePersisted();
    });
    this.guard = createInflightGuard();
    this.imageGuard = createInflightGuard();
    this.batchGuard = createInflightGuard();
    /** @type {Map<string, any>} */
    this.itemIndex = new Map();
    this.registerTools(ctx);
    ctx.logger?.info?.(
      "dsh-trending-digest: service started (remote.trending + tools + translate + images + auto-intro)",
    );
    void this.ready.then(() => {
      this.bootAutoIntro();
    });
    ctx.effect(() => () => {
      if (typeof this.cancelDaily === "function") {
        try {
          this.cancelDaily();
        } catch {
          // ignore
        }
        this.cancelDaily = undefined;
      }
      void this.cache.flush().catch(() => {});
      void this.imageCache.flush().catch(() => {});
      void this.settingsStore.flush().catch(() => {});
    });
  }

  registerTools(ctx) {
    const digestTool = defineTool({
      name: "trending_digest",
      description:
        "获取 GitHub热榜 / Product Hunt趋势 / Google Trend 各前 N 名，返回排版好的中文日报正文。",
      parameters: {
        sections: {
          type: "string",
          description:
            "可选板块，逗号分隔：github_weekly（GitHub热榜）、product_hunt（Product Hunt趋势）、google_trends（Google Trend），或 all（默认全部）。",
        },
        limit: {
          type: "number",
          description: "每个板块条数（默认 10，最大 25）。",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => text(value),
      },
      execute: async (args) => {
        const body = args == null ? {} : args;
        const limit = clampLimit(body.limit);
        const sections = normalizeSections(body.sections);
        return await buildDigest({ sections, limit });
      },
    });

    const githubTool = defineTool({
      name: "trending_github",
      description:
        "仅拉取 GitHub热榜，返回中文列表正文。（GitHub 本日热榜已移除）",
      parameters: {
        period: {
          type: "string",
          description: "仅支持 weekly（本周）；传入其它值也会按本周处理。",
        },
        limit: {
          type: "number",
          description: "最多条数（默认 10，最大 25）。",
        },
      },
      output: {
        schema: { type: "string" },
        render: (_args, value) => text(value),
      },
      execute: async (args) => {
        const body = args == null ? {} : args;
        const limit = clampLimit(body.limit);
        return await buildDigest({ sections: ["github_weekly"], limit });
      },
    });

    ctx.tools.register(digestTool);
    ctx.tools.register(githubTool);
  }

  rememberItems(items) {
    for (const item of items) {
      this.itemIndex.set(item.id, item);
    }
  }

  hasReadyChinese(item) {
    const source = buildIntroSourcePacket(item, "");
    const hit = this.cache.get(item.id, source);
    if (hit?.chinese) return true;
    const prefix = `${item.id}#${CACHE_SCHEMA_VERSION}#`;
    for (const [key, value] of this.cache.map.entries()) {
      if (key.startsWith(prefix) && value?.chinese) return true;
    }
    return false;
  }

  attachChinese(item) {
    // Cache key uses the enriched intro packet (description + meta). README is
    // fetched only on generate, so lookup first with description-only packet.
    const source = buildIntroSourcePacket(item, "");
    const hit = this.cache.get(item.id, source);
    if (hit?.chinese) {
      return {
        ...item,
        chineseDescription: hit.chinese,
        chineseStatus: "ready",
        chineseCached: true,
        chineseUpdatedAt: hit.updatedAt || "",
      };
    }
    // Also accept entries hashed with a README-augmented packet under current schema:
    // scan by item id + schema prefix for any ready chinese (rare race / force rewrite).
    const prefix = `${item.id}#${CACHE_SCHEMA_VERSION}#`;
    for (const [key, value] of this.cache.map.entries()) {
      if (key.startsWith(prefix) && value?.chinese) {
        return {
          ...item,
          chineseDescription: value.chinese,
          chineseStatus: "ready",
          chineseCached: true,
          chineseUpdatedAt: value.updatedAt || "",
        };
      }
    }
    if (
      !String(item.description || "").trim() &&
      item.kind !== "github" &&
      item.kind !== "google_trends"
    ) {
      return {
        ...item,
        chineseDescription: "（无简介）",
        chineseStatus: "ready",
        chineseCached: false,
        chineseUpdatedAt: "",
      };
    }
    return {
      ...item,
      chineseDescription: "",
      chineseStatus: "missing",
      chineseCached: false,
      chineseUpdatedAt: "",
    };
  }

  attachImage(item) {
    const hit = this.imageCache.get(item.id);
    if (hit?.url) {
      return {
        ...item,
        imageUrl: hit.url,
        imageSource: hit.source || "",
        imageStatus: hit.status || "ready",
      };
    }
    if (hit && hit.status === "missing") {
      return {
        ...item,
        imageUrl: "",
        imageSource: "",
        imageStatus: "missing",
      };
    }
    return {
      ...item,
      imageUrl: item.imageUrl || "",
      imageSource: item.imageSource || "",
      imageStatus: item.imageStatus || "unknown",
    };
  }

  autoIntroNote() {
    const snap = this.settingsStore.snapshot();
    const s = snap.settings;
    const st = snap.status;
    if (!s.enabled) {
      return "每日自动生成中文介绍已关闭（可在顶栏打开）。";
    }
    if (st.running) {
      return `正在自动生成中文介绍… 已完成 ${st.generated}，跳过 ${st.skipped}，失败 ${st.failed}`;
    }
    const next = st.nextRunAt ? `下次约 ${st.nextRunAt}` : "";
    if (st.lastRunYmd) {
      return `每日自动介绍：北京时间 ${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")}；上次 ${st.lastRunYmd} 生成 ${st.generated}/跳过 ${st.skipped}/失败 ${st.failed}${next ? "；" + next : ""}`;
    }
    return `每日自动介绍：北京时间 ${String(s.hour).padStart(2, "0")}:${String(s.minute).padStart(2, "0")} 会先刷热榜再批量生成（可能耗额度；已有缓存会跳过）${next ? "；" + next : ""}`;
  }

  /** Compatibility: Markdown digest for tools / old clients. */
  async getDigest(request) {
    const body = request == null ? {} : request;
    const limit = clampLimit(body.limit);
    const sections = normalizeSections(body.sections);
    const markdown = await buildDigest({ sections, limit });
    return { markdown, limit, sections: sections ?? "all" };
  }

  /** Structured catalog for the reading panel. */
  async listItems(request) {
    await this.ready;
    const body = request == null ? {} : request;
    const section = normalizeSection(body.section);
    const limit = clampLimit(body.limit);
    const catalog = await fetchCatalog(section, limit);
    this.rememberItems(catalog.items);
    const items = catalog.items.map((item) => this.attachImage(this.attachChinese(item)));
    // Opening the panel after 09:00 can also kick a missed daily batch.
    this.maybeCatchUpSoon();
    return {
      section: catalog.section,
      sectionLabel: catalog.sectionLabel,
      fetchedAt: catalog.fetchedAt,
      timezoneLabel: catalog.timezoneLabel,
      quotaNote:
        "普通刷新只拉热榜，不消耗模型额度。打开条目时会自动生成中文介绍（调用已配置模型，可能计费）；命中缓存不再调用。每日定时批量生成仍可在顶栏开关。",
      autoIntroNote: this.autoIntroNote(),
      autoIntro: this.settingsStore.snapshot(),
      items,
    };
  }

  async getItem(request) {
    await this.ready;
    const body = request == null ? {} : request;
    const id = String(body.id || "");
    if (!id) throw new Error("缺少项目 id");
    let item = this.itemIndex.get(id);
    if (!item) {
      const section = id.split("::")[0];
      if (SECTION_META[section]) {
        const catalog = await fetchCatalog(section, 25);
        this.rememberItems(catalog.items);
        item = this.itemIndex.get(id);
      }
    }
    if (!item) throw new Error("未找到该项目，请先刷新列表");
    return this.attachImage(this.attachChinese(item));
  }

  /**
   * Chinese introduction — uses configured DSH model (may cost quota).
   * Called when the reading panel opens an item, on daily batch, or on regenerate.
   * Concurrent calls for the same id are deduped. Pass force to bypass cache.
   */
  async translateItem(request) {
    await this.ready;
    const body = request == null ? {} : request;
    const id = String(body.id || "");
    if (!id) throw new Error("缺少项目 id");
    const force = Boolean(body.force);
    let item = this.itemIndex.get(id);
    if (!item) {
      item = await this.getItem({ id });
      // getItem returns attachChinese shape — recover base fields
      item = this.itemIndex.get(id) || item;
    }

    const basePacket = buildIntroSourcePacket(item, "");
    if (!force) {
      const hit = this.cache.get(id, basePacket);
      if (hit?.chinese) {
        return {
          id,
          chineseDescription: hit.chinese,
          chineseStatus: "ready",
          chineseCached: true,
          usedModel: false,
          message: "已命中本地缓存，未调用模型",
        };
      }
      const prefix = `${id}#${CACHE_SCHEMA_VERSION}#`;
      for (const [key, value] of this.cache.map.entries()) {
        if (key.startsWith(prefix) && value?.chinese) {
          return {
            id,
            chineseDescription: value.chinese,
            chineseStatus: "ready",
            chineseCached: true,
            usedModel: false,
            message: "已命中本地缓存，未调用模型",
          };
        }
      }
    } else {
      this.cache.deleteByItemId(id);
    }

    if (
      !String(item.description || "").trim() &&
      item.kind !== "github" &&
      item.kind !== "google_trends"
    ) {
      return {
        id,
        chineseDescription: "（无简介）",
        chineseStatus: "ready",
        chineseCached: false,
        usedModel: false,
        message: "原文无简介",
      };
    }

    const token = force ? `${id}#force#${Date.now()}` : `${id}#intro`;
    return await this.guard(token, async () => {
      if (!force) {
        const again = this.cache.get(id, basePacket);
        if (again?.chinese) {
          return {
            id,
            chineseDescription: again.chinese,
            chineseStatus: "ready",
            chineseCached: true,
            usedModel: false,
            message: "已命中本地缓存，未调用模型",
          };
        }
      }
      try {
        let readme = "";
        if (item.kind === "github") {
          readme = await fetchRepoReadmeExcerpt(item.title || "");
        }
        const result = await introduceItem(this.ctx, item, undefined, { readme });
        const packet = result.sourcePacket || buildIntroSourcePacket(item, readme);
        this.cache.set(id, packet, result.chinese, item.title);
        // Also store under description-only packet so list attachChinese hits without README.
        this.cache.set(id, basePacket, result.chinese, item.title);
        await this.cache.flush();
        return {
          id,
          chineseDescription: result.chinese,
          chineseStatus: "ready",
          chineseCached: true,
          usedModel: true,
          message: result.usedReadme
            ? "已结合 README 摘录生成带小标题的详细中文介绍（可能消耗额度）"
            : "已用已配置模型生成带小标题的详细中文介绍（可能消耗额度）",
        };
      } catch (error) {
        const errText = String(error?.message || error);
        const modelHint = /未找到默认模型|尚未选择默认模型|模型服务/i.test(errText)
          ? "请先在 DeepSeek Harness 设置里配置并选择默认模型。"
          : "";
        return {
          id,
          chineseDescription: "",
          chineseStatus: "error",
          chineseCached: false,
          usedModel: true,
          message: modelHint
            ? `中文介绍暂未生成：${modelHint}`
            : "中文介绍暂未生成",
          error: errText,
        };
      }
    });
  }

  /**
   * Resolve / cache a preview image for one catalog item (on-demand).
   * Does not use the LLM. Pass force to bypass image cache.
   */
  async resolveImage(request) {
    await this.ready;
    const body = request == null ? {} : request;
    const id = String(body.id || "");
    if (!id) throw new Error("缺少项目 id");
    const force = Boolean(body.force);
    let item = this.itemIndex.get(id);
    if (!item) {
      await this.getItem({ id });
      item = this.itemIndex.get(id);
    }
    if (!item) throw new Error("未找到该项目，请先刷新列表");

    if (!force) {
      const hit = this.imageCache.get(id);
      if (hit?.url) {
        return {
          id,
          imageUrl: hit.url,
          imageSource: hit.source || "",
          imageStatus: "ready",
          cached: true,
          message: "已命中图片缓存",
        };
      }
      if (hit && hit.status === "missing") {
        return {
          id,
          imageUrl: "",
          imageSource: "",
          imageStatus: "missing",
          cached: true,
          message: "暂无项目预览图",
        };
      }
    }

    return await this.imageGuard(`${id}#image${force ? "#force" : ""}`, async () => {
      if (!force) {
        const again = this.imageCache.get(id);
        if (again?.url) {
          return {
            id,
            imageUrl: again.url,
            imageSource: again.source || "",
            imageStatus: "ready",
            cached: true,
            message: "已命中图片缓存",
          };
        }
      }
      try {
        const resolved = await resolveItemImage(item);
        if (resolved.url) {
          this.imageCache.set(id, resolved.url, resolved.source, "ready");
          await this.imageCache.flush();
          return {
            id,
            imageUrl: resolved.url,
            imageSource: resolved.source || "",
            imageStatus: "ready",
            cached: false,
            message:
              resolved.source === "readme"
                ? "已从 README 提取项目图片"
                : resolved.source === "og"
                  ? "已使用 GitHub 项目预览图"
                  : "已获取项目图片",
          };
        }
        this.imageCache.setMissing(id);
        await this.imageCache.flush();
        return {
          id,
          imageUrl: "",
          imageSource: "",
          imageStatus: "missing",
          cached: false,
          message: "暂无项目预览图",
        };
      } catch (error) {
        return {
          id,
          imageUrl: "",
          imageSource: "",
          imageStatus: "error",
          cached: false,
          message: "项目图片暂未加载",
          error: String(error?.message || error),
        };
      }
    });
  }

  async getAutoIntroStatus(request) {
    await this.ready;
    void request;
    return {
      ...this.settingsStore.snapshot(),
      note: this.autoIntroNote(),
    };
  }

  async setAutoIntroSettings(request) {
    await this.ready;
    const body = request == null ? {} : request;
    const patch = {};
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (body.hour != null) patch.hour = body.hour;
    if (body.minute != null) patch.minute = body.minute;
    if (body.limit != null) patch.limit = body.limit;
    if (body.concurrency != null) patch.concurrency = body.concurrency;
    const snap = this.settingsStore.updateSettings(patch);
    await this.settingsStore.flush();
    this.armDailyTimer();
    // If just enabled and today's batch not done past the hour, kick a catch-up soon.
    if (snap.settings.enabled) {
      this.maybeCatchUpSoon();
    }
    return {
      ...snap,
      note: this.autoIntroNote(),
    };
  }

  async runAutoIntroNow(request) {
    await this.ready;
    const body = request == null ? {} : request;
    const force = Boolean(body.force);
    const result = await this.runDailyBatch({ reason: "manual", force });
    return {
      ...result,
      ...this.settingsStore.snapshot(),
      note: this.autoIntroNote(),
    };
  }

  bootAutoIntro() {
    this.armDailyTimer();
    this.maybeCatchUpSoon();
  }

  maybeCatchUpSoon() {
    const snap = this.settingsStore.snapshot();
    if (!snap.settings.enabled) return;
    if (this.catchUpScheduled) return;
    if (snap.status.running) return;
    const today = shanghaiParts(new Date()).ymd;
    if (snap.status.lastRunYmd === today) return;
    if (!shanghaiPastDailyTime(snap.settings.hour, snap.settings.minute, new Date())) {
      return;
    }
    // App started after the daily hour and today's batch never finished — catch up once.
    this.catchUpScheduled = true;
    this.ctx.logger?.info?.(
      "dsh-trending-digest: scheduling catch-up auto-intro in 8s",
    );
    this.schedule(() => {
      void this.runDailyBatch({ reason: "catch-up" });
    }, 8000);
  }

  armDailyTimer() {
    if (typeof this.cancelDaily === "function") {
      try {
        this.cancelDaily();
      } catch {
        // ignore
      }
      this.cancelDaily = undefined;
    }
    const snap = this.settingsStore.snapshot();
    if (!snap.settings.enabled) {
      this.settingsStore.patchStatus({ nextRunAt: "" });
      return;
    }
    const delay = msUntilNextShanghai(snap.settings.hour, snap.settings.minute);
    const nextAt = formatShanghaiLabel(Date.now() + delay);
    this.settingsStore.patchStatus({ nextRunAt: nextAt });
    this.ctx.logger?.info?.(
      `dsh-trending-digest: next auto-intro in ${Math.round(delay / 1000)}s → ${nextAt}`,
    );
    this.cancelDaily = this.schedule(() => {
      void this.runDailyBatch({ reason: "scheduled" }).finally(() => {
        this.armDailyTimer();
      });
    }, delay);
  }

  async runDailyBatch(options) {
    const opts = options == null ? {} : options;
    const reason = String(opts.reason || "scheduled");
    const force = Boolean(opts.force);
    return await this.batchGuard("daily-auto-intro", async () => {
      await this.ready;
      const settings = this.settingsStore.snapshot().settings;
      // Manual force can run even if disabled; scheduled/catch-up respect the switch.
      if (!settings.enabled && reason !== "manual") {
        return {
          ok: false,
          message: "每日自动生成已关闭",
          generated: 0,
          skipped: 0,
          failed: 0,
        };
      }
      const today = shanghaiParts(new Date()).ymd;
      if (!force && reason !== "manual") {
        const prev = this.settingsStore.snapshot().status;
        if (prev.lastRunYmd === today && !prev.running) {
          // Already completed today — skip (manual can still re-run).
          return {
            ok: true,
            message: `今日（${today}）已自动生成过，跳过`,
            generated: prev.generated || 0,
            skipped: prev.skipped || 0,
            failed: prev.failed || 0,
          };
        }
      }

      const startedAt = new Date().toISOString();
      this.settingsStore.patchStatus({
        running: true,
        lastStartedAt: startedAt,
        lastMessage: `开始自动生成（${reason}）`,
        generated: 0,
        skipped: 0,
        failed: 0,
      });
      this.ctx.logger?.info?.(
        `dsh-trending-digest: auto-intro start (${reason}) sections=${settings.sections.join(",")}`,
      );

      let generated = 0;
      let skipped = 0;
      let failed = 0;
      const errors = [];

      try {
        /** @type {any[]} */
        const queue = [];
        for (const section of settings.sections) {
          try {
            const catalog = await fetchCatalog(section, settings.limit);
            this.rememberItems(catalog.items);
            for (const item of catalog.items) {
              queue.push(item);
            }
          } catch (error) {
            failed += 1;
            errors.push(`${section}: ${String(error?.message || error)}`);
            this.ctx.logger?.warn?.(
              "dsh-trending-digest: auto-intro catalog failed %s: %s",
              section,
              String(error?.message || error),
            );
          }
        }

        await forEachWithPool(queue, settings.concurrency, async (item) => {
          if (!force && this.hasReadyChinese(item)) {
            skipped += 1;
            this.settingsStore.patchStatus({
              generated,
              skipped,
              failed,
              lastMessage: `跳过已有介绍：${item.title || item.id}`,
            });
            return;
          }
          let attempt = 0;
          const maxAttempts = 1 + (settings.retries || 0);
          let lastError = "";
          while (attempt < maxAttempts) {
            attempt += 1;
            try {
              const result = await this.translateItem({
                id: item.id,
                force: force && attempt === 1 ? true : false,
              });
              if (result.chineseStatus === "ready") {
                if (result.usedModel) generated += 1;
                else skipped += 1;
                lastError = "";
                break;
              }
              lastError = result.error || result.message || "介绍未就绪";
            } catch (error) {
              lastError = String(error?.message || error);
            }
            if (attempt < maxAttempts) {
              await new Promise((r) => setTimeout(r, 800 * attempt));
            }
          }
          if (lastError) {
            failed += 1;
            errors.push(`${item.title || item.id}: ${lastError}`);
          }
          this.settingsStore.patchStatus({
            generated,
            skipped,
            failed,
            lastMessage: lastError
              ? `失败：${item.title || item.id}`
              : `进度 生成${generated}/跳过${skipped}/失败${failed}`,
          });
        });

        const finishedAt = new Date().toISOString();
        const sample = errors.slice(0, 2).join(" | ");
        const modelMissing = errors.some((e) =>
          /未找到默认模型|尚未选择默认模型|模型服务/i.test(e),
        );
        const nothingDone = generated === 0 && skipped === 0;
        // If model isn't configured, do NOT burn today's slot — allow catch-up/manual retry.
        const markDone = !(modelMissing && nothingDone && failed > 0);
        if (modelMissing && nothingDone) {
          this.catchUpScheduled = false;
        }
        const message = modelMissing && nothingDone
          ? `自动生成未执行：请先在 DeepSeek Harness 设置里配置并选择默认模型。${sample ? "（" + sample + "）" : ""}`
          : `完成：生成 ${generated}，跳过 ${skipped}，失败 ${failed}${
              errors.length ? `；样例 ${sample}` : ""
            }`;
        this.settingsStore.patchStatus({
          running: false,
          lastRunYmd: markDone ? today : "",
          lastFinishedAt: finishedAt,
          lastMessage: message,
          generated,
          skipped,
          failed,
        });
        await this.settingsStore.flush();
        await this.cache.flush();
        this.ctx.logger?.info?.(`dsh-trending-digest: auto-intro done — ${message}`);
        return {
          ok: true,
          message,
          generated,
          skipped,
          failed,
          errors: errors.slice(0, 8),
        };
      } catch (error) {
        const message = `自动生成中断：${String(error?.message || error)}`;
        this.settingsStore.patchStatus({
          running: false,
          lastFinishedAt: new Date().toISOString(),
          lastMessage: message,
          generated,
          skipped,
          failed,
        });
        await this.settingsStore.flush();
        this.ctx.logger?.warn?.("dsh-trending-digest: auto-intro failed: %s", message);
        return {
          ok: false,
          message,
          generated,
          skipped,
          failed,
        };
      }
    });
  }
}

/** Host Typert Remote methods for namespace `trending` (must match client TYPERT_REMOTE). */
var TRENDING_REMOTE_METHODS = [
  "getDigest",
  "listItems",
  "getItem",
  "translateItem",
  "resolveImage",
  "getAutoIntroStatus",
  "setAutoIntroSettings",
  "runAutoIntroNow",
];

{
  const prototype = TrendingDigestService.prototype;
  for (const methodName of TRENDING_REMOTE_METHODS) {
    if (typeof prototype[methodName] !== "function") {
      throw new Error(`dsh-trending-digest: missing Remote method ${methodName}`);
    }
    Remote(methodName)(prototype[methodName], {
      name: methodName,
      private: false,
      static: false,
      addInitializer(fn) {
        fn.call(Object.create(prototype));
      },
    });
  }
}

var index_default = TrendingDigestService;
export {
  TrendingDigestService,
  index_default as default
};
