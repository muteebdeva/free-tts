import { describe, expect, it } from "vitest";
import {
  clearGenerateFlag,
  consumeStaleGenerateFlag,
  markGenerateStart,
} from "../lib/jetsam-sentinel";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}

describe("jetsam sentinel", () => {
  it("reports no stale flag on a clean load", () => {
    expect(consumeStaleGenerateFlag(memoryStorage())).toBe(false);
  });

  it("detects an interrupted generation exactly once", () => {
    const s = memoryStorage();
    markGenerateStart(s);
    expect(consumeStaleGenerateFlag(s)).toBe(true);
    // Consumed — the notice must not repeat.
    expect(consumeStaleGenerateFlag(s)).toBe(false);
  });

  it("a clean completion clears the flag", () => {
    const s = memoryStorage();
    markGenerateStart(s);
    clearGenerateFlag(s);
    expect(consumeStaleGenerateFlag(s)).toBe(false);
  });

  it("tolerates missing storage without throwing", () => {
    expect(() => markGenerateStart(undefined)).not.toThrow();
    expect(() => clearGenerateFlag(undefined)).not.toThrow();
    expect(consumeStaleGenerateFlag(undefined)).toBe(false);
  });
});
