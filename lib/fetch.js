/**
 * Fetch + format helpers for dsh-trending-digest.
 * No external deps — Node 22+ global fetch only.
 */

const GITSTOCK_DAILY =
  "https://gitstock.org/api/v1/github/trending?period=daily";
const GITSTOCK_WEEKLY =
  "https://gitstock.org/api/v1/github/trending?period=weekly";
const GITHUB_TRENDING_DAILY = "https://github.com/trending?since=daily";
const GITHUB_TRENDING_WEEKLY = "https://github.com/trending?since=weekly";
const PRODUCT_HUNT_FEED = "https://www.producthunt.com/feed";

const WEEKDAYS_CN = ["日", "一", "二", "三", "四", "五", "六"];
const MEDALS = ["🥇", "🥈", "🥉"];

const DEFAULT_UA =
  "dsh-trending-digest/0.3.8 (+https://github.com; DeepSeek Harness plugin)";

/**
 * @param {string} url
 * @param {{ timeoutMs?: number, accept?: string }} [opts]
 */
async function fetchText(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 20000;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
    headers: {
      "User-Agent": DEFAULT_UA,
      Accept: opts.accept ?? "*/*",
    },
  });
  if (!response.ok) {
    throw new Error(`请求失败（状态 ${response.status}）：${url}`);
  }
  return await response.text();
}

/**
 * @param {string} url
 * @param {{ timeoutMs?: number }} [opts]
 */
async function fetchJson(url, opts = {}) {
  const text = await fetchText(url, {
    ...opts,
    accept: "application/json",
  });
  return JSON.parse(text);
}

/** Compact numbers: 1234 → "1,234"; 10200 → "10.2k" */
export function formatCompact(n) {
  const num = Number(n) || 0;
  const abs = Math.abs(num);
  if (abs >= 10000) {
    const wan = num / 10000;
    const rounded = abs >= 100000 ? Math.round(wan) : Math.round(wan * 10) / 10;
    return `${rounded}万`;
  }
  return num.toLocaleString("zh-CN");
}

/** Clip description to ~88 Chinese/Latin characters */
export function clipDesc(text, max = 88) {
  const raw = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "（无简介）";
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max - 1)}…`;
}

function shanghaiParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value]),
  );
  // weekday short is Mon/Tue… map via getDay in Shanghai
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  const hm = `${parts.hour}:${parts.minute}`;
  // Compute weekday in Shanghai
  const asUtc = new Date(`${ymd}T12:00:00+08:00`);
  const weekday = WEEKDAYS_CN[asUtc.getUTCDay()];
  return { ymd, hm, weekday };
}

/**
 * Normalize gitstock item → common shape
 * @param {any} item
 */
function normalizeGitstock(item) {
  const owner = item.owner ?? "";
  const repo = item.repo ?? "";
  return {
    fullName: owner && repo ? `${owner}/${repo}` : String(item.full_name ?? ""),
    url:
      item.github_url ??
      (owner && repo ? `https://github.com/${owner}/${repo}` : ""),
    description: item.description ?? "",
    language: item.language ?? "",
    stars: Number(item.stars ?? 0),
    starsGained: Number(item.stars_gained ?? 0),
  };
}

/**
 * Very small HTML scrape of github.com/trending as fallback.
 * Relies on current article / h2 / span structure; best-effort only.
 * @param {string} html
 */
