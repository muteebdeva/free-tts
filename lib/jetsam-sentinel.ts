/**
 * Jetsam sentinel (docs/PROPOSED-ARCHITECTURE.md §e).
 *
 * A flag is set in sessionStorage when generation starts and cleared when it
 * completes (ready / error / user cancel / model unload). If the flag is
 * still set on page load, the previous tab died mid-generate — on iOS this
 * is the signature of a jetsam (memory) kill — so the Studio shows a
 * one-time honest notice instead of a blank slate.
 *
 * Platform note: sessionStorage survives reloads within a tab and crash
 * restores on desktop Chromium/Firefox; iOS Safari may clear it on a
 * jetsam-driven tab restore, in which case the notice simply doesn't appear
 * (no false positive — absence of the flag never claims anything).
 * The flag is consumed (cleared) on read so the notice shows at most once.
 */
const FLAG_KEY = "freetts:generate-active";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | undefined {
  try {
    if (typeof sessionStorage !== "undefined") return sessionStorage;
  } catch {
    // Storage access can throw (e.g. blocked third-party contexts).
  }
  return undefined;
}

/** Mark a generation as in-flight. Call when the user starts Generate. */
export function markGenerateStart(storage: StorageLike | undefined = defaultStorage()): void {
  try {
    storage?.setItem(FLAG_KEY, String(Date.now()));
  } catch {
    // Non-fatal: the sentinel is best-effort.
  }
}

/** Clear the flag — every clean completion path must call this. */
export function clearGenerateFlag(storage: StorageLike | undefined = defaultStorage()): void {
  try {
    storage?.removeItem(FLAG_KEY);
  } catch {
    // Non-fatal.
  }
}

/**
 * Returns true when a previous generation was interrupted (stale flag
 * present), and clears the flag so the notice is one-time.
 */
export function consumeStaleGenerateFlag(
  storage: StorageLike | undefined = defaultStorage(),
): boolean {
  try {
    if (!storage) return false;
    const stale = storage.getItem(FLAG_KEY) !== null;
    if (stale) storage.removeItem(FLAG_KEY);
    return stale;
  } catch {
    return false;
  }
}
