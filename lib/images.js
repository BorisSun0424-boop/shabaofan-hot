/**
 * Resolve a project preview image URL (GitHub OG / README screenshot / PH).
 * Prefer publicly reachable hosts; degrade quietly when nothing works.
 */

const DEFAULT_UA =
  "dsh-trending-digest/0.3.8 (+https://github.com; DeepSeek Harness plugin)";

const BAD_IMAGE =
  /shields\.io|badge|travis-ci|circleci|codecov|coveralls|img\.shields|buymeacoffee|liberapay|patreon|discord(?:app)?\.com|ko-fi|dependabot|actions\/workflows|stars\.svg|forks\.svg|issues\.svg|license\.svg|npmjs\.org\/badge|nodei\.co|david-dm|snyk\.io|flat-square|social\/|pixel\.gif|1x1|spacer|api\.star-history|star-history\.com|conventionalcommits\.org|commitizen|renovate|sonarcloud|codeclimate|lgtm\.io|gitter\.im|fury\.io|version\.svg|workflow\/status|github\.com\/.*\/actions\/|camo\.githubusercontent\.com\/[a-f0-9]{40,}/i;

/**
 * @param {string} titleOrUrl
 */
export function parseGithubFullName(titleOrUrl) {
  const raw = String(titleOrUrl || "").trim();
  if (!raw) return null;
  const fromUrl = raw.match(
    /^https?:\/\/github\.com\/([^/\s#?]+)\/([^/\s#?]+?)(?:\.git)?(?:\/|$)/i,
  );
  if (fromUrl) {
    return { owner: fromUrl[1], repo: fromUrl[2].replace(/\.git$/i, "") };
  }
  const parts = raw.replace(/^https?:\/\/github\.com\//i, "").split("/");
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return {
      owner: parts[0],
      repo: String(parts[1]).replace(/\.git$/i, "").split(/[?#]/)[0],
    };
  }
  return null;
}

/**
 * Stable OG social card — works without scraping github.com HTML.
 * Hash segment is ignored by GitHub; any stable token is fine.
 * @param {string} owner
 * @param {string} repo
 */
export function githubOgUrl(owner, repo) {
  return `https://opengraph.githubassets.com/1/${owner}/${repo}`;
}

/**
 * @param {string} url
 * @param {string} owner
 * @param {string} repo
 */
export function absolutizeRepoAsset(url, owner, repo) {
  let u = String(url || "")
    .trim()
    .replace(/^<|>$/g, "");
  if (!u) return "";
  if (u.startsWith("//")) u = `https:${u}`;
  else if (!/^https?:\/\//i.test(u)) {
    const cleaned = u.replace(/^\.?\//, "");
    u = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${cleaned}`;
  }
  u = u.replace(
    /https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^/]+)\/(.+)/i,
    "https://raw.githubusercontent.com/$1/$2/$3/$4",
  );
  // Prefer jsDelivr for raw.githubusercontent (often faster in CN)
  const rawMatch = u.match(
    /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/i,
  );
  if (rawMatch) {
    const [, o, r, ref, path] = rawMatch;
    return {
      primary: `https://cdn.jsdelivr.net/gh/${o}/${r}@${ref}/${path}`,
      fallback: u,
    };
  }
  return { primary: u, fallback: "" };
}

/**
 * @param {string} markdown
 * @param {string} owner
 * @param {string} repo
 */
export function extractReadmeImageCandidates(markdown, owner, repo) {
  const md = String(markdown || "");
  const found = [];
  const push = (rawUrl) => {
    if (!rawUrl || BAD_IMAGE.test(rawUrl)) return;
    if (/\.svg(\?|#|$)/i.test(rawUrl)) return;
    const abs = absolutizeRepoAsset(rawUrl, owner, repo);
    if (!abs.primary) return;
    if (BAD_IMAGE.test(abs.primary)) return;
    found.push(abs);
  };
  const reMd = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = reMd.exec(md))) push(m[1]);
  const reHtml = /<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  while ((m = reHtml.exec(md))) push(m[1]);
  // Dedupe by primary
  const seen = new Set();
  const unique = [];
  for (const item of found) {
    if (seen.has(item.primary)) continue;
    seen.add(item.primary);
    unique.push(item);
  }
  return unique.slice(0, 6);
}

/**
 * @param {string} url
 * @param {number} [timeoutMs]
 */
async function urlLooksLikeImage(url, timeoutMs) {
  const ms = Math.min(Math.max(Number(timeoutMs) || 4500, 1500), 8000);
  try {
    const head = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(ms),
      redirect: "follow",
      headers: { "User-Agent": DEFAULT_UA, Accept: "image/*,*/*" },
    });
    if (head.ok) {
      const ct = String(head.headers.get("content-type") || "").toLowerCase();
      if (!ct || ct.startsWith("image/") || ct.includes("octet-stream")) {
        return true;
      }
      // Some CDNs omit type on HEAD — accept 200 with image-ish extension
      if (/\.(png|jpe?g|gif|webp|avif)(\?|#|$)/i.test(url)) return true;
      return false;
    }
  } catch {
    // try GET range as fallback (some hosts reject HEAD)
  }
  try {
    const get = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(ms),
      redirect: "follow",
      headers: {
        "User-Agent": DEFAULT_UA,
        Accept: "image/*,*/*",
        Range: "bytes=0-64",
      },
    });
    if (!(get.ok || get.status === 206)) return false;
    const ct = String(get.headers.get("content-type") || "").toLowerCase();
    if (ct.startsWith("image/")) return true;
    if (/\.(png|jpe?g|gif|webp|avif)(\?|#|$)/i.test(url)) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * @param {string} owner
 * @param {string} repo
 */
async function fetchReadmeMarkdown(owner, repo) {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/readme`,
      {
        signal: AbortSignal.timeout(9000),
        redirect: "follow",
        headers: {
          "User-Agent": DEFAULT_UA,
          Accept: "application/vnd.github.raw+json",
        },
      },
    );
    if (!response.ok) return "";
    const text = await response.text();
    if (!text || text.length < 20) return "";
    if (/^\s*<!DOCTYPE|^<html/i.test(text)) return "";
    return text.slice(0, 120000);
  } catch {
    return "";
  }
}

/**
 * @param {string} owner
 * @param {string} repo
 */
async function resolveGithubImage(owner, repo) {
  const og = githubOgUrl(owner, repo);
  const readme = await fetchReadmeMarkdown(owner, repo);
  const candidates = extractReadmeImageCandidates(readme, owner, repo);
  for (const cand of candidates.slice(0, 3)) {
    if (await urlLooksLikeImage(cand.primary, 4000)) {
      return {
        url: cand.primary,
        source: "readme",
        status: "ready",
      };
    }
    if (cand.fallback && (await urlLooksLikeImage(cand.fallback, 3500))) {
      return {
        url: cand.fallback,
        source: "readme",
        status: "ready",
      };
    }
  }
  // OG card is constructible and usually reachable — still soft-check once
  if (await urlLooksLikeImage(og, 5000)) {
    return { url: og, source: "og", status: "ready" };
  }
  // Return OG anyway: browser may succeed even if host HEAD timed out
  return { url: og, source: "og", status: "ready" };
}

/**
 * Best-effort Product Hunt og:image from product page.
 * @param {string} pageUrl
 */
async function resolveProductHuntImage(pageUrl) {
  const url = String(pageUrl || "").trim();
  if (!url || !/producthunt\.com/i.test(url)) {
    return { url: "", source: "", status: "missing" };
  }
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
      headers: {
        "User-Agent": DEFAULT_UA,
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) return { url: "", source: "", status: "missing" };
    const html = await response.text();
    const og =
      html.match(
        /property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
      ) ||
      html.match(
        /content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
      );
    const image = og?.[1]?.trim() || "";
    if (!image || BAD_IMAGE.test(image)) {
      return { url: "", source: "", status: "missing" };
    }
    return { url: image, source: "product_hunt", status: "ready" };
  } catch {
    return { url: "", source: "", status: "missing" };
  }
}

/**
 * @param {any} item
 */
export async function resolveItemImage(item) {
  if (!item) {
    return { url: "", source: "", status: "missing" };
  }
  if (item.imageUrl && item.kind === "google_trends") {
    return {
      url: item.imageUrl,
      source: item.imageSource || "google_trends",
      status: "ready",
    };
  }
  if (item.kind === "github") {
    const parsed = parseGithubFullName(item.title || item.url || "");
    if (!parsed) return { url: "", source: "", status: "missing" };
    return await resolveGithubImage(parsed.owner, parsed.repo);
  }
  if (item.kind === "product_hunt") {
    return await resolveProductHuntImage(item.url || "");
  }
  if (item.kind === "google_trends") {
    return { url: "", source: "", status: "missing" };
  }
  return { url: "", source: "", status: "missing" };
}