function parseGithubTrendingHtml(html) {
  const items = [];
  const articleRe =
    /<article[^>]*class="[^"]*Box-row[^"]*"[\s\S]*?<\/article>/gi;
  const articles = html.match(articleRe) ?? [];
  for (const block of articles) {
    const nameMatch = block.match(
      /href="\/([^"/]+)\/([^"/]+)"[^>]*>\s*[\s\S]*?<\/a>/i,
    );
    if (!nameMatch) continue;
    const owner = nameMatch[1];
    const repo = nameMatch[2];
    const descMatch = block.match(
      /<p[^>]*class="[^"]*col-9[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/p>/i,
    );
    const description = descMatch
      ? descMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
      : "";
    const langMatch = block.match(
      /itemprop="programmingLanguage"[\s\S]*?>([^<]+)</i,
    );
    const language = langMatch ? langMatch[1].trim() : "";
    const starsTotalMatch = block.match(
      /href="\/[^"]+\/stargazers"[\s\S]*?<\/svg>\s*([\d,]+)/i,
    );
    const stars = starsTotalMatch
      ? Number(starsTotalMatch[1].replace(/,/g, ""))
      : 0;
    const gainedMatch = block.match(
      /(\d[\d,]*)\s+stars?\s+today/i,
    ) || block.match(/(\d[\d,]*)\s+stars?\s+this\s+week/i);
    const starsGained = gainedMatch
      ? Number(gainedMatch[1].replace(/,/g, ""))
      : 0;
    items.push({
      fullName: `${owner}/${repo}`,
      url: `https://github.com/${owner}/${repo}`,
      description,
      language,
      stars,
      starsGained,
    });
  }
  return items;
}

/**
 * @param {'daily'|'weekly'} period
 * @param {number} limit
 */
export async function fetchGithubTrending(period, limit = 10) {
  const apiUrl = period === "weekly" ? GITSTOCK_WEEKLY : GITSTOCK_DAILY;
  try {
    const data = await fetchJson(apiUrl);
    const items = Array.isArray(data?.items) ? data.items : [];
    return items
      .map(normalizeGitstock)
      .filter((x) => x.fullName)
      .sort((a, b) => b.starsGained - a.starsGained)
      .slice(0, limit);
  } catch (apiErr) {
    const htmlUrl =
      period === "weekly" ? GITHUB_TRENDING_WEEKLY : GITHUB_TRENDING_DAILY;
    try {
      const html = await fetchText(htmlUrl, {
        accept: "text/html",
        timeoutMs: 25000,
      });
      return parseGithubTrendingHtml(html)
        .sort((a, b) => b.starsGained - a.starsGained)
        .slice(0, limit);
    } catch (htmlErr) {
      throw new Error(
        `GitHub热榜获取失败（接口：${apiErr.message}；网页：${htmlErr.message}）`,
      );
    }
  }
}

/**
 * Parse Product Hunt Atom feed with regex (no XML deps).
 * Rank by updated/published descending. No upvote counts in public feed.
 * @param {string} xml
 */
export function parseProductHuntAtom(xml) {
  const entries = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/gi;
  let m;
  while ((m = entryRe.exec(xml)) !== null) {
    const block = m[1];
    const title = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
    const link =
      block.match(
        /<link[^>]*rel="alternate"[^>]*href="([^"]+)"/i,
      )?.[1] ??
      block.match(/<link[^>]*href="([^"]+)"[^>]*rel="alternate"/i)?.[1] ??
      block.match(/<link[^>]*href="([^"]+)"/i)?.[1] ??
      "";
    const updated =
      block.match(/<updated>([^<]+)<\/updated>/i)?.[1] ??
      block.match(/<published>([^<]+)<\/published>/i)?.[1] ??
      "";
    const published =
      block.match(/<published>([^<]+)<\/published>/i)?.[1] ?? updated;
    const contentRaw =
      block.match(/<content[^>]*>([\s\S]*?)<\/content>/i)?.[1] ??
      block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1] ??
      "";
    const description = contentRaw
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/<[^>]+>/g, " ")
      .replace(/\bDiscussion\b.*$/i, "")
      .replace(/\s*\|\s*Link\s*$/i, "")
      .replace(/\bDiscussion\b/gi, "")
      .replace(/\bLink\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    // Prefer product URL without UTM noise
    const cleanUrl = link.split("?")[0];
    if (!title) continue;
    entries.push({
      name: title,
      url: cleanUrl || link,
      description,
      updated,
      published,
      sortKey: Date.parse(updated || published) || 0,
      dateLabel: (published || updated).slice(0, 10),
    });
  }
  // Dedupe by url/name, keep newest
  const seen = new Set();
  const unique = [];
  for (const e of entries.sort((a, b) => b.sortKey - a.sortKey)) {
    const key = e.url || e.name;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(e);
  }
  return unique;
}

/**
 * @param {number} limit
 */
