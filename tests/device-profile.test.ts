import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyDevice,
  defaultEngineFor,
  getProfile,
  PROFILES,
} from "../lib/device-profile";

function mockNavigator(overrides: Record<string, unknown>) {
  const nav = { userAgent: "", maxTouchPoints: 0, hardwareConcurrency: 8, ...overrides };
  vi.stubGlobal("navigator", nav);
  return nav;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("profile table (design doc §c)", () => {
  it("chunk sizes are 400 / 300 / 200", () => {
    expect(PROFILES.performance.chunkChars).toBe(400);
    expect(PROFILES.balanced.chunkChars).toBe(300);
    expect(PROFILES.compatibility.chunkChars).toBe(200);
  });

  it("stream high-water marks are 4 / 3 / 2", () => {
    expect(PROFILES.performance.streamHighWater).toBe(4);
    expect(PROFILES.balanced.streamHighWater).toBe(3);
    expect(PROFILES.compatibility.streamHighWater).toBe(2);
  });

  it("COMPATIBILITY forces a single ORT thread + same-origin WASM", () => {
    expect(PROFILES.compatibility.ortThreads).toBe(1);
    expect(PROFILES.compatibility.ortWasmBase).toBe("same-origin");
  });

  it("getProfile returns the table entry", () => {
    expect(getProfile("balanced")).toBe(PROFILES.balanced);
  });
});

describe("defaultEngineFor", () => {
  it("kokoro on performance/balanced, system on compatibility", () => {
    expect(defaultEngineFor(PROFILES.performance)).toBe("kokoro");
    expect(defaultEngineFor(PROFILES.balanced)).toBe("kokoro");
    expect(defaultEngineFor(PROFILES.compatibility)).toBe("system");
  });
});

describe("classifyDevice", () => {
  it("iPhone UA → compatibility", async () => {
    mockNavigator({
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15",
    });
    expect(await classifyDevice()).toBe(PROFILES.compatibility);
  });

  it("iPadOS (Mac UA + touch) → compatibility", async () => {
    mockNavigator({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15",
      maxTouchPoints: 5,
    });
    expect(await classifyDevice()).toBe(PROFILES.compatibility);
  });

  it("desktop with a working WebGPU adapter → performance", async () => {
    mockNavigator({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
      gpu: { requestAdapter: async () => ({}) },
    });
    expect(await classifyDevice()).toBe(PROFILES.performance);
  });

  it("desktop without a usable adapter → balanced", async () => {
    mockNavigator({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
      gpu: { requestAdapter: async () => null },
    });
    expect(await classifyDevice()).toBe(PROFILES.balanced);
  });

  it("explicit low deviceMemory (<=2 GB) → compatibility", async () => {
    mockNavigator({
      userAgent: "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36",
      deviceMemory: 2,
    });
    expect(await classifyDevice()).toBe(PROFILES.compatibility);
  });

  it("unknown deviceMemory is not treated as capable (stays balanced)", async () => {
    mockNavigator({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    });
    expect(await classifyDevice()).toBe(PROFILES.balanced);
  });
});
