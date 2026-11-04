/**
 * Kokoro-82M engine: TTSEngine implementation on top of `kokoro-js`.
 *
 * Runs 100% in the browser via @huggingface/transformers + onnxruntime-web.
 * Device policy: WebGPU (fp32) when `navigator.gpu` exists, otherwise WASM
 * (q8 quantized) — per the kokoro-js README recommendation.
 *
 * Honest limits (surfaced in `capabilities` and the UI):
 *  - English only (kokoro-js 1.2.1: 28 voices, English phonemization).
 *  - No voice cloning; fixed preset voices.
 *  - Cancellation is cooperative: an abort is honoured between inference
 *    calls, but an in-flight ONNX forward pass cannot be interrupted.
 */
import { KokoroTTS } from "kokoro-js";
import type { ProgressCallback } from "@huggingface/transformers";
import type {
  EngineCapabilities,
  GenerationOptions,
  SynthesisResult,
  TTSEngine,
  Voice,
} from "../engine-interface";
import { DEFAULT_VOICE_ID, KOKORO_VOICES, isKnownVoice } from "./voices";
import { isIOSDevice } from "../../lib/device-profile";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";

type DeviceKind = "webgpu" | "wasm";
type DtypeKind = "fp32" | "q8";

/**
 * Device/dtype policy injected by the caller (from lib/device-profile.ts)
 * instead of the engine self-detecting. Any field left unset falls back to
 * the engine's own detection. The iOS 26 force-WASM rule below still
 * overrides a "webgpu" policy — see load().
 */
export interface KokoroDevicePolicy {
  device?: DeviceKind;
  dtype?: DtypeKind;
}

function detectDevice(): DeviceKind {
  // Fast sync guess: navigator.gpu is undefined on browsers without WebGPU
  // (e.g. Firefox stable without flags, older Safari). Presence of the API
  // does NOT guarantee a usable adapter — load() verifies with
  // resolveDevice() before downloading anything.
  return typeof navigator !== "undefined" && "gpu" in navigator
    ? "webgpu"
    : "wasm";
}

interface GpuWithAdapter {
  requestAdapter?: (options?: object) => Promise<unknown>;
}

/**
 * Verify a usable WebGPU adapter exists BEFORE any model bytes are fetched.
 * Headless Chromium, VMs, and some mobile browsers expose `navigator.gpu`
 * with no usable adapter — the old code then downloaded the 326 MB fp32
 * model before failing. Adapter-less devices now go straight to the 92 MB
 * q8 WASM build.
 */
