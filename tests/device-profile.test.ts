import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROFILES,
  classifyDevice,
  classifySignals,
  defaultEngineFor,
  getProfile,
  isIOSDevice,
  isMobileDevice,
  type DeviceProfile,
  type DeviceSignals,
} from "../lib/device-profile";

const DESKTOP_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_IOS26_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const IPAD_MASKED_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

function signals(over: Partial<DeviceSignals> = {}): DeviceSignals {
  return {
    userAgent: DESKTOP_UA,
    maxTouchPoints: 0,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    hasWebGpuApi: false,
    webGpuAdapter: null,
    ...over,
  };
}

function mockNavigator(overrides: Record<string, unknown>) {
  const nav = {
    userAgent: "",
    maxTouchPoints: 0,
    hardwareConcurrency: 8,
    ...overrides,
  };
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

  it("kokoro device/dtype policy per profile", () => {
    expect(PROFILES.performance.kokoroPolicy).toEqual({ device: "webgpu", dtype: "fp32" });
    expect(PROFILES.balanced.kokoroPolicy).toEqual({ device: "wasm", dtype: "q8" });
    expect(PROFILES.compatibility.kokoroPolicy).toEqual({ device: "wasm", dtype: "q8" });
  });

  it("getProfile returns an equal copy", () => {
    expect(getProfile("balanced")).toEqual(PROFILES.balanced);
    const a = getProfile("balanced");
    a.chunkChars = 1;
    expect(getProfile("balanced").chunkChars).toBe(300);
  });
});