export async function fetchProductHunt(limit = 10) {
  const xml = await fetchText(PRODUCT_HUNT_FEED, {
    accept: "application/atom+xml, application/xml, text/xml, */*",
    timeoutMs: 20000,
  });
  return parseProductHuntAtom(xml).slice(0, limit);
}


const GOOGLE_TRENDS_RSS = "https://trends.google.com/trending/rss";
const GOOGLE_TRENDS_PROXY =
  "https://gateway.pipeworx.io/v1/tools/google_trending_searches";
/** Default geo: Google has no true "global" Trending Now RSS; US is the most complete public feed. */
export const GOOGLE_TRENDS_DEFAULT_GEO = "US";

function decodeXmlEntities(value) {
  return String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) =>
      String.fromCharCode(parseInt(n, 16)),
    )
    .trim();
}

/**
 * Parse Google Trending Now RSS (https://trends.google.com/trending/rss?geo=XX).
 * @param {string} xml
 * @param {string} geo
 */
export function parseGoogleTrendsRss(xml, geo = GOOGLE_TRENDS_DEFAULT_GEO) {
  const region = String(geo || GOOGLE_TRENDS_DEFAULT_GEO).toUpperCase();
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const title = decodeXmlEntities(
      block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "",
    );
    if (!title) continue;
    const traffic = decodeXmlEntities(
      block.match(/<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/i)?.[1] ??
        "",
    );
    const pubDate =
      block.match(/<pubDate>([^<]+)<\/pubDate>/i)?.[1]?.trim() ?? "";
    const picture =
      block.match(/<ht:picture>([^<]+)<\/ht:picture>/i)?.[1]?.trim() ?? "";
    const newsTitles = [];
    const newsRe = /<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/gi;
    let nm;
    while ((nm = newsRe.exec(block)) !== null) {
      const t = decodeXmlEntities(nm[1]);
      if (t) newsTitles.push(t);
    }
    const newsUrls = [];
    const newsUrlRe = /<ht:news_item_url>([\s\S]*?)<\/ht:news_item_url>/gi;
    while ((nm = newsUrlRe.exec(block)) !== null) {
      const u = decodeXmlEntities(nm[1]);
      if (u) newsUrls.push(u);
    }
    const exploreUrl = `https://trends.google.com/trends/explore?geo=${encodeURIComponent(region)}&q=${encodeURIComponent(title)}`;
    const descParts = [];
    if (traffic) descParts.push(`近期搜索热度约 ${traffic}`);
    if (newsTitles.length) {
      descParts.push(`相关报道：${newsTitles.slice(0, 3).join("；")}`);
    } else {
      descParts.push("Google 热搜话题（公开 RSS 未附带长文简介）");
    }
    items.push({
      name: title,
      url: exploreUrl,
      description: descParts.join("。"),
      traffic,
      trafficFloor: Number(String(traffic).replace(/[^\d]/g, "")) || 0,
      published: pubDate,
      dateLabel: pubDate ? new Date(pubDate).toISOString().slice(0, 10) : "",
      picture,
      newsTitles,
      newsUrls,
      geo: region,
      sortKey: Number(String(traffic).replace(/[^\d]/g, "")) || 0,
    });
  }
  return items;
}

async function fetchGoogleTrendsRss(geo, limit, timeoutMs = 12000) {
  const region = String(geo || GOOGLE_TRENDS_DEFAULT_GEO).toUpperCase();
  const url = `${GOOGLE_TRENDS_RSS}?geo=${encodeURIComponent(region)}`;
  const xml = await fetchText(url, {
    accept: "application/rss+xml, application/xml, text/xml, */*",
    timeoutMs,
  });
  return parseGoogleTrendsRss(xml, region)
    .sort((a, b) => b.sortKey - a.sortKey)
    .slice(0, limit);
}

/**
 * Fallback when trends.google.com is unreachable (common on CN networks).
 * Public pipeworx tool wraps the same RSS — no API key for light use.
 */