async function resolveDevice(): Promise<DeviceKind> {
  if (typeof navigator === "undefined") return "wasm";
  const gpu = (navigator as Navigator & { gpu?: GpuWithAdapter }).gpu;
  if (!gpu?.requestAdapter) return "wasm";
  try {
    const adapter = await Promise.race([
      gpu.requestAdapter(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    return adapter ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

export class KokoroEngine implements TTSEngine {
  readonly id = "kokoro";
  readonly label = "Kokoro 82M";

  readonly capabilities: EngineCapabilities = {
    languages: ["en-US", "en-GB"],
    speedControl: true,
    audioExport: true,
    limitations: [
      "English only — this build ships 28 English voices with English phonemization.",
      "Fastest with WebGPU; on CPU-only devices synthesis runs slower than real time.",
      "Fixed preset voices — voice cloning is not supported.",
      "Generation cannot be interrupted mid-sentence; cancel applies between sentences.",
    ],
  };

  private tts: KokoroTTS | null = null;
  private loading: Promise<void> | null = null;
  private device: DeviceKind = detectDevice();
  private readonly policy: KokoroDevicePolicy;

  constructor(policy: KokoroDevicePolicy = {}) {
    this.policy = policy;
    // An explicitly injected device wins over the sync guess immediately so
    // the rest of the app (badges, pre-download UI) reports the truth.
    if (policy.device) this.device = policy.device;
    // iOS 26 force-WASM rule: iOS Safari now exposes WebGPU, but the
    // onnxruntime WebGPU execution provider is broken there — see
    // https://github.com/microsoft/onnxruntime/issues/26827. Until that
    // upstream issue is fixed, WebGPU is disabled on all iOS, no matter
    // what the injected policy or the adapter check says.
    if (typeof navigator !== "undefined" && isIOSDevice(navigator.userAgent)) {
      this.device = "wasm";
    }
  }

  /** Which execution path was selected ("webgpu" | "wasm"). */
  get activeDevice(): DeviceKind {
    return this.device;
  }

  isLoaded(): boolean {
    return this.tts !== null;
  }

  load(onProgress?: (fraction: number) => void): Promise<void> {
    if (this.tts) return Promise.resolve();
    if (this.loading) return this.loading;

    this.loading = (async () => {
      // Resolve the REAL device before downloading anything: on adapter-less
      // devices this picks wasm/q8 immediately instead of fetching the
      // 326 MB fp32 model and failing at session creation. An injected
      // policy device is honoured, but the adapter pre-check still runs as
      // a safety net for "webgpu" (a lying `navigator.gpu` must not trigger
      // a 326 MB download), and the iOS force-WASM rule still overrides.
      const ios =
        typeof navigator !== "undefined" && isIOSDevice(navigator.userAgent);
      if (this.device === "webgpu" && !ios) {
        // Safety net even for an injected "webgpu" policy: a lying
        // `navigator.gpu` must not trigger a 326 MB download.
        this.device = await resolveDevice();
      }
      if (ios) this.device = "wasm";
      const dtype: DtypeKind =
        this.policy.dtype ?? (this.device === "webgpu" ? "fp32" : "q8");
      const progress_callback: ProgressCallback | undefined = onProgress
        ? (info) => {
            // transformers.js reports per-file progress (0..100) with
            // status "progress"; other statuses carry no progress number.
            if (info.status === "progress") {
              onProgress(Math.min(1, Math.max(0, info.progress / 100)));
            }
          }
        : undefined;
      try {
        this.tts = await KokoroTTS.from_pretrained(MODEL_ID, {
          dtype,
          device: this.device,
          progress_callback,
        });
      } catch (err) {
        // If WebGPU was selected but the adapter fails (e.g. SwiftShader
        // issues, disabled GPU), retry once on WASM before giving up.
        if (this.device === "webgpu") {
          this.device = "wasm";
          this.tts = await KokoroTTS.from_pretrained(MODEL_ID, {
            dtype: "q8",
            device: "wasm",
            progress_callback,
          });
        } else {
          throw err;
        }
      }
    })();

    // Clear the in-flight marker when settled so a failed load can be retried.
    this.loading.then(
      () => { this.loading = null; },
      () => { this.loading = null; },
    );
    return this.loading;
  }

  async getVoices(): Promise<Voice[]> {
    return KOKORO_VOICES;
  }

  async synthesize(
    text: string,
    voiceId: string,
    options: GenerationOptions = {},
  ): Promise<SynthesisResult> {
    if (!this.tts) throw new Error("KokoroEngine: load() before synthesize()");
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const voice = isKnownVoice(voiceId) ? voiceId : DEFAULT_VOICE_ID;
    const speed = clampSpeed(options.speed ?? 1);

    // kokoro-js has no AbortSignal support: check before and after inference.
    const audio = await this.tts.generate(text, { voice: voice as never, speed });
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");

    // audio is RawAudio { audio: Float32Array, sampling_rate: number }.
    return {
      samples: audio.audio.slice(), // copy: the buffer may be reused internally
      sampleRate: audio.sampling_rate,
    };
  }

  async unload(): Promise<void> {
    // kokoro-js/transformers.js v1.2.1 era exposes no model.dispose() on the
    // wrapper; dropping references lets the page reclaim JS memory. The
    // onnxruntime-web WASM heap is process-global and cannot be freed per
    // model — documented in ARCHITECTURE.md.
    this.tts = null;
    this.loading = null;
  }
}

function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1;
  return Math.min(2, Math.max(0.5, speed));
}

export { DEFAULT_VOICE_ID };
