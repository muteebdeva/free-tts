/**
 * Model cache management (Cache Storage API).
 *
 * The neural engine stores downloaded assets in two Cache API stores:
 *  - "transformers-cache" — model weights, tokenizer, config (transformers.js)
 *  - "kokoro-voices"      — per-voice embedding files (kokoro-js)
 *  - "kitten-tts"         — KittenTTS Nano model + voices.npz (kitten engine)
 *
 * These are the ONLY persistent artifacts the app keeps. Generated audio is
 * never persisted (only held in memory until the user downloads it).
 */

export const MODEL_CACHES = ["transformers-cache", "kokoro-voices", "kitten-tts"] as const;

export interface CacheInfo {
  name: string;
  entries: number;
  /** Total bytes, or null when the size is unknown. */
  bytes: number | null;
}

function supported(): boolean {
  return typeof window !== "undefined" && "caches" in window;
}

/** List model caches with entry counts and best-effort byte totals. */
export async function listModelCaches(): Promise<CacheInfo[]> {
  if (!supported()) return [];
  const out: CacheInfo[] = [];
  for (const name of MODEL_CACHES) {
    try {
      const cache = await caches.open(name);
      const keys = await cache.keys();
      let bytes: number | null = 0;
      for (const req of keys) {
        const res = await cache.match(req);
        const len = res?.headers.get("content-length");
        if (len) {
          bytes += parseInt(len, 10);
        } else {
          bytes = null; // unknown — don't present a partial sum as fact
          break;
        }
      }
      out.push({ name, entries: keys.length, bytes });
    } catch {
      out.push({ name, entries: 0, bytes: null });
    }
  }
  return out;
}

/** Delete all model caches. The model re-downloads on next use. */
export async function deleteModelCaches(): Promise<void> {
  if (!supported()) return;
  await Promise.all(MODEL_CACHES.map((name) => caches.delete(name).catch(() => false)));
}

/** Browser storage estimate (usage/quota), or null when unavailable. */
export async function estimateStorage(): Promise<{
  usage: number;
  quota: number;
} | null> {
  try {
    const est = await navigator.storage.estimate();
    if (typeof est.usage === "number" && typeof est.quota === "number") {
      return { usage: est.usage, quota: est.quota };
    }
    return null;
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
