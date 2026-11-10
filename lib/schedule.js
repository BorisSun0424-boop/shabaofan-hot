/**
 * Daily auto-intro scheduler helpers (Asia/Shanghai wall clock).
 * No LLM here — only time math + settings persistence.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";

export const DEFAULT_AUTO_INTRO = {
  enabled: true,
  hour: 9,
  minute: 0,
  limit: 10,
  concurrency: 2,
  sections: ["github_weekly", "product_hunt", "google_trends"],
  /** Max LLM retries per item within one batch. */
  retries: 1,
};

function settingsPath() {
  return join(resolveDshHome(), "storages", "dsh-trending-digest", "settings.json");
}

/** Shanghai calendar parts for a Date. */
export function shanghaiParts(date) {
  const d = date instanceof Date ? date : new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(d).map((p) => [p.type, p.value]),
  );
  return {
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/**
 * Milliseconds until the next Asia/Shanghai wall-clock (hour:minute).
 * If that time today has not passed, schedule today; else tomorrow.
 */
export function msUntilNextShanghai(hour, minute, now) {
  const h = Math.min(Math.max(Number(hour) || 0, 0), 23);
  const m = Math.min(Math.max(Number(minute) || 0, 0), 59);
  const current = now instanceof Date ? now : new Date();
  const parts = shanghaiParts(current);
  const [y, mo, da] = parts.ymd.split("-").map(Number);
  // Build "target today" as an absolute Instant via +08:00 offset.
  let target = new Date(
    `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+08:00`,
  );
  if (!(target.getTime() > current.getTime() + 1500)) {
    // Already passed (or within 1.5s) — next calendar day in Shanghai.
    const tomorrowParts = shanghaiParts(new Date(current.getTime() + 36 * 3600 * 1000));
    // Safer: add 24h to today's target
    target = new Date(target.getTime() + 24 * 3600 * 1000);
    // Correct for DST-less Shanghai; still verify ymd advanced
    void tomorrowParts;
  }
  return Math.max(target.getTime() - current.getTime(), 1000);
}

/** True if Shanghai local time is at/after the configured daily hour:minute. */
export function shanghaiPastDailyTime(hour, minute, now) {
  const parts = shanghaiParts(now);
  const h = Math.min(Math.max(Number(hour) || 0, 0), 23);
  const m = Math.min(Math.max(Number(minute) || 0, 0), 59);
  if (parts.hour > h) return true;
  if (parts.hour < h) return false;
  return parts.minute >= m;
}

export function normalizeAutoIntroSettings(raw) {
  const base = { ...DEFAULT_AUTO_INTRO };
  if (!raw || typeof raw !== "object") return base;
  if (typeof raw.enabled === "boolean") base.enabled = raw.enabled;
  if (Number.isFinite(Number(raw.hour))) {
    base.hour = Math.min(Math.max(Math.floor(Number(raw.hour)), 0), 23);
  }
  if (Number.isFinite(Number(raw.minute))) {
    base.minute = Math.min(Math.max(Math.floor(Number(raw.minute)), 0), 59);
  }
  if (Number.isFinite(Number(raw.limit))) {
    base.limit = Math.min(Math.max(Math.floor(Number(raw.limit)), 1), 25);
  }
  if (Number.isFinite(Number(raw.concurrency))) {
    base.concurrency = Math.min(Math.max(Math.floor(Number(raw.concurrency)), 1), 3);
  }
  if (Number.isFinite(Number(raw.retries))) {
    base.retries = Math.min(Math.max(Math.floor(Number(raw.retries)), 0), 2);
  }
  if (Array.isArray(raw.sections) && raw.sections.length) {
    const allowed = new Set(["github_weekly", "product_hunt", "google_trends"]);
    const next = raw.sections
      .map(String)
      .map((s) => (s === "github_daily" ? "github_weekly" : s))
      .filter((s) => allowed.has(s));
    // dedupe preserve order
    const seen = new Set();
    const deduped = [];
    for (const s of next) {
      if (seen.has(s)) continue;
      seen.add(s);
      deduped.push(s);
    }
    if (deduped.length) base.sections = deduped;
  }
  return base;
}

export class AutoIntroSettingsStore {
  constructor(logger) {
    this.logger = logger;
    this.path = settingsPath();
    this.settings = { ...DEFAULT_AUTO_INTRO };
    this.status = {
      running: false,
      lastRunYmd: "",
      lastStartedAt: "",
      lastFinishedAt: "",
      lastMessage: "",
      generated: 0,
      skipped: 0,
      failed: 0,
      nextRunAt: "",
    };
    this.loaded = false;
    this.loading = undefined;
    this.dirty = false;
    this.saveTimer = undefined;
    this.saving = Promise.resolve();
  }

  async load() {
    if (this.loaded) return;
    if (this.loading) return this.loading;
    this.loading = readFile(this.path, "utf8")
      .then((raw) => {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          if (parsed.autoIntro) {
            this.settings = normalizeAutoIntroSettings(parsed.autoIntro);
          }
          if (parsed.autoIntroStatus && typeof parsed.autoIntroStatus === "object") {
            this.status = {
              ...this.status,
              ...parsed.autoIntroStatus,
              running: false,
            };
          }
        }
        this.loaded = true;
      })
      .catch((error) => {
        if (error?.code !== "ENOENT") {
          this.logger?.warn?.(
            "dsh-trending-digest: settings read failed: %o",
            error,
          );
        }
        this.loaded = true;
      })
      .finally(() => {
        this.loading = undefined;
      });
    return this.loading;
  }

  snapshot() {
    return {
      settings: { ...this.settings, sections: [...this.settings.sections] },
      status: { ...this.status },
    };
  }

  /** Persist current settings/status even if unchanged (first boot / migration). */
  ensurePersisted() {
    this.dirty = true;
    this.touch();
    return this.snapshot();
  }

  updateSettings(patch) {
    this.settings = normalizeAutoIntroSettings({
      ...this.settings,
      ...(patch && typeof patch === "object" ? patch : {}),
    });
    this.dirty = true;
    this.touch();
    return this.snapshot();
  }

  patchStatus(partial) {
    this.status = { ...this.status, ...(partial || {}) };
    this.dirty = true;
    this.touch();
    return this.snapshot();
  }

  touch() {
    if (this.saveTimer !== undefined) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.flush().catch(() => {});
    }, 400);
    this.saveTimer.unref?.();
  }

  async flush() {
    if (!this.dirty) return;
    this.dirty = false;
    this.saving = this.saving.catch(() => {}).then(async () => {
      try {
        await mkdir(dirname(this.path), { recursive: true });
        const temp = `${this.path}.${process.pid}.tmp`;
        const body = {
          autoIntro: this.settings,
          autoIntroStatus: { ...this.status, running: false },
        };
        await writeFile(temp, JSON.stringify(body, null, 2), {
          encoding: "utf8",
          mode: 0o600,
        });
        await rename(temp, this.path);
      } catch (error) {
        this.dirty = true;
        throw error;
      }
    });
    return this.saving;
  }
}

/** Bounded-concurrency pool; never rejects the whole batch. */
export async function forEachWithPool(items, workers, worker) {
  const list = Array.isArray(items) ? items : [];
  let index = 0;
  const runners = Array.from(
    { length: Math.min(Math.max(Number(workers) || 1, 1), Math.max(list.length, 1)) },
    async () => {
      while (index < list.length) {
        const current = list[index];
        index += 1;
        try {
          await worker(current);
        } catch {
          // swallow — caller records failures inside worker
        }
      }
    },
  );
  await Promise.all(runners);
}

/**
 * Format a Date as Asia/Shanghai display string.
 * @param {Date | number | string} value
 */
export function formatShanghaiLabel(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const parts = shanghaiParts(d);
  return `${parts.ymd} ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}（北京时间）`;
}
