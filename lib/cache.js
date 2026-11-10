/**
 * Persistent translation cache under DSH home storages.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";

function cachePath() {
  return join(resolveDshHome(), "storages", "dsh-trending-digest", "translations.json");
}

/** Bump with intro prompt/style changes to invalidate on-disk cache. */
export const CACHE_SCHEMA_VERSION = "v3-sections-20261108";

export function contentHash(sourceText) {
  return createHash("sha256").update(String(sourceText || ""), "utf8").digest("hex").slice(0, 24);
}

export function cacheKey(itemId, sourceText) {
  return `${itemId}#${CACHE_SCHEMA_VERSION}#${contentHash(sourceText)}`;
}

export class TranslationCache {
  constructor(logger) {
    this.logger = logger;
    this.path = cachePath();
    /** @type {Map<string, { chinese: string, sourceHash: string, title?: string, updatedAt: string }>} */
    this.map = new Map();
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
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const [key, value] of Object.entries(parsed)) {
            if (value && typeof value.chinese === "string") {
              this.map.set(key, value);
            }
          }
        }
        this.loaded = true;
      })
      .catch((error) => {
        if (error?.code !== "ENOENT") {
          this.logger?.warn?.(
            "dsh-trending-digest: translation cache read failed: %o",
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

  get(itemId, sourceText) {
    const key = cacheKey(itemId, sourceText);
    const hit = this.map.get(key);
    if (!hit) return null;
    return { ...hit, key, cached: true };
  }

  set(itemId, sourceText, chinese, title) {
    const key = cacheKey(itemId, sourceText);
    this.map.set(key, {
      chinese: String(chinese || "").trim(),
      sourceHash: contentHash(sourceText),
      title: title || "",
      updatedAt: new Date().toISOString(),
    });
    this.dirty = true;
    this.touch();
    return key;
  }

  /** Remove all entries for an item id (any source hash). */
  deleteByItemId(itemId) {
    const prefix = `${itemId}#`;
    let removed = 0;
    for (const key of [...this.map.keys()]) {
      if (key.startsWith(prefix)) {
        this.map.delete(key);
        removed += 1;
      }
    }
    if (removed) {
      this.dirty = true;
      this.touch();
    }
    return removed;
  }

  /** Wipe entire cache (e.g. after prompt style upgrade). */
  clearAll() {
    if (!this.map.size) return 0;
    const n = this.map.size;
    this.map.clear();
    this.dirty = true;
    this.touch();
    return n;
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
        await writeFile(temp, JSON.stringify(Object.fromEntries(this.map)), {
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


function imageCachePath() {
  return join(resolveDshHome(), "storages", "dsh-trending-digest", "images.json");
}

/**
 * Lightweight URL cache for project preview images.
 * Keyed by item id; stores url + source + updatedAt.
 */
export class ImageCache {
  constructor(logger) {
    this.logger = logger;
    this.path = imageCachePath();
    /** @type {Map<string, { url: string, source: string, status: string, updatedAt: string }>} */
    this.map = new Map();
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
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const [key, value] of Object.entries(parsed)) {
            if (value && typeof value.url === "string") {
              this.map.set(key, value);
            }
          }
        }
        this.loaded = true;
      })
      .catch((error) => {
        if (error?.code !== "ENOENT") {
          this.logger?.warn?.(
            "dsh-trending-digest: image cache read failed: %o",
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

  get(itemId) {
    const hit = this.map.get(String(itemId || ""));
    if (!hit || !hit.url) return null;
    return { ...hit, cached: true };
  }

  set(itemId, url, source, status) {
    const id = String(itemId || "");
    if (!id) return;
    this.map.set(id, {
      url: String(url || "").trim(),
      source: String(source || ""),
      status: String(status || (url ? "ready" : "missing")),
      updatedAt: new Date().toISOString(),
    });
    this.dirty = true;
    this.touch();
  }

  /** Record a negative cache so we do not hammer sources. */
  setMissing(itemId) {
    this.set(itemId, "", "", "missing");
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
        await writeFile(temp, JSON.stringify(Object.fromEntries(this.map)), {
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
