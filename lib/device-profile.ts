/**
 * Device profiles (Track B interim implementation — Track A owns this file).
 *
 * CONTRACT (do not break without coordinating with Track B):
 *  - `classifyDevice(): Promise<DeviceProfile>` — classifies once per page load.
 *  - `defaultEngineFor(profile: DeviceProfile): "kokoro" | "system"` — ladder default.
 *  - `PROFILES` / `getProfile(name)` — the per-profile parameter table
 *    (chunkChars, streamHighWater, ORT thread policy, WASM binary policy).
 * Track A may replace the classifier internals freely; the exported API and
 * the profile table shape must stay compatible with lib/engine-manager.ts,
 * workers/tts.worker.ts, and components/tts-provider.tsx.
 *
 * Profiles (per docs/PROPOSED-ARCHITECTURE.md §c):
 *  PERFORMANCE   desktop + working WebGPU adapter → kokoro fp32 default
 *  BALANCED      desktop CPU / capable Android      → kokoro q8 default
 *  COMPATIBILITY iOS, low-memory                   → system voices default,
 *                Kokoro opt-in forced to wasm/q8/1-thread/same-origin WASM
 */

export type DeviceProfileName = "performance" | "balanced" | "compatibility";
export type EngineId = "kokoro" | "system";

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
  defaultEngine: EngineId;
  /** Honest one-liner shown in the Studio for this profile. */
  blurb: string;
}

export const PROFILES: Record<DeviceProfileName, DeviceProfile> = {
  performance: {
    name: "performance",
    label: "Performance",
    chunkChars: 400,
    streamHighWater: 4,
    ortThreads: 0,
    ortWasmBase: "default",
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
    defaultEngine: "system",
    blurb:
      "This device is on the compatibility path: system voices are the default " +
      "because neural synthesis needs a ~100 MB download and runs slower than " +
      "real time here. Kokoro stays available as an opt-in (forced to " +
      "single-threaded CPU) — no hidden downgrade.",
  },
};

export function getProfile(name: DeviceProfileName): DeviceProfile {
  return PROFILES[name];
}

export function defaultEngineFor(profile: DeviceProfile): EngineId {
  return profile.defaultEngine;
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ reports as Mac — touch points distinguish it.
  return (
    /Mac/.test(ua) &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1
  );
}

async function hasWebGpuAdapter(): Promise<boolean> {
  if (typeof navigator === "undefined") return false;
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter?: () => Promise<unknown> } }).gpu;
  if (!gpu?.requestAdapter) return false;
  try {
    const adapter = await Promise.race([
      gpu.requestAdapter(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    return !!adapter;
  } catch {
    return false;
  }
}

/**
 * Classify the device once per page load. Detection inputs (per the design
 * doc): UA-based iOS check, navigator.gpu requestAdapter result (reuses the
 * resolveDevice() logic), hardwareConcurrency/deviceMemory where available.
 * Absence of deviceMemory (e.g. iOS reports nothing) is treated as "unknown",
 * never as "capable".
 */
export async function classifyDevice(): Promise<DeviceProfile> {
  if (isIOS()) return PROFILES.compatibility;
  if (await hasWebGpuAdapter()) return PROFILES.performance;
  if (typeof navigator !== "undefined") {
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    // Known-low-memory Android/desktop: unknown (undefined) stays balanced —
    // only an explicit low reading forces compatibility.
    if (typeof mem === "number" && mem <= 2) return PROFILES.compatibility;
  }
  return PROFILES.balanced;
}