async function fetchGoogleTrendsProxy(geo, limit, timeoutMs = 15000) {
  const region = String(geo || GOOGLE_TRENDS_DEFAULT_GEO).toUpperCase();
  const response = await fetch(GOOGLE_TRENDS_PROXY, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
    headers: {
      "User-Agent": DEFAULT_UA,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ country: region, limit }),
  });
  if (!response.ok) {
    throw new Error(`代理状态 ${response.status}`);
  }
  const data = await response.json();
  if (data?.error) {
    throw new Error(String(data.message || data.error));
  }
  const rows = Array.isArray(data?.trends) ? data.trends : [];
  return rows
    .map((row, index) => {
      const title = String(row.search_term || row.title || "").trim();
      if (!title) return null;
      const traffic = String(row.approximate_traffic || row.traffic || "").trim();
      const published = String(row.published_at || row.pubDate || "").trim();
      const exploreUrl = `https://trends.google.com/trends/explore?geo=${encodeURIComponent(region)}&q=${encodeURIComponent(title)}`;
      const news = Array.isArray(row.news)
        ? row.news
        : Array.isArray(row.related_news)
          ? row.related_news
          : [];
      const newsTitles = news
        .map((n) => String(n?.title || n?.news_item_title || "").trim())
        .filter(Boolean);
      const descParts = [];
      if (traffic) descParts.push(`近期搜索热度约 ${traffic}`);
      if (newsTitles.length) descParts.push(`相关报道：${newsTitles.slice(0, 3).join("；")}`);
      else descParts.push("Google Trend 话题（公开源未附带长文简介）");
      return {
        name: title,
        url: exploreUrl,
        description: descParts.join("。"),
        traffic,
        trafficFloor:
          Number(row.traffic_floor) ||
          Number(String(traffic).replace(/[^\d]/g, "")) ||
          0,
        published,
        dateLabel: published ? new Date(published).toISOString().slice(0, 10) : "",
        picture: String(row.picture || row.image || "").trim(),
        newsTitles,
        newsUrls: news
          .map((n) => String(n?.url || n?.news_item_url || "").trim())
          .filter(Boolean),
        geo: region,
        sortKey:
          Number(row.rank) > 0
            ? 1000 - Number(row.rank)
            : Number(row.traffic_floor) ||
              Number(String(traffic).replace(/[^\d]/g, "")) ||
              0,
        rankHint: Number(row.rank) || index + 1,
      };
    })
    .filter(Boolean)
    .slice(0, limit);
}

/**
 * @param {number} limit
 * @param {{ geo?: string }} [opts]
 */
/** In-memory cache — Google/proxy rate-limit easily under CN networks. */
var googleTrendsMemory = {
  at: 0,
  geo: "",
  items: null,
  source: "",
};

const GOOGLE_TRENDS_CACHE_MS = 15 * 60 * 1000;

/** Optional text-proxy fallback for blocked trends.google.com (best-effort). */
async function fetchGoogleTrendsViaTextProxy(geo, limit, timeoutMs = 18000) {
  const region = String(geo || GOOGLE_TRENDS_DEFAULT_GEO).toUpperCase();
  const target = `${GOOGLE_TRENDS_RSS}?geo=${encodeURIComponent(region)}`;
  const urls = [
    `https://r.jina.ai/http://trends.google.com/trending/rss?geo=${encodeURIComponent(region)}`,
    `https://r.jina.ai/${target}`,
  ];
  let lastError = "";
  for (const url of urls) {
    try {
      const xml = await fetchText(url, {
        accept: "text/plain, application/xml, text/xml, */*",
        timeoutMs,
      });
      // jina wraps pages as markdown; still often contains raw <item> blocks.
      const items = parseGoogleTrendsRss(xml, region)
        .sort((a, b) => b.sortKey - a.sortKey)
        .slice(0, limit);
      if (items.length) return items;
      lastError = "文本代理未解析到条目";
    } catch (error) {
      lastError = String(error?.message || error);
    }
  }
  throw new Error(lastError || "文本代理失败");
}

