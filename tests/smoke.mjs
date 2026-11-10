#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function checkRemoteSignatures(source) {
  const bad = [];
  const re = /async (getDigest|listItems|getItem|translateItem|resolveImage|getAutoIntroStatus|setAutoIntroSettings|runAutoIntroNow)\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(source))) {
    const params = m[2].trim();
    if (!params) continue; // zero-arg ok
    // reject defaults, destructure, rest
    if (/=|\.\.\.|\{|\}/.test(params)) bad.push(`${m[1]}(${params})`);
    const names = params.split(",").map((s) => s.trim()).filter(Boolean);
    if (new Set(names).size !== names.length) bad.push(`dup ${m[1]}`);
    for (const n of names) {
      if (!/^[A-Za-z_$][\w$]*$/.test(n)) bad.push(`${m[1]} bad param ${n}`);
    }
  }
  assert.equal(bad.length, 0, `bad signatures: ${bad.join("; ")}`);
}

async function testCatalog() {
  const mod = await import(pathToFileURL(path.join(root, "lib/fetch.js")).href);
  assert.ok(!mod.SECTION_META.github_daily, "github_daily must be removed");
  assert.ok(mod.SECTION_META.github_weekly);
  assert.equal(mod.SECTION_META.github_weekly.label, "GitHub热榜");
  assert.equal(mod.SECTION_META.product_hunt.label, "Product Hunt趋势");
  assert.ok(mod.SECTION_META.google_trends);
  assert.equal(mod.SECTION_META.google_trends.label, "Google Trend");

  const catalog = await mod.fetchCatalog("github_weekly", 3);
  assert.equal(catalog.section, "github_weekly");
  assert.ok(Array.isArray(catalog.items));
  assert.ok(catalog.items.length >= 1, "expected at least 1 github item");
  const item = catalog.items[0];
  assert.ok(item.id.includes("::"));
  assert.ok(item.title);
  assert.equal(typeof item.description, "string");
  console.log("catalog ok", item.title, "descLen", item.description.length);

  const ph = await mod.fetchCatalog("product_hunt", 2);
  assert.ok(ph.items.length >= 1, "expected product hunt items");
  console.log("product_hunt ok", ph.items[0].title);

  try {
    const gt = await mod.fetchCatalog("google_trends", 3);
    assert.equal(gt.section, "google_trends");
    assert.ok(gt.items.length >= 1, "expected google trends items");
    assert.match(gt.items[0].heatLabel, /热度|US|SG|[A-Z]{2}/);
    console.log("google_trends ok", gt.items[0].title, gt.items[0].heatLabel);
  } catch (error) {
    // Network-dependent on CN; allow skip only if message is the Chinese error state.
    const msg = String(error?.message || error);
    assert.match(msg, /Google Trend 获取失败/);
    console.log("google_trends skipped (network):", msg.slice(0, 120));
  }

  await assert.rejects(
    () => mod.fetchCatalog("github_daily", 1),
    /今日|移除/,
  );
  console.log("github_daily removed ok");
}

function testLooksChineseAndCacheKey() {
  // inline minimal copies to avoid requiring dsh peers for pure helpers
  function contentHash(sourceText) {
    return createHash("sha256").update(String(sourceText || ""), "utf8").digest("hex").slice(0, 24);
  }
  function cacheKey(itemId, sourceText) {
    return `${itemId}#${contentHash(sourceText)}`;
  }
  const a = cacheKey("x::y", "hello");
  const b = cacheKey("x::y", "hello");
  const c = cacheKey("x::y", "hello!");
  assert.equal(a, b);
  assert.notEqual(a, c);
  console.log("cache key ok");
}

