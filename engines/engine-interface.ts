/**
 * Engine abstraction for FreeTTS.
 *
 * Every TTS backend (Kokoro via kokoro-js, Piper via WASM, Web Speech API
 * fallback, …) implements TTSEngine. The UI only talks to this interface, so
 * new models can be added without rewriting the app.
 *
 * Deliberately, engines declare their own capabilities — the UI must not
 * assume speed control, multilinguality, or any other feature exists.
 */

export interface Voice {
  /** Stable engine-scoped id, e.g. "af_heart". */
  id: string;
  /** Human-readable name, e.g. "Heart". */
  name: string;
  /** BCP-47 language tag the voice speaks, e.g. "en-US". */
  language: string;
  /** "female" | "male" | null when the model does not label gender. */
  gender: "female" | "male" | null;
  /** Short description shown on voice cards. */
  description: string;
  /**
   * Accent/dialect label, e.g. "American", "British". Null when unknown —
   * never invented.
   */
  accent: string | null;
}

export interface EngineCapabilities {
  /** Languages the engine REALLY supports (verified, not aspirational). */
  languages: string[];
  /** Whether `speed` in GenerationOptions has an effect. */
  speedControl: boolean;
  /**
   * Whether synthesize() returns real PCM the app can play back, visualise
   * and export (WAV/MP3). Engines that render audio directly (e.g. the OS
   * speech synthesizer) set this false — the UI must hide download controls
   * for them rather than faking audio data.
   */
  audioExport: boolean;
  /** Human-readable list of things this engine cannot do. Shown in UI. */
  limitations: string[];
}

export interface GenerationOptions {
  /** Speaking-rate multiplier. Only honoured if capabilities.speedControl. */
  speed?: number;
  /** AbortSignal for user cancellation. */
  signal?: AbortSignal;
  /** (doneChunks, totalChunks) for long-form progress. */
  onProgress?: (done: number, total: number) => void;
}

export interface SynthesisResult {
  /** Mono PCM samples in [-1, 1] at the engine's native sample rate. */
  samples: Float32Array;
  /** Native sample rate in Hz, e.g. 24000. */
  sampleRate: number;
}

export interface TTSEngine {
  /** Engine id, e.g. "kokoro". */
  readonly id: string;
  /** Display name, e.g. "Kokoro 82M". */
  readonly label: string;
  /** Active compute device after load() — "webgpu" or "wasm". */
  readonly activeDevice: "webgpu" | "wasm";
  /** What this engine can and cannot do — read before rendering controls. */
  readonly capabilities: EngineCapabilities;

  /**
   * Load the model into memory (downloads on first use, cached afterwards).
   * Must be idempotent: calling twice loads once. Reports 0..1 progress.
   */
  load(onProgress?: (fraction: number) => void): Promise<void>;

  /** Voices available AFTER load(). */
  getVoices(): Promise<Voice[]>;

  /**
   * Synthesize one chunk of text. Long-form text is split by the caller
   * (lib/text-chunk.ts) and each chunk is synthesised sequentially, so
   * engines only ever see short inputs. Must respect signal abortion.
   */
  synthesize(
    text: string,
    voiceId: string,
    options?: GenerationOptions,
  ): Promise<SynthesisResult>;

  /** Release model memory. */
  unload(): Promise<void>;

  /** True after successful load(), false after unload() or failed load. */
  isLoaded(): boolean;
}

/** Error thrown when an engine cannot run on this device/browser. */
export class EngineNotSupportedError extends Error {
  constructor(
    public readonly engineId: string,
    reason: string,
  ) {
    super(`Engine "${engineId}" is not supported on this device: ${reason}`);
    this.name = "EngineNotSupportedError";
  }
}