export async function fetchGoogleTrends(limit = 10, opts = {}) {
  const max = Math.min(Math.max(Number(limit) || 10, 1), 25);
  const geo = String(opts.geo || GOOGLE_TRENDS_DEFAULT_GEO).toUpperCase();
  const force = Boolean(opts.force);
  const now = Date.now();
  if (
    !force &&
    googleTrendsMemory.items &&
    googleTrendsMemory.geo === geo &&
    now - googleTrendsMemory.at < GOOGLE_TRENDS_CACHE_MS
  ) {
    return {
      items: googleTrendsMemory.items.slice(0, max),
      geo,
      source: `${googleTrendsMemory.source}+cache`,
    };
  }

  const errors = [];
  const remember = (items, source) => {
    googleTrendsMemory = { at: Date.now(), geo, items, source };
    return { items: items.slice(0, max), geo, source };
  };

  try {
    const items = await fetchGoogleTrendsRss(geo, max, 10000);
    if (items.length) return remember(items, "rss");
    errors.push("官方 RSS 返回空列表");
  } catch (error) {
    errors.push(`官方 RSS：${error?.message || error}`);
  }

  try {
    const items = await fetchGoogleTrendsProxy(geo, max, 15000);
    if (items.length) return remember(items, "proxy");
    errors.push("代理返回空列表");
  } catch (error) {
    errors.push(`公开代理：${error?.message || error}`);
  }

  try {
    const items = await fetchGoogleTrendsViaTextProxy(geo, max, 18000);
    if (items.length) return remember(items, "text-proxy");
    errors.push("文本代理返回空列表");
  } catch (error) {
    errors.push(`文本代理：${error?.message || error}`);
  }

  // Stale cache is better than hard fail when upstream is throttling.
  if (googleTrendsMemory.items && googleTrendsMemory.geo === geo) {
    return {
      items: googleTrendsMemory.items.slice(0, max),
      geo,
      source: `${googleTrendsMemory.source}+stale`,
    };
  }

  throw new Error(
    `Google Trend 获取失败（地区 ${geo}；国内网络常无法直连 Google，已尝试公开代理）。${errors.join("；")}`,
  );
}

function rankLabel(i) {
  if (i < 3) return MEDALS[i];
  return `**${i + 1}.**`;
}

/**
 * @param {Array<{fullName:string,url:string,description:string,language:string,stars:number,starsGained:number}>} items
 * @param {'今日'|'本周'} gainedLabel
 */
function formatGithubSection(items, gainedLabel) {
  if (!items.length) return "_暂无数据_";
  return items
    .map((item, i) => {
      const head = `${rankLabel(i)} [${item.fullName}](${item.url})`;
      const meta = `\`${"+"}${formatCompact(item.starsGained)}\` ${gainedLabel} · \`${formatCompact(item.stars)}\` 总计 · \`${item.language || "—"}\``;
      const desc = clipDesc(item.description);
      return `${head}\n${meta}\n${desc}`;
    })
    .join("\n\n");
}

/**
 * @param {Array<{name:string,url:string,description:string,dateLabel:string}>} items
 */
function formatPhSection(items) {
  if (!items.length) return "_暂无数据_";
  return items
    .map((item, i) => {
      const head = `${rankLabel(i)} [${item.name}](${item.url})`;
      const meta = `\`票数 —\` · \`${item.dateLabel || "—"}\``;
      const desc = clipDesc(item.description);
      return `${head}\n${meta}\n${desc}`;
    })
    .join("\n\n");
}

/**
 * @param {Array<{name:string,url:string,description:string,traffic:string,geo:string}>} items
 */
function formatGtSection(items) {
  if (!items.length) return "_暂无数据_";
  return items
    .map((item, i) => {
      const head = `${rankLabel(i)} [${item.name}](${item.url})`;
      const meta = `\`热度 ${item.traffic || "—"}\` · \`${item.geo || "US"}\``;
      const desc = clipDesc(item.description);
      return `${head}\n${meta}\n${desc}`;
    })
    .join("\n\n");
}

/**
 * @param {{
 *   sections?: Array<'github_weekly'|'product_hunt'|'google_trends'|string> | string,
 *   limit?: number,
 * }} [options]
 */
