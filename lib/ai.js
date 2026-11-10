/**
 * Host LLM helpers — same pattern as qiaomu-rss-dsh (agentDefaultModel + llm.stream).
 * Generates sectioned Chinese project introductions with ## subheadings (entry-style reading).
 */
import { createSystemMessage, createUserMessage } from "@deepseek-ai/dsh-llm";

/** Bump when intro style/prompt changes so caches invalidate. */
export const INTRO_PROMPT_VERSION = "v3-sections-20261108";

export const INTRODUCE_PROMPT = `你是一名专门介绍 GitHub 开源项目、Product Hunt 产品和 Google Trend 话题的中文作者。根据用户提供的资料，写一篇能让读者真正理解「这是什么、能做什么 / 为什么在热」的中文介绍。

必须使用下面四个小标题（Markdown 二级标题，一字不改），每个小标题下写 1～3 个短段落，段与段之间空一行：

## 这是什么
用口语把项目讲清楚：它是什么、来自哪里（若资料有）、热度数字（涨星/总星/排名，有才写，没有不要编）。

## 解决什么问题
它针对什么麻烦或痛点，谁会真正需要它。

## 能做什么
用 2～4 个具体能力或用法展开（尽量点名资料里出现的功能；可写用户能感知的场景）。信息密度要高：有数字用数字，有功能点名功能。

## 适合谁
一两句话收束：最适合什么人、什么场景；可带一句亮点。不要口号口号堆砌。

硬性要求：
- 全文简体中文；四个小标题缺一不可，且必须是「## 标题」这种 Markdown 形式
- 小标题之外不要再写总标题、排名口号、emoji 装饰、编号列表或代码块
- 专有名词、仓库名、产品名可保留英文
- 严禁编造资料中没有的具体数字、价格、硬件型号、排名；资料不足就在已知信息上写清能力与场景
- 若资料几乎为空，只输出「（资料不足，暂无法生成详细介绍）」
- 只输出带小标题的介绍正文，不要前言、后语或「以下是介绍」之类套话`;

export function defaultSelection(ctx) {
  const service = ctx.get("agentDefaultModel");
  if (!service) {
    throw new Error("未找到默认模型服务，请先在设置中配置模型");
  }
  const selection = service.currentSelection();
  if (!selection?.provider || !selection?.model) {
    throw new Error("尚未选择默认模型，请先在设置中选择模型");
  }
  return selection;
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {string} systemPrompt
 * @param {string} userText
 * @param {AbortSignal | undefined} signal
 */
export async function complete(ctx, systemPrompt, userText, signal) {
  const { provider, model } = defaultSelection(ctx);
  const messages = [
    createSystemMessage(systemPrompt),
    createUserMessage({
      content: [{ type: "text", text: userText }],
      source: { kind: "user" },
    }),
  ];
  const stream = ctx.llm.stream({
    provider,
    model,
    messages,
    ...(signal ? { signal } : {}),
  });
  let text = "";
  let finished = false;
  for await (const chunk of stream) {
    if (signal?.aborted) throw new Error("生成已中止");
    if (chunk.type === "text-delta") text += chunk.text;
    else if (chunk.type === "block-end" && chunk.block?.type === "text" && text === "") {
      text = chunk.block.text;
    } else if (chunk.type === "finish") {
      finished = true;
      if (chunk.reason?.kind === "error") {
        throw new Error(
          `模型调用失败：${chunk.reason.failure?.message ?? "未知错误"}`,
        );
      }
      if (chunk.reason?.kind === "aborted") throw new Error("生成已中止");
      break;
    }
  }
  if (!finished && text === "") throw new Error("模型未返回内容");
  const cleaned = text
    .replace(/^```(?:markdown|text)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
  if (!cleaned) throw new Error("模型返回为空");
  return cleaned;
}

/** Heuristic: mostly CJK → treat as already Chinese. */
export function looksMostlyChinese(text) {
  const raw = String(text || "").trim();
  if (!raw) return true;
  const chars = [...raw].filter((ch) => /[^\s\d\p{P}\p{S}]/u.test(ch));
  if (!chars.length) return true;
  const cjk = chars.filter((ch) =>
    /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(ch),
  ).length;
  return cjk / chars.length >= 0.45;
}

/**
 * Best-effort README excerpt for richer intros.
 * Prefers GitHub API (raw media type); falls back to raw.githubusercontent.com.
 * @param {string} fullName owner/repo
 * @param {number} [maxChars]
 */
export async function fetchRepoReadmeExcerpt(fullName, maxChars) {
  const limit = Math.min(Math.max(Number(maxChars) || 4500, 800), 8000);
  const name = String(fullName || "")
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "");
  if (!name || !name.includes("/")) return "";
  const [owner, repoRaw] = name.split("/");
  const repo = String(repoRaw || "").replace(/\.git$/i, "");
  if (!owner || !repo) return "";

  const normalize = (raw) => {
    let text = String(raw || "").replace(/\r\n/g, "\n").trim();
    if (!text || text.length < 40) return "";
    if (/^\s*<!DOCTYPE|^<html/i.test(text)) return "";
    if (text.length > limit) {
      text = `${text.slice(0, limit)}\n…（README 已截断）`;
    }
    return text;
  };

  // 1) GitHub Contents API — most reliable when raw CDN is blocked
  try {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/readme`;
    const response = await fetch(apiUrl, {
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
      headers: {
        "User-Agent": "dsh-trending-digest/0.3.5 (+DeepSeek Harness plugin)",
        Accept: "application/vnd.github.raw+json",
      },
    });
    if (response.ok) {
      const text = normalize(await response.text());
      if (text) return text;
    }
  } catch {
    // fall through
  }

  // 2) Quick raw CDN attempts (short timeout; parallel race)
  const rawUrls = [
    `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/README.md`,
    `https://raw.githubusercontent.com/${owner}/${repo}/main/README.md`,
    `https://raw.githubusercontent.com/${owner}/${repo}/master/README.md`,
  ];
  const controllers = rawUrls.map((url) => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    const promise = fetch(url, {
      signal: ac.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "dsh-trending-digest/0.3.5 (+DeepSeek Harness plugin)",
        Accept: "text/plain, text/markdown, */*",
      },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const text = normalize(await response.text());
        if (!text) throw new Error("empty");
        return text;
      })
      .finally(() => clearTimeout(timer));
    return promise;
  });
  try {
    return await Promise.any(controllers);
  } catch {
    return "";
  }
}