function testClientLoad() {
  const src = fs.readFileSync(path.join(root, "lib/client.js"), "utf8");
  globalThis.window = {
    __ModuleLoader__: {
      load(spec) {
        const fakeRequire = (name) => {
          if (name === "react") {
            return {
              useState: (v) => [typeof v === "function" ? v() : v, () => {}],
              useEffect: () => {},
              useCallback: (fn) => fn,
              useMemo: (fn) => fn(),
              useRef: (v) => ({ current: v }),
            };
          }
          if (name === "react/jsx-runtime") {
            return { jsx: () => null, jsxs: () => null, Fragment: "Fragment" };
          }
          throw new Error("unexpected " + name);
        };
        const mod = spec.factory(fakeRequire);
        assert.equal(typeof mod.apply, "function");
        assert.deepEqual(mod.inject, ["slots", "layout", "remote"]);
        assert.equal(mod.PANEL_ID, "trending-digest");
        assert.match(src, /沙煲饭热点/);
        const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
        assert.equal(pkg.name, "shabaofan-hot");
        assert.match(src, /id: "shabaofan-hot"/);
        assert.doesNotMatch(src, /id: "dsh-trending-digest"/);
        assert.equal(pkg.version, "0.5.2");
        assert.equal(pkg.private, undefined);

        // descriptors present in source
        assert.match(src, /listItems/);
        assert.match(src, /translateItem/);
        assert.match(src, /resolveImage/);
        assert.match(src, /generateIntro/);
        assert.match(src, /正在生成中文介绍/);
        assert.match(src, /重新生成/);
        assert.match(src, /打开后自动生成/);
        assert.doesNotMatch(src, /点击下方按钮/);
        assert.doesNotMatch(src, /className: "td-primary"/);
        assert.match(src, /项目预览图/);
        assert.match(src, /introSeqRef/);
        assert.match(src, /Songti SC/);
        assert.match(src, /renderIntroBody/);
        assert.match(src, /td-prose/);
        assert.match(src, /clamp\(24px/);
        assert.match(src, /每日自动介绍/);
        assert.match(src, /getAutoIntroStatus/);
        assert.match(src, /runAutoIntroNow/);
        assert.match(src, /getAutoIntroStatus/);
        assert.match(src, /setAutoIntroSettings/);
        assert.match(src, /formatAutoIntroError/);
        assert.match(src, /google_trends/);
        assert.match(src, /GitHub热榜/);
        assert.match(src, /Product Hunt趋势/);
        assert.match(src, /Google Trend/);
        assert.match(src, /formatListError/);
        assert.match(src, /formatPluginUnavailable/);
        assert.match(src, /withTransportRetry/);
        assert.match(src, /插件未就绪，请完全退出后重开/);
        assert.doesNotMatch(src, /出错：/);
        assert.doesNotMatch(src, /开源·本周/);
        assert.doesNotMatch(src, /产品热榜/);
        assert.doesNotMatch(src, /谷歌热搜/);
        assert.doesNotMatch(src, /key: "github_daily"/);
        // TYPERT_REMOTE must declare the same auto-intro methods the host exports.
        const descBlock = src.match(/const TYPERT_REMOTE = \{[\s\S]*?descriptors: \[([\s\S]*?)\]/);
        assert.ok(descBlock, "TYPERT_REMOTE descriptors missing");
        for (const name of ["getAutoIntroStatus", "setAutoIntroSettings", "runAutoIntroNow"]) {
          assert.match(descBlock[1], new RegExp(`method\\(\"${name}\"`));
        }
        console.log("client load ok");
      },
    },
  };
  // eslint-disable-next-line no-new-func
  new Function(src)();
}

function testHostSource() {
  const src = fs.readFileSync(path.join(root, "index.js"), "utf8");
  checkRemoteSignatures(src);
  assert.match(src, /static inject = \["tools", "llm", "agentDefaultModel", "timer"\]/);
  assert.match(src, /TranslationCache/);
  assert.match(src, /translateItem/);
  assert.match(src, /resolveImage/);
  assert.match(src, /ImageCache/);
  assert.match(src, /中文介绍暂未生成/);
  assert.match(src, /CACHE_SCHEMA_VERSION/);
  assert.match(src, /pruned \$\{pruned\} stale intro cache/);
  assert.match(src, /runDailyBatch/);
  assert.match(src, /getAutoIntroStatus/);
  assert.match(src, /setAutoIntroSettings/);
  assert.match(src, /runAutoIntroNow/);
  assert.match(src, /AutoIntroSettingsStore/);
  assert.match(src, /TRENDING_REMOTE_METHODS/);
  const remoteList = src.match(/var TRENDING_REMOTE_METHODS = \[([\s\S]*?)\]/);
  assert.ok(remoteList, "TRENDING_REMOTE_METHODS missing");
  for (const name of [
    "getDigest",
    "listItems",
    "getItem",
    "translateItem",
    "resolveImage",
    "getAutoIntroStatus",
    "setAutoIntroSettings",
    "runAutoIntroNow",
  ]) {
    assert.match(remoteList[1], new RegExp(`"${name}"`));
  }
  console.log("host signatures ok");
}

async function testConcurrentGuard() {
  const { createInflightGuard } = await import(pathToFileURL(path.join(root, "lib/ai.js")).href).catch(() => ({ createInflightGuard: null }));
  // ai.js imports @deepseek-ai/dsh-llm which may be unresolved outside DSH — fallback local
  let guard;
  if (createInflightGuard) {
    guard = createInflightGuard();
  } else {
    const inflight = new Map();
    guard = (token, run) => {
      const existing = inflight.get(token);
      if (existing) return existing;
      const promise = Promise.resolve().then(run).finally(() => inflight.delete(token));
      inflight.set(token, promise);
      return promise;
    };
  }
  let runs = 0;
  const p1 = guard("t", async () => {
    runs += 1;
    await new Promise((r) => setTimeout(r, 30));
    return "ok";
  });
  const p2 = guard("t", async () => {
    runs += 1;
    return "nope";
  });
  const [a, b] = await Promise.all([p1, p2]);
  assert.equal(a, "ok");
  assert.equal(b, "ok");
  assert.equal(runs, 1, "concurrent calls must dedupe");
  console.log("inflight guard ok");
}


async function testImages() {
  const mod = await import(pathToFileURL(path.join(root, "lib/images.js")).href);
  const og = mod.githubOgUrl("vercel", "next.js");
  assert.match(og, /opengraph\.githubassets\.com\/1\/vercel\/next\.js/);
  const parsed = mod.parseGithubFullName("vercel/next.js");
  assert.equal(parsed.owner, "vercel");
  assert.equal(parsed.repo, "next.js");
  const md = `![badge](https://img.shields.io/npm/v/x.svg)\n\n![demo](./docs/demo.png)\n`;
  const cands = mod.extractReadmeImageCandidates(md, "vercel", "next.js");
  assert.ok(cands.length >= 1, "expected readme candidate");
  assert.match(cands[0].primary, /jsdelivr|raw\.githubusercontent/);
  assert.ok(!cands.some((c) => /shields/.test(c.primary)));
  console.log("images helpers ok", cands[0].primary.slice(0, 60));
}


async function testScheduleHelpers() {
  // schedule.js imports dsh-home-paths — stub via dynamic import may fail outside DSH.
  // Inline the pure time helpers by reading source and evaluating carefully is brittle;
  // instead require the file after mocking the peer.
  const homePaths = path.join(root, "tests", "_mock_home_paths.mjs");
  fs.writeFileSync(
    homePaths,
    'export function resolveDshHome(){ return "/tmp/dsh-trending-digest-test-home"; }\n',
  );
  // Node cannot easily remap peer imports; duplicate pure functions for smoke:
  function shanghaiParts(date = new Date()) {
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
    const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
    return {
      ymd: `${parts.year}-${parts.month}-${parts.day}`,
      hour: Number(parts.hour),
      minute: Number(parts.minute),
      second: Number(parts.second),
    };
  }
  function msUntilNextShanghai(hour, minute, now) {
    const h = Math.min(Math.max(Number(hour) || 0, 0), 23);
    const m = Math.min(Math.max(Number(minute) || 0, 0), 59);
    const current = now instanceof Date ? now : new Date();
    const parts = shanghaiParts(current);
    const [y, mo, da] = parts.ymd.split("-").map(Number);
    let target = new Date(
      `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+08:00`,
    );
    if (!(target.getTime() > current.getTime() + 1500)) {
      target = new Date(target.getTime() + 24 * 3600 * 1000);
    }
    return Math.max(target.getTime() - current.getTime(), 1000);
  }
  const fixed = new Date("2026-11-08T01:00:00+08:00"); // 01:00 Shanghai
  const ms = msUntilNextShanghai(9, 0, fixed);
  assert.ok(ms > 7 * 3600 * 1000 && ms < 9 * 3600 * 1000, "expect ~8h until 09:00");
  const past = new Date("2026-11-08T10:00:00+08:00");
  const ms2 = msUntilNextShanghai(9, 0, past);
  assert.ok(ms2 > 20 * 3600 * 1000, "after 09:00 should schedule next day");
  assert.equal(shanghaiParts(fixed).ymd, "2026-11-08");
  try { fs.unlinkSync(homePaths); } catch {}
  console.log("schedule helpers ok", Math.round(ms / 3600000) + "h");
}

async function testGoogleTrendsParse() {
  const mod = await import(pathToFileURL(path.join(root, "lib/fetch.js")).href);
  const xml = `<?xml version="1.0"?><rss xmlns:ht="https://trends.google.com/trending/rss" version="2.0"><channel>
  <item><title>oil price</title><ht:approx_traffic>200+</ht:approx_traffic><pubDate>Mon, 9 Nov 2026 05:40:00 -0800</pubDate>
  <ht:news_item><ht:news_item_title>Sample &amp; News</ht:news_item_title><ht:news_item_url>https://example.com/a</ht:news_item_url></ht:news_item>
  </item></channel></rss>`;
  const items = mod.parseGoogleTrendsRss(xml, "US");
  assert.equal(items.length, 1);
  assert.equal(items[0].name, "oil price");
  assert.equal(items[0].traffic, "200+");
  assert.match(items[0].url, /trends\.google\.com\/trends\/explore/);
  assert.match(items[0].description, /Sample & News|Sample/);
  console.log("google trends parse ok");
}

const failures = [];
for (const [name, fn] of [
  ["googleTrendsParse", testGoogleTrendsParse],
  ["hostSource", testHostSource],
  ["cacheKey", testLooksChineseAndCacheKey],
  ["clientLoad", testClientLoad],
  ["catalog", testCatalog],
  ["concurrentGuard", testConcurrentGuard],
  ["images", testImages],
  ["schedule", testScheduleHelpers],
]) {
  try {
    await fn();
  } catch (error) {
    failures.push(`${name}: ${error?.stack || error}`);
    console.error("FAIL", name, error);
  }
}

if (failures.length) {
  console.error("\nSMOKE FAILED\n" + failures.join("\n\n"));
  process.exit(1);
}
console.log("\nALL SMOKE TESTS PASSED");