export async function buildDigest(options = {}) {
  let sections = options.sections;
  if (typeof sections === "string") {
    sections = sections
      .split(/[,|\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(sections) || sections.length === 0) {
    sections = ["github_weekly", "product_hunt", "google_trends"];
  }
  // Drop removed daily board if callers still pass it.
  sections = sections.filter((s) => s !== "github_daily" && s !== "all");
  if (!sections.length) {
    sections = ["github_weekly", "product_hunt", "google_trends"];
  }
  const wanted = new Set(sections);
  if (wanted.has("all")) {
    wanted.clear();
    wanted.add("github_weekly");
    wanted.add("product_hunt");
    wanted.add("google_trends");
  }
  const limit = Math.min(Math.max(Number(options.limit) || 10, 1), 25);
  const { ymd, hm, weekday } = shanghaiParts();

  /** @type {any[]} */
  const jobs = [];
  if (wanted.has("github_weekly")) {
    jobs.push(
      fetchGithubTrending("weekly", limit).then((items) => ({
        key: "github_weekly",
        items,
      })),
    );
  }
  if (wanted.has("product_hunt")) {
    jobs.push(
      fetchProductHunt(limit).then((items) => ({
        key: "product_hunt",
        items,
      })),
    );
  }
  if (wanted.has("google_trends")) {
    jobs.push(
      fetchGoogleTrends(limit).then((result) => ({
        key: "google_trends",
        items: result.items,
        meta: result,
      })),
    );
  }

  const settled = await Promise.allSettled(jobs);
  /** @type {Record<string, any>} */
  const byKey = {};
  /** @type {string[]} */
  const errors = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      byKey[result.value.key] = result.value.items;
    } else {
      errors.push(String(result.reason?.message ?? result.reason));
    }
  }

  const sectionCount = [
    wanted.has("github_weekly"),
    wanted.has("product_hunt"),
    wanted.has("google_trends"),
  ].filter(Boolean).length;

  const lines = [];
  lines.push(`# 📅 沙煲饭热点 · ${ymd}`);
  lines.push("");
  lines.push(
    `> 周${weekday} · ${hm} 北京时间 · 各前 ${limit} · 共 ${sectionCount} 个板块`,
  );
  lines.push("");
  lines.push("| 板块 | 说明 |");
  lines.push("| --- | --- |");
  if (wanted.has("github_weekly")) {
    lines.push("| 📈 GitHub热榜 | 按本周新增 ★ 排序 |");
  }
  if (wanted.has("product_hunt")) {
    lines.push("| 🚀 Product Hunt趋势 | 近期热度 / 上新 |");
  }
  if (wanted.has("google_trends")) {
    lines.push("| 🔍 Google Trend | Google Trending Now（默认美国；国内可能需代理） |");
  }
  lines.push("");

  if (wanted.has("github_weekly")) {
    lines.push("---");
    lines.push("");
    lines.push(`### 📈 GitHub热榜 前 ${limit}`);
    lines.push("");
    if (byKey.github_weekly) {
      lines.push(formatGithubSection(byKey.github_weekly, "本周"));
    } else {
      lines.push("_获取失败_");
    }
    lines.push("");
  }

  if (wanted.has("product_hunt")) {
    lines.push("---");
    lines.push("");
    lines.push(`### 🚀 Product Hunt趋势 前 ${limit}`);
    lines.push("");
    lines.push("> 票数暂未接入（公开订阅源不含点赞数）");
    lines.push("");
    if (byKey.product_hunt) {
      lines.push(formatPhSection(byKey.product_hunt));
    } else {
      lines.push("_获取失败_");
    }
    lines.push("");
  }

  if (wanted.has("google_trends")) {
    lines.push("---");
    lines.push("");
    lines.push(`### 🔍 Google Trend 前 ${limit}`);
    lines.push("");
    lines.push("> 数据来自 Google Trending Now 公开 RSS；默认地区美国（US）。国内网络常无法直连，插件会尝试公开代理。");
    lines.push("");
    if (byKey.google_trends) {
      lines.push(formatGtSection(byKey.google_trends));
    } else {
      lines.push("_获取失败_");
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(
    "_数据来源：[GitHub热榜](https://github.com/trending) · [gitstock](https://gitstock.org) · [Product Hunt 订阅](https://www.producthunt.com/feed) · [Google Trends RSS](https://trends.google.com/trending/rss)_",
  );

  if (errors.length) {
    lines.push("");
    lines.push(`> 部分数据源失败：${errors.join("；")}`);
  }

  return lines.join("\n");
}


/** @typedef {'github_weekly'|'product_hunt'|'google_trends'} SectionKey */

export const SECTION_META = {
  github_weekly: { key: "github_weekly", label: "GitHub热榜", emoji: "📈", kind: "github" },
  product_hunt: { key: "product_hunt", label: "Product Hunt趋势", emoji: "🚀", kind: "product_hunt" },
  google_trends: { key: "google_trends", label: "Google Trend", emoji: "🔍", kind: "google_trends" },
};

/**
 * @param {string} section
 * @param {string} stable
 */
export function makeItemId(section, stable) {
  return `${section}::${stable}`;
}

/**
 * @param {SectionKey|string} section
 * @param {number} limit
 */
export async function fetchCatalog(section, limit) {
  const key = String(section || "github_weekly");
  if (key === "github_daily") {
    throw new Error("GitHub 本日热榜已移除，请改用 GitHub热榜");
  }
  const max = Math.min(Math.max(Number(limit) || 10, 1), 25);
  const meta = SECTION_META[key];
  if (!meta) throw new Error(`未知板块：${key}`);

  /** @type {any[]} */
  let raw = [];
  /** @type {string} */
  let sourceNote = "";
  if (key === "github_weekly") {
    raw = await fetchGithubTrending("weekly", max);
  } else if (key === "product_hunt") {
    raw = await fetchProductHunt(max);
  } else {
    const result = await fetchGoogleTrends(max);
    raw = result.items;
    sourceNote =
      result.source === "proxy"
        ? "via-proxy"
        : "via-rss";
  }

  const { ymd, hm } = shanghaiParts();
  const items = raw.map((item, index) => {
    if (meta.kind === "github") {
      const title = item.fullName || "未知仓库";
      const id = makeItemId(key, title);
      const heat = `本周 +${formatCompact(item.starsGained)} · 总计 ${formatCompact(item.stars)}`;
      return {
        id,
        section: key,
        rank: index + 1,
        title,
        url: item.url || "",
        description: String(item.description || "").trim(),
        language: item.language || "",
        stars: Number(item.stars) || 0,
        starsGained: Number(item.starsGained) || 0,
        dateLabel: "",
        heatLabel: heat,
        kind: "github",
        imageUrl: "",
        imageSource: "",
        imageStatus: "unknown",
      };
    }
    if (meta.kind === "google_trends") {
      const title = item.name || "未知热搜";
      const stable = `${item.geo || "US"}::${title}`;
      const traffic = item.traffic || "—";
      const geo = item.geo || GOOGLE_TRENDS_DEFAULT_GEO;
      return {
        id: makeItemId(key, stable),
        section: key,
        rank: item.rankHint || index + 1,
        title,
        url: item.url || "",
        description: String(item.description || "").trim(),
        language: "",
        stars: 0,
        starsGained: Number(item.trafficFloor) || 0,
        dateLabel: item.dateLabel || "",
        heatLabel: `热度 ${traffic} · ${geo}`,
        kind: "google_trends",
        geo,
        traffic,
        newsTitles: Array.isArray(item.newsTitles) ? item.newsTitles : [],
        imageUrl: item.picture || "",
        imageSource: item.picture ? "google_trends" : "",
        imageStatus: item.picture ? "ready" : "missing",
        sourceNote,
      };
    }
    const title = item.name || "未知产品";
    const stable = item.url || title;
    return {
      id: makeItemId(key, stable),
      section: key,
      rank: index + 1,
      title,
      url: item.url || "",
      description: String(item.description || "").trim(),
      language: "",
      stars: 0,
      starsGained: 0,
      dateLabel: item.dateLabel || "",
      heatLabel: item.dateLabel ? `上新 ${item.dateLabel}` : "近期上新",
      kind: "product_hunt",
      imageUrl: "",
      imageSource: "",
      imageStatus: "unknown",
    };
  });

  return {
    section: key,
    sectionLabel: meta.label,
    fetchedAt: `${ymd} ${hm}`,
    timezoneLabel: "北京时间",
    items,
  };
}