/**
 * Build the factual packet fed to the model (also used as cache source).
 * @param {any} item
 * @param {string} [readme]
 */
export function buildIntroSourcePacket(item, readme) {
  const lines = [];
  lines.push(`项目名称：${item?.title || "（未命名）"}`);
  if (item?.rank) lines.push(`榜单名次：第 ${item.rank} 名`);
  if (item?.section) lines.push(`板块：${item.section}`);
  if (item?.heatLabel) lines.push(`热度：${item.heatLabel}`);
  if (item?.language) lines.push(`主要语言：${item.language}`);
  if (item?.kind) lines.push(`类型：${item.kind}`);
  if (item?.stars != null && Number(item.stars) > 0) {
    lines.push(`总星数：${Number(item.stars)}`);
  }
  if (item?.starsGained != null && Number(item.starsGained) > 0) {
    lines.push(`本期涨星：${Number(item.starsGained)}`);
  }
  if (item?.dateLabel) lines.push(`日期：${item.dateLabel}`);
  if (item?.geo) lines.push(`地区：${item.geo}`);
  if (item?.traffic) lines.push(`搜索热度：${item.traffic}`);
  if (Array.isArray(item?.newsTitles) && item.newsTitles.length) {
    lines.push(`相关报道：${item.newsTitles.slice(0, 4).join('；')}`);
  }
  if (item?.url) lines.push(`链接：${item.url}`);
  lines.push("");
  lines.push("原始简介：");
  lines.push(String(item?.description || "").trim() || "（无）");
  const excerpt = String(readme || "").trim();
  if (excerpt) {
    lines.push("");
    lines.push("README / 补充资料摘录（仅作事实依据，勿照抄英文长文）：");
    lines.push(excerpt);
  }
  lines.push("");
  lines.push(`提示词版本：${INTRO_PROMPT_VERSION}`);
  return lines.join("\n");
}

/**
 * Post-process model output: strip accidental wrappers, soft length guard.
 * @param {string} text
 */
export function polishIntro(text) {
  let out = String(text || "")
    .replace(/^```(?:markdown|text)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .replace(/^(?:以下是|介绍如下|口播稿[:：]?)\s*/i, "")
    .trim();
  // Soft cap ~1200 chars — sectioned intros with ## headings run longer
  if (out.length > 1200) {
    const cut = out.slice(0, 1160);
    const lastStop = Math.max(
      cut.lastIndexOf("。"),
      cut.lastIndexOf("！"),
      cut.lastIndexOf("？"),
      cut.lastIndexOf("\n"),
    );
    out = `${cut.slice(0, lastStop > 200 ? lastStop + 1 : 1160).trim()}…`;
  }
  return out;
}

/**
 * Generate a long Chinese introduction for a catalog item.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {any} item
 * @param {AbortSignal | undefined} signal
 * @param {{ readme?: string }} [opts]
 */
export async function introduceItem(ctx, item, signal, opts) {
  const readme =
    opts?.readme != null
      ? String(opts.readme)
      : item?.kind === "github"
        ? await fetchRepoReadmeExcerpt(item.title || "")
        : "";
  const packet = buildIntroSourcePacket(item, readme);
  const kind = String(item?.kind || "");
  const hasMeat =
    String(item?.description || "").trim().length > 0 ||
    String(readme || "").trim().length > 40 ||
    (kind === "google_trends" && String(item?.title || "").trim().length > 0);
  if (!hasMeat && !(Number(item?.stars) > 0) && !(Number(item?.starsGained) > 0)) {
    return {
      chinese: "（资料不足，暂无法生成详细介绍）",
      sourcePacket: packet,
      usedReadme: false,
    };
  }
  const raw = await complete(ctx, INTRODUCE_PROMPT, packet, signal);
  return {
    chinese: polishIntro(raw),
    sourcePacket: packet,
    usedReadme: Boolean(String(readme || "").trim()),
  };
}

/** @deprecated use introduceItem — kept name for older imports */
export async function translateDescription(ctx, item, signal) {
  const result = await introduceItem(ctx, item, signal);
  return result.chinese;
}

export function createInflightGuard() {
  const inflight = new Map();
  return function guard(token, run) {
    const existing = inflight.get(token);
    if (existing) return existing;
    const promise = Promise.resolve()
      .then(run)
      .finally(() => inflight.delete(token));
    inflight.set(token, promise);
    return promise;
  };
}
