/**
 * shabaofan-hot client — 乔木式列表 + 条目排版阅读面板；打开条目自动生成中文介绍
 */
window.__ModuleLoader__.load({
  id: "shabaofan-hot",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const jsxRuntime = require("react/jsx-runtime");
    const { jsx, jsxs, Fragment } = jsxRuntime;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    const PLUGIN_ID = "shabaofan-hot";
    const PANEL_ID = "trending-digest";
    const SERVICE = "trending";

    const SECTION_OPTIONS = [
      { key: "github_weekly", label: "GitHub热榜", emoji: "📈" },
      { key: "product_hunt", label: "Product Hunt趋势", emoji: "🚀" },
      { key: "google_trends", label: "Google Trend", emoji: "🔍" },
    ];

    const PANEL_CSS = `
.td-root{
  --td-bg:var(--dsw-alias-bg-base, transparent);
  --td-bg-2:var(--dsw-alias-bg-layer-1, color-mix(in srgb, currentColor 4%, transparent));
  --td-fg:var(--dsw-alias-label-primary, inherit);
  --td-muted:var(--dsw-alias-label-secondary, color-mix(in srgb, currentColor 62%, transparent));
  --td-border:var(--dsw-alias-border-l1, color-mix(in srgb, currentColor 12%, transparent));
  --td-hover:var(--dsw-alias-bg-overlay, color-mix(in srgb, currentColor 7%, transparent));
  --td-accent:var(--dsw-alias-brand-primary, #4f6ef7);
  --td-list-width:320px;
  --td-article-width:804px;
  --td-font-size:19px;
  --td-line-height:1.9;
  --td-font-family:"Songti SC","Noto Serif CJK SC","Source Han Serif SC",Georgia,serif;
  display:flex;flex-direction:column;height:100%;min-width:0;min-height:0;
  color:var(--td-fg);background:var(--td-bg);outline:none;
  padding-top:var(--dsh-frame-top-clearance, 48px);overflow:hidden;
  container-type:inline-size;
}
.td-root button,.td-root a{-webkit-app-region:no-drag}
.td-root :focus-visible{outline:1px solid var(--td-accent);outline-offset:2px}
.td-toolbar{
  display:flex;flex-wrap:wrap;align-items:center;gap:8px;
  min-height:52px;padding:10px 14px;flex-shrink:0;
  border-bottom:1px solid color-mix(in srgb, var(--td-fg) 10%, var(--td-bg));
}
.td-brand{display:flex;align-items:center;gap:8px;margin-right:4px}
.td-brand-mark{
  width:28px;height:28px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;
  background:color-mix(in srgb, var(--td-accent) 14%, var(--td-bg));color:var(--td-accent);
}
.td-brand-title{font-size:14px;font-weight:650}
.td-brand-sub{font-size:11px;color:var(--td-muted)}
.td-pills{display:flex;flex-wrap:wrap;gap:6px}
.td-pill{
  appearance:none;border:1px solid color-mix(in srgb, var(--td-fg) 13%, var(--td-bg));
  background:transparent;color:var(--td-muted);border-radius:999px;padding:5px 11px;font-size:12px;cursor:pointer;
}
.td-pill:hover{background:var(--td-hover);color:var(--td-fg)}
.td-pill.is-on{
  color:var(--td-fg);border-color:color-mix(in srgb, var(--td-accent) 55%, transparent);
  background:color-mix(in srgb, var(--td-accent) 12%, var(--td-bg));
}
.td-toolbar-spacer{flex:1}
.td-refresh,.td-primary,.td-ghost{
  appearance:none;border-radius:8px;font-size:12.5px;cursor:pointer;
  display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:0 12px;
}
.td-refresh,.td-primary{border:0;color:#fff;background:var(--td-accent);font-weight:620}
.td-refresh:disabled,.td-primary:disabled{opacity:.65;cursor:wait}
.td-ghost{
  border:1px solid color-mix(in srgb, var(--td-fg) 16%, var(--td-bg));
  background:transparent;color:var(--td-fg);
}
.td-ghost:hover{background:var(--td-hover)}
.td-auto{
  appearance:none;border-radius:8px;font-size:12px;cursor:pointer;
  display:inline-flex;align-items:center;gap:6px;min-height:32px;padding:0 10px;
  border:1px solid color-mix(in srgb, var(--td-fg) 16%, var(--td-bg));
  background:transparent;color:var(--td-muted);
}
.td-auto.is-on{
  color:var(--td-fg);
  border-color:color-mix(in srgb, var(--td-accent) 45%, transparent);
  background:color-mix(in srgb, var(--td-accent) 10%, var(--td-bg));
}
.td-auto:disabled{opacity:.65;cursor:wait}
.td-note strong{color:var(--td-fg);font-weight:600}
.td-note{
  padding:7px 14px 0;font-size:11.5px;color:var(--td-muted);flex-shrink:0;line-height:1.45;
}
.td-workarea{flex:1;min-height:0;display:grid;grid-template-columns:var(--td-list-width) 1px minmax(0,1fr)}
.td-split{background:color-mix(in srgb, var(--td-fg) 10%, var(--td-bg))}
.td-list{
  min-width:0;min-height:0;overflow:auto;background:color-mix(in srgb, var(--td-bg-2) 70%, var(--td-bg));
}
.td-row{
  appearance:none;width:100%;text-align:left;border:0;background:transparent;color:inherit;
  display:grid;grid-template-columns:28px minmax(0,1fr);gap:8px;padding:11px 12px 12px;
  border-bottom:1px solid color-mix(in srgb, var(--td-fg) 7%, var(--td-bg));cursor:pointer;
}
.td-row:hover{background:var(--td-hover)}
.td-row.is-on{
  background:color-mix(in srgb, var(--td-fg) 8%, var(--td-bg));
  box-shadow:inset 2px 0 0 color-mix(in srgb, var(--td-fg) 58%, var(--td-bg));
}
.td-rank{font-size:14px;line-height:1.3;padding-top:1px}
.td-row-title{font-size:13.5px;font-weight:620;line-height:1.35;word-break:break-word}
.td-row-heat{margin-top:4px;font-size:11.5px;color:var(--td-muted)}
.td-row-desc{margin-top:5px;font-size:12px;line-height:1.45;color:var(--td-muted);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.td-row-badge{
  display:inline-flex;margin-top:6px;font-size:11px;padding:2px 7px;border-radius:999px;
  background:color-mix(in srgb, var(--td-accent) 12%, var(--td-bg));color:var(--td-accent);
}
.td-row-badge.missing{background:color-mix(in srgb, var(--td-fg) 7%, var(--td-bg));color:var(--td-muted)}
.td-article{min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain}
.td-article-inner{
  max-width:var(--td-article-width);width:100%;margin:0 auto;
  padding:30px clamp(24px,5%,60px) 90px;box-sizing:border-box;
}
.td-back{display:none;margin-bottom:10px}
.td-article-head{
  display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;
  margin-bottom:14px;color:var(--td-muted);font-size:12px;line-height:1.6;
}
.td-article-rank{font-size:12px;color:var(--td-muted);margin:0}
.td-article-title{
  font-size:clamp(24px,2.5cqw,32px);line-height:1.5;letter-spacing:-.025em;
  margin:0 0 26px;overflow-wrap:anywhere;font-weight:600;text-wrap:balance;
  font-family:var(--td-font-family);word-break:break-word;
}
.td-meta{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 18px}
.td-chip{
  font-size:11.5px;padding:1px 7px;border-radius:999px;color:var(--td-muted);
  background:transparent;
  border:.5px solid color-mix(in srgb, var(--td-fg) 18%, var(--td-bg));
}
.td-chip strong{color:var(--td-fg);font-weight:620}
.td-hero{
  margin:0 0 26px;border-radius:8px;overflow:hidden;
  border:1px solid color-mix(in srgb, var(--td-fg) 10%, var(--td-bg));
  background:color-mix(in srgb, var(--td-fg) 5%, var(--td-bg));
  min-height:120px;max-height:360px;display:flex;align-items:center;justify-content:center;
  position:relative;
}
.td-hero img{
  display:block;width:100%;max-height:360px;object-fit:contain;background:#0b0d12;
}
.td-hero.is-missing,.td-hero.is-loading{
  min-height:88px;max-height:120px;
}
.td-hero-ph{
  font-size:12.5px;color:var(--td-muted);padding:18px 16px;text-align:center;line-height:1.5;
}
.td-section-label{font-size:12px;font-weight:650;color:var(--td-muted);margin:8px 0 4px}
.td-prose{
  font-family:var(--td-font-family);font-size:var(--td-font-size);line-height:var(--td-line-height);
  overflow-wrap:anywhere;max-width:42em;-webkit-user-select:text;user-select:text;
}
.td-prose p{margin:1.1em 0}
.td-prose h2{margin:1.8em 0 .7em;font-size:1.3em;line-height:1.6;font-weight:650}
.td-prose h3{margin:1.6em 0 .6em;font-size:1.12em;font-weight:620}
.td-prose p:first-child,.td-prose h2:first-child,.td-prose h3:first-child{margin-top:0}
.td-prose.placeholder{color:var(--td-muted);font-size:15px;line-height:1.75}
.td-prose.is-loading{color:var(--td-muted);font-size:15px;line-height:1.75}
.td-intro-error{
  margin:0 0 8px;padding:14px 16px;border-radius:8px;
  border:1px solid color-mix(in srgb, #e5484d 35%, var(--td-bg));
  background:color-mix(in srgb, #e5484d 8%, var(--td-bg));
  color:var(--td-fg);font-size:14px;line-height:1.65;
}
.td-intro-error strong{display:block;margin-bottom:6px;color:#e5484d;font-weight:620}
.td-intro-error p{margin:0}
.td-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:28px}
.td-link{
  color:var(--td-accent);text-decoration:none;font-size:13px;
  display:inline-flex;align-items:center;min-height:32px;
}
.td-link:hover{text-decoration:underline}
.td-empty,.td-error{
  display:grid;justify-items:start;gap:8px;width:min(100%,420px);
  margin:clamp(40px,10vh,100px) auto;color:var(--td-muted);padding:0 16px;
}
.td-empty h2,.td-error h2{margin:0;color:var(--td-fg);font-size:18px;font-weight:650}
.td-empty p,.td-error p{margin:0;font-size:13px;line-height:1.6}
.td-error h2{color:#e5484d}
.td-skel{background:color-mix(in srgb, var(--td-fg) 8%, var(--td-bg));
  background-image:linear-gradient(100deg,transparent 18%,color-mix(in srgb, var(--td-bg) 65%, transparent) 50%,transparent 82%);
  background-size:200% 100%;animation:td-shimmer 1.7s ease-in-out infinite;border-radius:6px}
.td-skel-line{height:12px;margin:0 12px 10px}.td-skel-card{height:64px;margin:0 10px 10px;border-radius:10px}
@keyframes td-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.td-skel{animation:none;background-image:none}}
@container (max-width: 820px){
  .td-workarea{grid-template-columns:1fr}
  .td-split{display:none}
  .td-root.is-list .td-article{display:none}
  .td-root.is-article .td-list{display:none}
  .td-root.is-article .td-article{display:block}
  .td-back{display:inline-flex}
  .td-article-inner{padding:20px 18px 70px}
}
`;

    let stylesReady = false;
    function ensureStyles() {
      if (stylesReady || typeof document === "undefined") return;
      stylesReady = true;
      const style = document.createElement("style");
      style.dataset.plugin = PLUGIN_ID;
      style.textContent = PANEL_CSS;
      document.head.appendChild(style);
    }

    const codec = () => ({
      mode: "strict",
      typeSymbol: `${PLUGIN_ID}#json`,
      create: () => ({
        parse: (value) => value,
        safeParse: (value) => ({ success: true, data: value }),
      }),
    });

    function method(methodName, params) {
      const useParams = params !== false;
      return {
        id: `${PLUGIN_ID}#${SERVICE}/${methodName}`,
        service: SERVICE,
        namespace: SERVICE,
        method: methodName,
        invocation: { kind: "direct" },
        ...(useParams
          ? {
              parameters: [
                {
                  name: "request",
                  wire: "request",
                  source: "json",
                  codec: codec(),
                },
              ],
            }
          : { parameters: [] }),
        result: { mode: "src-json" },
        cancellation: { parameter: "signal" },
      };
    }

    const TYPERT_REMOTE = {
      package: PLUGIN_ID,
      descriptors: [
        method("getDigest"),
        method("listItems"),
        method("getItem"),
        method("translateItem"),
        method("resolveImage"),
        method("getAutoIntroStatus"),
        method("setAutoIntroSettings"),
        method("runAutoIntroNow"),
      ],
    };

    function FlameIcon({ size }) {
      const s = size == null ? 16 : size;
      return jsxs("svg", {
        width: s,
        height: s,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.8,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": true,
        children: [jsx("path", { d: "M13 2L4 14h7l-1 8 10-14h-7l0-6z" })],
      });
    }

    function DigestIcon({ size, active }) {
      const s = size == null ? 18 : size;
      return jsx("span", {
        style: {
          display: "inline-flex",
          color: active ? "var(--dsw-alias-brand-primary, #4f6ef7)" : "currentColor",
        },
        children: jsx(FlameIcon, { size: s }),
      });
    }

    function listPreview(item) {
      if (item.chineseStatus === "ready" && item.chineseDescription) {
        return item.chineseDescription;
      }
      const raw = String(item.description || "").trim();
      if (raw) return raw;
      return "打开后将自动生成介绍";
    }


    /** Lightweight Markdown → prose nodes (## / ### / paragraphs). Mirrors 乔木 .qrs-prose. */
    function renderIntroBody(text, placeholder) {
      const raw = String(text || "").trim();
      if (!raw) {
        return jsx("div", {
          className: "td-prose placeholder",
          children: placeholder || "中文介绍暂未生成",
        });
      }
      const lines = raw.replace(/\r\n/g, "\n").split("\n");
      const blocks = [];
      let para = [];
      const flushPara = () => {
        if (!para.length) return;
        const content = para.join("\n").trim();
        if (content) blocks.push({ type: "p", text: content });
        para = [];
      };
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const trimmed = line.trim();
        const h2 = /^##\s+(.+)$/.exec(trimmed);
        const h3 = /^###\s+(.+)$/.exec(trimmed);
        if (h2) {
          flushPara();
          blocks.push({ type: "h2", text: h2[1].trim() });
          continue;
        }
        if (h3) {
          flushPara();
          blocks.push({ type: "h3", text: h3[1].trim() });
          continue;
        }
        if (!trimmed) {
          flushPara();
          continue;
        }
        para.push(line);
      }
      flushPara();
      if (!blocks.length) {
        return jsx("div", {
          className: "td-prose placeholder",
          children: placeholder || "中文介绍暂未生成",
        });
      }
      return jsxs("div", {
        className: "td-prose",
        children: blocks.map((b, i) => {
          if (b.type === "h2") return jsx("h2", { children: b.text }, i);
          if (b.type === "h3") return jsx("h3", { children: b.text }, i);
          return jsx("p", { children: b.text }, i);
        }),
      });
    }

    function SkeletonList() {
      return jsxs("div", {
        children: [0, 1, 2, 3, 4, 5].map((i) =>
          jsx("div", { className: "td-skel td-skel-card", key: i }),
        ),
      });
    }

    function HeroImage({ url, loading, status }) {
      const [broken, setBroken] = useState(false);
      useEffect(() => {
        setBroken(false);
      }, [url]);
      if (loading && !url) {
        return jsx("div", {
          className: "td-hero is-loading",
          children: jsx("div", {
            className: "td-hero-ph",
            children: "正在加载项目预览图…",
          }),
        });
      }
      if (!url || broken || status === "missing" || status === "error") {
        if (status === "missing" || status === "error" || broken) {
          return jsx("div", {
            className: "td-hero is-missing",
            children: jsx("div", {
              className: "td-hero-ph",
              children: "暂无项目预览图",
            }),
          });
        }
        return null;
      }
      return jsx("div", {
        className: "td-hero",
        children: jsx("img", {
          src: url,
          alt: "项目预览图",
          loading: "lazy",
          referrerPolicy: "no-referrer",
          onError: () => setBroken(true),
        }),
      });
    }

    function isTransportUnavailable(msg) {
      return /HTTP\s*404|transport failure|invocation-unavailable|method-unavailable|client api:\s*trending\//i.test(
        String(msg || ""),
      );
    }

    function formatPluginUnavailable() {
      return "插件未就绪，请完全退出后重开";
    }

    function formatAutoIntroError(err, fallback) {
      const msg = String((err && err.message) || err || fallback || "");
      if (isTransportUnavailable(msg)) {
        return formatPluginUnavailable();
      }
      return msg || fallback || "自动介绍失败";
    }

    function formatListError(err) {
      const msg = String((err && err.message) || err || "");
      if (isTransportUnavailable(msg) || /^client api:/i.test(msg) || /\/api\/trending\//i.test(msg)) {
        return formatPluginUnavailable();
      }
      return msg || "列表加载失败，请稍后重试";
    }

    async function sleep(ms) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function withTransportRetry(run) {
      let lastErr;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await run();
        } catch (err) {
          lastErr = err;
          const msg = String((err && err.message) || err || "");
          if (!isTransportUnavailable(msg) && !/^client api:/i.test(msg)) throw err;
          if (attempt === 2) throw err;
          await sleep(400 * (attempt + 1));
        }
      }
      throw lastErr;
    }

    function formatIntroFail(result, err) {
      const message = result && result.message ? String(result.message) : "";
      const errorText = result && result.error ? String(result.error) : "";
      const thrown = err ? String((err && err.message) || err) : "";
      const raw = message || errorText || thrown || "中文介绍生成失败，请稍后重试";
      if (isTransportUnavailable(raw) || /^client api:/i.test(raw) || /\/api\/trending\//i.test(raw)) {
        return formatPluginUnavailable();
      }
      if (/未找到默认模型|尚未选择默认模型|模型服务/i.test(raw)) {
        return "中文介绍生成失败：请先在 DeepSeek Harness 设置里配置并选择默认模型。";
      }
      return raw;
    }

    function DigestPanel({ api }) {
      ensureStyles();
      const [section, setSection] = useState("github_weekly");
      const [items, setItems] = useState([]);
      const [selectedId, setSelectedId] = useState("");
      const [loading, setLoading] = useState(false);
      const [translatingId, setTranslatingId] = useState("");
      const [introError, setIntroError] = useState("");
      const [imageLoading, setImageLoading] = useState(false);
      const [error, setError] = useState("");
      const selectedIdRef = useRef("");
      const introSeqRef = useRef(0);
      const introInflightRef = useRef("");
      const [quotaNote, setQuotaNote] = useState("");
      const [autoNote, setAutoNote] = useState("");
      const [autoEnabled, setAutoEnabled] = useState(true);
      const [autoRunning, setAutoRunning] = useState(false);
      const [autoBusy, setAutoBusy] = useState(false);
      const [fetchedAt, setFetchedAt] = useState("");
      const [mobileView, setMobileView] = useState("list");

      const selected = useMemo(
        () => items.find((it) => it.id === selectedId) || null,
        [items, selectedId],
      );

      useEffect(() => {
        selectedIdRef.current = selectedId;
      }, [selectedId]);

      const refresh = useCallback(async () => {
        if (!api || typeof api.listItems !== "function") {
          setError("热度服务未就绪，请稍后重试或重启应用");
          return;
        }
        setLoading(true);
        setError("");
        try {
          const result = await withTransportRetry(() => api.listItems({ section, limit: 10 }));
          const next = Array.isArray(result.items) ? result.items : [];
          setItems(next);
          setQuotaNote(result.quotaNote || "");
          setAutoNote(result.autoIntroNote || "");
          if (result.autoIntro && result.autoIntro.settings) {
            setAutoEnabled(result.autoIntro.settings.enabled !== false);
            setAutoRunning(!!(result.autoIntro.status && result.autoIntro.status.running));
          }
          setFetchedAt(
            result.fetchedAt
              ? `${result.fetchedAt}（${result.timezoneLabel || "北京时间"}）`
              : "",
          );
          setSelectedId((prev) => {
            if (prev && next.some((it) => it.id === prev)) return prev;
            return next[0] ? next[0].id : "";
          });
          setMobileView("list");
        } catch (err) {
          setError(formatListError(err));
        } finally {
          setLoading(false);
        }
      }, [api, section]);

      useEffect(() => {
        void refresh();
      }, [refresh]);

      const openItem = useCallback((id) => {
        setIntroError("");
        setSelectedId(id);
        setMobileView("article");
        // Re-opening a failed item should auto-try again without looping while it stays selected.
        setItems((prev) =>
          prev.map((it) =>
            it.id === id && it.chineseStatus === "error"
              ? { ...it, chineseStatus: "missing" }
              : it,
          ),
        );
      }, []);

      const ensureImage = useCallback(
        async (item) => {
          if (!item || !api || typeof api.resolveImage !== "function") return;
          if (item.imageUrl) return;
          if (item.imageStatus === "missing" || item.imageStatus === "ready") return;
          setImageLoading(true);
          try {
            const result = await api.resolveImage({ id: item.id });
            setItems((prev) =>
              prev.map((it) =>
                it.id === item.id
                  ? {
                      ...it,
                      imageUrl: result.imageUrl || "",
                      imageSource: result.imageSource || "",
                      imageStatus: result.imageStatus || "missing",
                    }
                  : it,
              ),
            );
          } catch (_err) {
            setItems((prev) =>
              prev.map((it) =>
                it.id === item.id
                  ? { ...it, imageUrl: "", imageStatus: "error" }
                  : it,
              ),
            );
          } finally {
            setImageLoading(false);
          }
        },
        [api],
      );

      useEffect(() => {
        if (!selected) return;
        void ensureImage(selected);
      }, [selected, ensureImage]);

      const generateIntro = useCallback(
        async (item, opts) => {
          const options = opts || {};
          const force = !!options.force;
          if (!item || !api || typeof api.translateItem !== "function") return;
          const hasReady =
            item.chineseStatus === "ready" && String(item.chineseDescription || "").trim();
          if (!force && hasReady) return;
          if (!force && introInflightRef.current === item.id) return;

          const targetId = item.id;
          const seq = introSeqRef.current + 1;
          introSeqRef.current = seq;
          introInflightRef.current = targetId;
          setTranslatingId(targetId);
          setIntroError("");

          const stillCurrent = () =>
            seq === introSeqRef.current && selectedIdRef.current === targetId;

          const maxAttempts = 2;
          let result = null;
          let lastErr = "";
          let attempts = 0;
          try {
            while (attempts < maxAttempts) {
              attempts += 1;
              try {
                result = await api.translateItem({ id: targetId, force });
                lastErr = "";
                if (!stillCurrent() && !(result && result.chineseStatus === "ready")) {
                  return;
                }
                if (result && result.chineseStatus === "ready" && result.chineseDescription) {
                  break;
                }
                lastErr = formatIntroFail(result, null);
                if (attempts < maxAttempts) continue;
              } catch (err) {
                result = null;
                lastErr = formatIntroFail(null, err);
                if (!stillCurrent()) return;
                if (attempts < maxAttempts) continue;
              }
            }

            if (result && result.chineseStatus === "ready" && result.chineseDescription) {
              setItems((prev) =>
                prev.map((it) =>
                  it.id === targetId
                    ? {
                        ...it,
                        chineseDescription: result.chineseDescription || "",
                        chineseStatus: result.chineseStatus || "ready",
                        chineseCached: !!result.chineseCached,
                      }
                    : it,
                ),
              );
              if (stillCurrent()) setIntroError("");
            } else {
              setItems((prev) =>
                prev.map((it) =>
                  it.id === targetId
                    ? {
                        ...it,
                        chineseDescription: "",
                        chineseStatus: "error",
                        chineseCached: false,
                      }
                    : it,
                ),
              );
              if (stillCurrent()) setIntroError(lastErr || "中文介绍生成失败，请稍后重试");
            }
          } finally {
            if (seq === introSeqRef.current) {
              setTranslatingId("");
              if (introInflightRef.current === targetId) {
                introInflightRef.current = "";
              }
            }
          }
        },
        [api],
      );

      useEffect(() => {
        if (!selected) return;
        if (selected.chineseStatus === "ready" && String(selected.chineseDescription || "").trim()) {
          setIntroError("");
          return;
        }
        if (selected.chineseStatus === "error") return;
        void generateIntro(selected, { force: false });
      }, [selectedId, selected, generateIntro]);

      const refreshAutoStatus = useCallback(async () => {
        if (!api || typeof api.getAutoIntroStatus !== "function") return;
        try {
          const result = await api.getAutoIntroStatus({});
          setAutoNote(result.note || "");
          if (result.settings) setAutoEnabled(result.settings.enabled !== false);
          const wasRunning = autoRunning;
          const nowRunning = !!(result.status && result.status.running);
          setAutoRunning(nowRunning);
          // When a background batch finishes, reload list so badges flip to 已有中文介绍.
          if (wasRunning && !nowRunning) {
            void refresh();
          }
        } catch (_err) {
          // ignore status poll errors
        }
      }, [api, autoRunning, refresh]);

      useEffect(() => {
        void refreshAutoStatus();
        const timer = setInterval(() => {
          void refreshAutoStatus();
        }, autoRunning ? 4000 : 20000);
        return () => clearInterval(timer);
      }, [refreshAutoStatus, autoRunning]);

      const toggleAutoIntro = useCallback(async () => {
        if (!api || typeof api.setAutoIntroSettings !== "function") return;
        setAutoBusy(true);
        setError("");
        try {
          const result = await api.setAutoIntroSettings({ enabled: !autoEnabled });
          setAutoEnabled(!!(result.settings && result.settings.enabled));
          setAutoNote(result.note || "");
          if (result.status) setAutoRunning(!!result.status.running);
        } catch (err) {
          setError(formatAutoIntroError(err, "无法更新自动生成设置"));
        } finally {
          setAutoBusy(false);
        }
      }, [api, autoEnabled]);

      const runAutoNow = useCallback(async () => {
        if (!api || typeof api.runAutoIntroNow !== "function") return;
        setAutoBusy(true);
        setError("");
        try {
          const result = await api.runAutoIntroNow({});
          setAutoNote(result.note || result.message || "");
          if (result.status) setAutoRunning(!!result.status.running);
          if (result.settings) setAutoEnabled(result.settings.enabled !== false);
          await refresh();
        } catch (err) {
          setError(formatAutoIntroError(err, "立即生成失败"));
        } finally {
          setAutoBusy(false);
          void refreshAutoStatus();
        }
      }, [api, refresh, refreshAutoStatus]);

      const rootClass =
        mobileView === "article" ? "td-root is-article" : "td-root is-list";

      return jsxs("div", {
        className: rootClass,
        children: [
          jsxs("div", {
            className: "td-toolbar",
            children: [
              jsxs("div", {
                className: "td-brand",
                children: [
                  jsx("div", { className: "td-brand-mark", children: jsx(FlameIcon, { size: 15 }) }),
                  jsxs("div", {
                    children: [
                      jsx("div", { className: "td-brand-title", children: "沙煲饭热点" }),
                      jsx("div", { className: "td-brand-sub", children: "GitHub热榜 · Product Hunt趋势 · Google Trend" }),
                    ],
                  }),
                ],
              }),
              jsx("div", {
                className: "td-pills",
                children: SECTION_OPTIONS.map((opt) =>
                  jsxs(
                    "button",
                    {
                      type: "button",
                      className: section === opt.key ? "td-pill is-on" : "td-pill",
                      onClick: () => setSection(opt.key),
                      "aria-pressed": section === opt.key,
                      children: [
                        jsx("span", { children: opt.emoji }),
                        " ",
                        opt.label,
                      ],
                    },
                    opt.key,
                  ),
                ),
              }),
              jsx("div", { className: "td-toolbar-spacer" }),
              jsx("button", {
                type: "button",
                className: autoEnabled ? "td-auto is-on" : "td-auto",
                disabled: autoBusy,
                title: "每天北京时间约 9:00 自动刷 GitHub热榜 / Product Hunt趋势 / Google Trend 并为条目生成中文介绍（会耗模型额度；已有缓存会跳过）",
                onClick: () => void toggleAutoIntro(),
                children: autoBusy
                  ? "设置中…"
                  : autoEnabled
                    ? "每日自动介绍：开"
                    : "每日自动介绍：关",
              }),
              jsx("button", {
                type: "button",
                className: "td-ghost",
                disabled: autoBusy || autoRunning,
                title: "立即为当前热榜批量生成缺失的中文介绍",
                onClick: () => void runAutoNow(),
                children: autoRunning ? "自动生成中…" : "立即生成今日介绍",
              }),
              jsx("button", {
                type: "button",
                className: "td-refresh",
                disabled: loading,
                onClick: () => void refresh(),
                children: loading ? "刷新中…" : "刷新列表",
              }),
            ],
          }),
          quotaNote || fetchedAt || autoNote
            ? jsxs("div", {
                className: "td-note",
                children: [
                  fetchedAt ? `更新于 ${fetchedAt}` : null,
                  fetchedAt && (quotaNote || autoNote) ? " · " : null,
                  quotaNote || null,
                  (quotaNote || fetchedAt) && autoNote ? jsx("br", {}) : null,
                  autoNote
                    ? jsxs(Fragment, {
                        children: [
                          jsx("strong", { children: "自动介绍" }),
                          "：",
                          autoNote,
                        ],
                      })
                    : null,
                ],
              })
            : null,
          error
            ? jsxs("div", {
                className: "td-note",
                style: { color: "#e5484d" },
                children: [error],
              })
            : null,
          jsxs("div", {
            className: "td-workarea",
            children: [
              jsx("div", {
                className: "td-list",
                children: loading && !items.length
                  ? jsx(SkeletonList, {})
                  : !items.length
                    ? jsxs("div", {
                        className: "td-empty",
                        children: [
                          jsx("h2", { children: "暂无项目" }),
                          jsx("p", { children: "当前板块暂无条目。请稍后再点「刷新列表」，或完全退出后重开 DeepSeek Harness。" }),
                        ],
                      })
                    : items.map((item) =>
                        jsxs(
                          "button",
                          {
                            type: "button",
                            className:
                              item.id === selectedId ? "td-row is-on" : "td-row",
                            onClick: () => openItem(item.id),
                            children: [
                              jsx("div", {
                                className: "td-rank",
                                children:
                                  item.rank <= 3
                                    ? ["🥇", "🥈", "🥉"][item.rank - 1]
                                    : String(item.rank),
                              }),
                              jsxs("div", {
                                children: [
                                  jsx("div", {
                                    className: "td-row-title",
                                    children: item.title,
                                  }),
                                  jsx("div", {
                                    className: "td-row-heat",
                                    children: item.heatLabel || "",
                                  }),
                                  jsx("div", {
                                    className: "td-row-desc",
                                    children: listPreview(item),
                                  }),
                                  jsx("span", {
                                    className:
                                      item.chineseStatus === "ready"
                                        ? "td-row-badge"
                                        : "td-row-badge missing",
                                    children:
                                      item.chineseStatus === "ready"
                                        ? "已有中文介绍"
                                        : item.chineseStatus === "error"
                                          ? "生成失败"
                                          : translatingId === item.id
                                            ? "正在生成…"
                                            : "打开后自动生成",
                                  }),
                                ],
                              }),
                            ],
                          },
                          item.id,
                        ),
                      ),
              }),
              jsx("div", { className: "td-split", "aria-hidden": true }),
              jsx("div", {
                className: "td-article",
                children: !selected
                  ? jsxs("div", {
                      className: "td-empty",
                      children: [
                        jsx("h2", { children: "选择一个项目" }),
                        jsx("p", { children: "左侧点选后，这里只显示该项目的一篇介绍。" }),
                      ],
                    })
                  : jsxs("div", {
                      className: "td-article-inner",
                      children: [
                        jsx("button", {
                          type: "button",
                          className: "td-ghost td-back",
                          onClick: () => setMobileView("list"),
                          children: "← 返回列表",
                        }),
                        jsxs("div", {
                          className: "td-article-head",
                          children: [
                            jsx("span", {
                              className: "td-article-rank",
                              children: `第 ${selected.rank} 名 · ${
                                SECTION_OPTIONS.find((s) => s.key === selected.section)?.label ||
                                ""
                              }`,
                            }),
                            selected.heatLabel
                              ? jsx("span", {
                                  className: "td-chip",
                                  children: jsx("strong", { children: selected.heatLabel }),
                                })
                              : null,
                            selected.language
                              ? jsx("span", {
                                  className: "td-chip",
                                  children: selected.language,
                                })
                              : null,
                            selected.dateLabel
                              ? jsx("span", {
                                  className: "td-chip",
                                  children: selected.dateLabel,
                                })
                              : null,
                          ],
                        }),
                        jsx("h1", {
                          className: "td-article-title",
                          children: selected.title,
                        }),
                        jsx(HeroImage, {
                          url: selected.imageUrl || "",
                          loading: imageLoading && !selected.imageUrl,
                          status: selected.imageStatus || "",
                        }),
                        translatingId === selected.id &&
                        !(selected.chineseStatus === "ready" && selected.chineseDescription)
                          ? jsxs("div", {
                              className: "td-prose placeholder is-loading",
                              children: [
                                jsx("p", { children: "正在生成中文介绍…" }),
                                jsx("p", {
                                  children:
                                    "正在结合榜单资料撰写带小标题的介绍，请稍候。已有缓存的条目不会重复消耗额度。",
                                }),
                                jsx("div", {
                                  className: "td-skel td-skel-line",
                                  style: { margin: "18px 0 10px" },
                                }),
                                jsx("div", {
                                  className: "td-skel td-skel-line",
                                  style: { width: "86%" },
                                }),
                                jsx("div", {
                                  className: "td-skel td-skel-line",
                                  style: { width: "72%" },
                                }),
                              ],
                            })
                          : selected.chineseStatus === "ready" && selected.chineseDescription
                            ? renderIntroBody(selected.chineseDescription)
                            : introError || selected.chineseStatus === "error"
                              ? jsxs("div", {
                                  className: "td-intro-error",
                                  children: [
                                    jsx("strong", { children: "介绍生成失败" }),
                                    jsx("p", {
                                      children: introError || "中文介绍生成失败，请稍后重试",
                                    }),
                                  ],
                                })
                              : renderIntroBody("", "正在准备中文介绍…"),
                        jsxs("div", {
                          className: "td-actions",
                          children: [
                            selected.chineseStatus === "ready" && selected.chineseDescription
                              ? jsx("button", {
                                  type: "button",
                                  className: "td-ghost",
                                  disabled: translatingId === selected.id,
                                  title: "重新调用已配置模型生成介绍（会消耗额度）",
                                  onClick: () => void generateIntro(selected, { force: true }),
                                  children: translatingId === selected.id ? "正在生成…" : "重新生成",
                                })
                              : introError || selected.chineseStatus === "error"
                                ? jsx("button", {
                                    type: "button",
                                    className: "td-ghost",
                                    disabled: translatingId === selected.id,
                                    onClick: () => void generateIntro(selected, { force: false }),
                                    children: translatingId === selected.id ? "正在生成…" : "重试",
                                  })
                                : null,
                            selected.url
                              ? jsx("a", {
                                  className: "td-link",
                                  href: selected.url,
                                  target: "_blank",
                                  rel: "noreferrer noopener",
                                  children: "查看原项目",
                                })
                              : null,
                          ],
                        }),
                      ],
                    }),
              }),
            ],
          }),
        ],
      });
    }

    const inject = ["slots", "layout", "remote"];

    async function apply(ctx) {
      try {
        await ctx.remote.$mount(TYPERT_REMOTE);
      } catch (error) {
        ctx.logger?.error?.(
          "dsh-trending-digest: failed to mount trending Remote: %o",
          error,
        );
        throw error;
      }
      ctx.inject([`remote.${SERVICE}`], (child) => registerPanel(child));
    }

    function registerPanel(ctx) {
      const call = async (methodName, args) => {
        const namespace = ctx.remote[SERVICE];
        if (!namespace || typeof namespace[methodName] !== "function") {
          throw new Error("热度服务未就绪，请稍后重试");
        }
        const result = await namespace[methodName](args == null ? {} : args);
        if (result.ok) return result.value;
        throw result.error;
      };
      const api = {
        getDigest: (params) => call("getDigest", params),
        listItems: (params) => call("listItems", params),
        getItem: (params) => call("getItem", params),
        translateItem: (params) => call("translateItem", params),
        resolveImage: (params) => call("resolveImage", params),
        getAutoIntroStatus: (params) => call("getAutoIntroStatus", params),
        setAutoIntroSettings: (params) => call("setAutoIntroSettings", params),
        runAutoIntroNow: (params) => call("runAutoIntroNow", params),
      };
      ctx.slots.inject("main", () =>
        ctx.slots.register(
          { name: "main", key: PANEL_ID, inject: () => ({ api }) },
          DigestPanel,
        ),
      );
      ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register(
          {
            name: "sidebar.panellist",
            id: PANEL_ID,
            order: 16,
            label: "沙煲饭热点",
          },
          DigestIcon,
        ),
      );
    }

    exports.PANEL_ID = PANEL_ID;
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
