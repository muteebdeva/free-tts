/**
 * Device-aware engine ladder (Track A).
 *
 * Classifies the device once per page load into PERFORMANCE / BALANCED /
 * COMPATIBILITY and picks the default engine + Kokoro ORT configuration.
 * The ladder only sets the DEFAULT and gates what is offered — the user can
 * always override.
 *
 * CONTRACT (extends the Track B interim — additive only):
 *  - `classifyDevice(): Promise<DeviceProfile>` — async, reads the real
 *    navigator (8s adapter timeout), classifies once per page load.
 *  - `classifySignals(signals): DeviceProfileName` — PURE classifier over
 *    injected signals; unit-testable with a mocked navigator.
 *  - `isIOSDevice(userAgent, maxTouchPoints)` / `isMobileDevice(userAgent)` —
 *    PURE UA helpers (also used by engines/kokoro for the iOS 26 force-WASM
 *    rule).
 *  - `defaultEngineFor(profile): EngineId` — ladder default. EngineId now
 *    includes "kitten" (Track B: EngineChoice/applyEngineChoice must accept
 *    it — capable-Android devices now default to the KittenTTS Nano neural
 *    engine instead of system voices).
 *  - `PROFILES` / `getProfile(name)` — the per-profile parameter table
 *    (chunkChars, streamHighWater, ORT thread policy, WASM binary policy).
 *    Shape unchanged from the interim version.
 *  - `DeviceProfile.kokoroPolicy` (NEW, additive) — the device/dtype policy
 *    the worker injects into KokoroEngine instead of the engine
 *    self-detecting.
 *
 * Profiles (per docs/PROPOSED-ARCHITECTURE.md §(a) and §(c)):
 *  PERFORMANCE   desktop + working WebGPU adapter → kokoro fp32 default
 *  BALANCED      desktop CPU / capable Android      → kokoro q8 default
 *                (mobile: kitten nano default — the gated opt-up, graduated
 *                after the real-audio gate passed; see docs/KITTEN-SPIKE.md)
 *  COMPATIBILITY iOS (any version), low-memory      → system voices default;
 *                neural engines stay available as opt-ins
 */

export type DeviceProfileName = "performance" | "balanced" | "compatibility";
export type EngineId = "kokoro" | "system" | "kitten";

/** Device/dtype policy injected into KokoroEngine (from the profile). */
export interface KokoroDevicePolicy {
  device: "webgpu" | "wasm";
  dtype: "fp32" | "q8";
}

export interface DeviceProfile {
  name: DeviceProfileName;
  label: string;
  /** Sentence-chunk budget (chars) — smaller = faster first audio, smaller transients. */
  chunkChars: number;
  /** Streaming high-water mark: max unacknowledged chunks before backpressure. */
  streamHighWater: number;
  /**
   * ORT WASM thread count applied before session creation.
   * 0 = leave the vendored default (min(4, ceil(hardwareConcurrency/2))).
   */
  ortThreads: number;
  /**
   * Which WASM binaries the worker should point env.wasmPaths at.
   * "default"     → leave unset (transformers.js default: jsdelivr CDN).
   * "same-origin" → "/ort/" (shipped under public/ort/ — no CDN dependency).
   */
  ortWasmBase: "default" | "same-origin";
  /** Device/dtype policy for KokoroEngine — injected, not self-detected. */
  kokoroPolicy: KokoroDevicePolicy;
  /** True for phones/tablets (Android/iOS); drives the kitten-mobile default. */
  isMobile: boolean;
  defaultEngine: EngineId;
  /** Honest one-liner shown in the Studio for this profile. */
  blurb: string;
}

/**
 * Raw signals the classifier consumes. `deviceMemory` is Chromium-only and
 * `undefined` on iOS/Safari/Firefox — absence means "unknown", NEVER
 * "capable": only an explicit low reading forces COMPATIBILITY on memory
 * grounds.
 */
export interface DeviceSignals {
  userAgent: string;
  maxTouchPoints: number;
  hardwareConcurrency: number | undefined;
  /** GB, when reported (Chromium-only). */
  deviceMemory: number | undefined;
  hasWebGpuApi: boolean;
  /**
   * Result of `navigator.gpu.requestAdapter()` (with timeout): a truthy
   * value means a usable adapter; null/undefined/false means none.
   */
  webGpuAdapter: unknown;
}

/** Pure iOS/iPadOS check: UA token, or Mac + touch (iPadOS 13+ masks as Mac). */
export function isIOSDevice(userAgent: string, maxTouchPoints = 0): boolean {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true;
  return /Mac/.test(userAgent) && maxTouchPoints > 1;
}

/** Pure mobile check (phones/tablets, any OS). */
export function isMobileDevice(userAgent: string): boolean {
  return /Android|iPad|iPhone|iPod|Mobile|Tablet/.test(userAgent);
}

/**
 * Pure classifier: signals → profile name. No navigator access — feed it
 * mocked signals in unit tests.
 *
 * Order matters:
 *  1. iOS (any version) → compatibility. iOS 26 Safari exposes WebGPU, but
 *     the onnxruntime WebGPU EP is broken there (microsoft/onnxruntime#26827),
 *     so neural-on-WebGPU is never the default on iOS.
 *  2. Working WebGPU adapter on desktop → performance; on mobile → balanced
 *     (a phone adapter is "capable Android", not a desktop GPU).
 *  3. Explicitly low memory (deviceMemory ≤ 2 GB) → compatibility, with or
 *     without an adapter gap — Kokoro-class models thrash there.
 *  4. Desktop CPU → balanced. Mobile without adapter → balanced when not
 *     low-memory ("capable Android"), else compatibility.
 */