describe("isIOSDevice (pure)", () => {
  it("detects iPhone / iPad / iPod tokens", () => {
    expect(isIOSDevice(IPHONE_UA)).toBe(true);
    expect(isIOSDevice("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe(true);
    expect(isIOSDevice("Mozilla/5.0 (iPod touch; CPU iPhone OS 16_0 like Mac OS X)")).toBe(true);
  });
  it("detects iPadOS 13+ masquerading as Mac via touch points", () => {
    expect(isIOSDevice(IPAD_MASKED_UA, 5)).toBe(true);
  });
  it("does not flag a real Mac without touch", () => {
    expect(isIOSDevice(IPAD_MASKED_UA, 0)).toBe(false);
  });
  it("does not flag desktop Linux / Android", () => {
    expect(isIOSDevice(DESKTOP_UA)).toBe(false);
    expect(isIOSDevice(ANDROID_UA)).toBe(false);
  });
});

describe("isMobileDevice (pure)", () => {
  it("flags Android and iPhone, not desktop", () => {
    expect(isMobileDevice(ANDROID_UA)).toBe(true);
    expect(isMobileDevice(IPHONE_UA)).toBe(true);
    expect(isMobileDevice(DESKTOP_UA)).toBe(false);
  });
});

describe("classifySignals (pure)", () => {
  it("iOS (any version) → compatibility, even with a WebGPU adapter", () => {
    // iOS 26 Safari exposes WebGPU, but the ORT WebGPU EP is broken there
    // (microsoft/onnxruntime#26827) — never performance on iOS.
    expect(
      classifySignals(
        signals({ userAgent: IPHONE_IOS26_UA, hasWebGpuApi: true, webGpuAdapter: {} }),
      ),
    ).toBe("compatibility");
    expect(classifySignals(signals({ userAgent: IPHONE_UA }))).toBe("compatibility");
    expect(
      classifySignals(signals({ userAgent: IPAD_MASKED_UA, maxTouchPoints: 5 })),
    ).toBe("compatibility");
  });
  it("desktop + working adapter → performance", () => {
    expect(
      classifySignals(signals({ webGpuAdapter: {}, hasWebGpuApi: true })),
    ).toBe("performance");
  });
  it("desktop, no adapter → balanced", () => {
    expect(classifySignals(signals())).toBe("balanced");
  });
  it("explicit low deviceMemory (≤2 GB) → compatibility", () => {
    expect(classifySignals(signals({ deviceMemory: 2 }))).toBe("compatibility");
    expect(classifySignals(signals({ deviceMemory: 1 }))).toBe("compatibility");
  });
  it("unknown deviceMemory stays balanced (absence is not low)", () => {
    expect(classifySignals(signals({ deviceMemory: undefined }))).toBe("balanced");
  });
  it("capable Android (adapter) → balanced", () => {
    expect(
      classifySignals(
        signals({
          userAgent: ANDROID_UA,
          webGpuAdapter: {},
          hasWebGpuApi: true,
          deviceMemory: 8,
        }),
      ),
    ).toBe("balanced");
  });
  it("Android without adapter and unknown memory → balanced (capable Android)", () => {
    expect(
      classifySignals(signals({ userAgent: ANDROID_UA, deviceMemory: undefined })),
    ).toBe("balanced");
  });
  it("Android without adapter but explicitly low memory → compatibility", () => {
    expect(
      classifySignals(signals({ userAgent: ANDROID_UA, deviceMemory: 2 })),
    ).toBe("compatibility");
  });
});

describe("defaultEngineFor", () => {
  const profile = (name: DeviceProfile["name"], isMobile: boolean): DeviceProfile => ({
    ...getProfile(name),
    isMobile,
  });
  it("performance → kokoro", () => {
    expect(defaultEngineFor(profile("performance", false))).toBe("kokoro");
  });
  it("balanced desktop → kokoro", () => {
    expect(defaultEngineFor(profile("balanced", false))).toBe("kokoro");
  });
  it("balanced mobile (capable Android) → system", () => {
    // Phones default to system voices: the KittenTTS Nano phone engine was
    // removed at the user's request on 2026-11-04.
    expect(defaultEngineFor(profile("balanced", true))).toBe("system");
  });
  it("compatibility → system (iOS / low-memory)", () => {
    expect(defaultEngineFor(profile("compatibility", false))).toBe("system");
    expect(defaultEngineFor(profile("compatibility", true))).toBe("system");
  });
});

describe("classifyDevice (async, mocked navigator)", () => {
  it("iPhone UA → compatibility", async () => {
    mockNavigator({ userAgent: IPHONE_IOS26_UA });
    expect((await classifyDevice()).name).toBe("compatibility");
  });

  it("iPadOS (Mac UA + touch) → compatibility", async () => {
    mockNavigator({ userAgent: IPAD_MASKED_UA, maxTouchPoints: 5 });
    expect((await classifyDevice()).name).toBe("compatibility");
  });

  it("desktop with a working WebGPU adapter → performance", async () => {
    mockNavigator({
      userAgent: DESKTOP_UA,
      gpu: { requestAdapter: async () => ({}) },
    });
    const p = await classifyDevice();
    expect(p.name).toBe("performance");
    expect(p.isMobile).toBe(false);
    expect(p.defaultEngine).toBe("kokoro");
  });

  it("desktop without a usable adapter → balanced", async () => {
    mockNavigator({
      userAgent: DESKTOP_UA,
      gpu: { requestAdapter: async () => null },
    });
    expect((await classifyDevice()).name).toBe("balanced");
  });

  it("explicit low deviceMemory (<=2 GB) → compatibility", async () => {
    mockNavigator({ userAgent: ANDROID_UA, deviceMemory: 2 });
    expect((await classifyDevice()).name).toBe("compatibility");
  });

  it("unknown deviceMemory is not treated as low (stays balanced)", async () => {
    mockNavigator({ userAgent: DESKTOP_UA });
    expect((await classifyDevice()).name).toBe("balanced");
  });

  it("capable Android without adapter → balanced with system default", async () => {
    mockNavigator({ userAgent: ANDROID_UA });
    const p = await classifyDevice();
    expect(p.name).toBe("balanced");
    expect(p.isMobile).toBe(true);
    expect(p.defaultEngine).toBe("system");
  });
});