export function classifySignals(signals: DeviceSignals): DeviceProfileName {
  const ios = isIOSDevice(signals.userAgent, signals.maxTouchPoints);
  if (ios) return "compatibility";
  const mobile = isMobileDevice(signals.userAgent);
  const adapter = !!signals.webGpuAdapter;
  if (adapter && !mobile) return "performance";
  if (adapter && mobile) return "balanced";
  const lowMem =
    typeof signals.deviceMemory === "number" && signals.deviceMemory <= 2;
  if (lowMem) return "compatibility";
  return "balanced";
}

function buildProfile(name: DeviceProfileName, isMobile: boolean): DeviceProfile {
  const base = PROFILES[name];
  const profile: DeviceProfile = { ...base, isMobile };
  profile.defaultEngine = defaultEngineFor(profile);
  return profile;
}

export const PROFILES: Record<DeviceProfileName, DeviceProfile> = {
  performance: {
    name: "performance",
    label: "Performance",
    chunkChars: 400,
    streamHighWater: 4,
    ortThreads: 0,
    ortWasmBase: "default",
    kokoroPolicy: { device: "webgpu", dtype: "fp32" },
    isMobile: false,
    defaultEngine: "kokoro",
    blurb: "WebGPU detected — high-quality neural voices, fastest synthesis.",
  },
  balanced: {
    name: "balanced",
    label: "Balanced",
    chunkChars: 300,
    streamHighWater: 3,
    ortThreads: 0,
    ortWasmBase: "default",
    kokoroPolicy: { device: "wasm", dtype: "q8" },
    isMobile: false,
    defaultEngine: "kokoro",
    blurb:
      "CPU synthesis — neural voices work but run slower than real time on long texts.",
  },
  compatibility: {
    name: "compatibility",
    label: "Compatibility",
    chunkChars: 200,
    streamHighWater: 2,
    ortThreads: 1,
    ortWasmBase: "same-origin",
    kokoroPolicy: { device: "wasm", dtype: "q8" },
    isMobile: false,
    defaultEngine: "system",
    blurb:
      "This device is on the compatibility path: system voices are the default " +
      "because neural synthesis needs a download and runs slower than real " +
      "time here. KittenTTS Nano and Kokoro stay available as opt-ins — " +
      "no hidden downgrade.",
  },
};

export function getProfile(name: DeviceProfileName): DeviceProfile {
  return { ...PROFILES[name] };
}

/**
 * The ladder default for a profile.
 *  - performance → kokoro (WebGPU fp32, the quality king)
 *  - balanced + desktop → kokoro (q8 on CPU — current behavior)
 *  - balanced + mobile → kitten (KittenTTS Nano: 27 MB vs Kokoro's 92 MB,
 *    measured ~2.1× slower than real-time on CPU — the best neural default
 *    for a phone; graduated from "opt-in only" after the real-audio gate
 *    passed — docs/KITTEN-SPIKE.md)
 *  - compatibility → system (iOS / low-memory: instant, zero download)
 */
export function defaultEngineFor(profile: DeviceProfile): EngineId {
  if (profile.name === "performance") return "kokoro";
  if (profile.name === "balanced") return profile.isMobile ? "kitten" : "kokoro";
  return "system";
}

/**
 * Verify a usable WebGPU adapter exists (async, 8 s timeout) — the same
 * resolveDevice() pattern as engines/kokoro. Presence of `navigator.gpu`
 * does NOT imply a usable adapter (headless Chromium, VMs, some mobiles).
 */
async function resolveAdapter(): Promise<unknown> {
  if (typeof navigator === "undefined") return null;
  const gpu = (
    navigator as Navigator & {
      gpu?: { requestAdapter?: (options?: object) => Promise<unknown> };
    }
  ).gpu;
  if (!gpu?.requestAdapter) return null;
  try {
    return await Promise.race([
      gpu.requestAdapter(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
  } catch {
    return null;
  }
}

function readSignals(adapter: unknown): DeviceSignals {
  if (typeof navigator === "undefined") {
    return {
      userAgent: "",
      maxTouchPoints: 0,
      hardwareConcurrency: undefined,
      deviceMemory: undefined,
      hasWebGpuApi: false,
      webGpuAdapter: null,
    };
  }
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    gpu?: unknown;
  };
  return {
    userAgent: nav.userAgent || "",
    maxTouchPoints:
      typeof nav.maxTouchPoints === "number" ? nav.maxTouchPoints : 0,
    hardwareConcurrency:
      typeof nav.hardwareConcurrency === "number"
        ? nav.hardwareConcurrency
        : undefined,
    deviceMemory:
      typeof nav.deviceMemory === "number" ? nav.deviceMemory : undefined,
    hasWebGpuApi: !!nav.gpu,
    webGpuAdapter: adapter,
  };
}

/**
 * Classify the device once per page load (async — the WebGPU adapter check
 * needs a round-trip). Call once, reuse the result.
 */
export async function classifyDevice(): Promise<DeviceProfile> {
  const adapter = await resolveAdapter();
  const signals = readSignals(adapter);
  const name = classifySignals(signals);
  return buildProfile(name, isMobileDevice(signals.userAgent));
}
