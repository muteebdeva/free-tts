/**
 * KittenTTS Nano engine: TTSEngine implementation for the 15M-parameter
 * int8 ONNX model (KittenML/kitten-tts-nano-0.8-int8, Apache-2.0).
 *
 * Runs 100% in the browser via onnxruntime-web (WASM EP) + the `phonemizer`
 * npm package (espeak-ng, GPL-3.0 — already a kokoro-js dependency, see
 * THIRD-PARTY-NOTICES.md). The pipeline replicates the official KittenML
 * v0.8 inference (kittentts_legacy/onnx_model.py):
 *   espeak-ng phonemize (en-us) → basic_english_tokenize → char-level
 *   TextCleaner vocab → [0, …ids, 10, 0] framing →
 *   style = voices[voice][min(len(text), 399)] → ONNX session →
 *   output "waveform" trimmed by the official last-5000-samples cut.
 *
 * Deliberate deviation: the official 1384-line TextPreprocessor
 * (number/currency/roman expansion) is NOT ported — the real-audio gate
 * (scripts/verify-kitten.mjs, run 2) proves espeak-ng's own text analysis
 * already expands numbers ("911" → "nine hundred eleven") and currency.
 * Light NFKC + whitespace normalization is applied instead.
 *
 * The host (worker) MUST apply the device profile's ORT policy
 * (numThreads, wasmPaths) before load() — the engine does not set ORT env
 * itself. Verified by the real-audio gate: docs/evidence/kitten-verify.json.
 *
 * Honest limits (surfaced in `capabilities` and the UI):
 *  - English only, 8 fixed expressive voices.
 *  - Measured ~2.1× slower than real time on desktop CPU WASM
 *    (docs/KITTEN-SPIKE.md) — not the "~3× real-time" marketing claim.
 *  - Cancellation is cooperative: honoured between inference calls, but an
 *    in-flight ONNX forward pass cannot be interrupted.
 */
import * as ort from "onnxruntime-web";
import { phonemize } from "phonemizer";
import type {
  EngineCapabilities,
  GenerationOptions,
  SynthesisResult,
  TTSEngine,
  Voice,
} from "../engine-interface";
import { KITTEN_VOCAB } from "./vocab";
import {
  DEFAULT_VOICE_ID,
  KITTEN_VOICES,
  STYLE_DIM,
  STYLE_ROWS,
  extractVoiceMatrix,
  resolveVoiceId,
  speedPriorFor,
  type KittenVoiceId,
} from "./voices";

const MODEL_URL =
  "https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8/resolve/main/kitten_tts_nano_v0_8.onnx";
const VOICES_URL =
  "https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8/resolve/main/voices.npz";
const CACHE_NAME = "kitten-tts";
const SAMPLE_RATE = 24000;
/** Measured 2026-11-04 (docs/KITTEN-SPIKE.md) — honest download progress. */
const MODEL_BYTES = 24369971;
const VOICES_BYTES = 3278902;

export class KittenEngine implements TTSEngine {
  readonly id = "kitten";
  readonly label = "KittenTTS Nano";

  readonly capabilities: EngineCapabilities = {
    languages: ["en-US"],
    speedControl: true,
    audioExport: true,
    limitations: [
      "English only — 8 fixed expressive voices, no voice cloning.",
      "Measured ~2.1× slower than real time on desktop CPU (WASM); phones will differ.",
      "Quality is below Kokoro-82M — the trade is download size (~27 MB) and speed.",
      "Generation cannot be interrupted mid-sentence; cancel applies between sentences.",
    ],
  };

  private session: ort.InferenceSession | null = null;
  private outputName = "waveform";
  private voicesNpz: Uint8Array | null = null;
  private styleCache = new Map<KittenVoiceId, Float32Array>();
  private loading: Promise<void> | null = null;

  /** Which execution path was selected ("wasm" — the only supported path). */
  get activeDevice(): "wasm" {
    return "wasm";
  }

  isLoaded(): boolean {
    return this.session !== null;
  }

  load(onProgress?: (fraction: number) => void): Promise<void> {
    if (this.session) return Promise.resolve();
    if (this.loading) return this.loading;

    this.loading = (async () => {
      const total = MODEL_BYTES + VOICES_BYTES;
      let done = 0;
      const report = (n: number) => {
        done += n;
        onProgress?.(Math.min(0.9, Math.max(0, done / total)));
      };
      const [modelBuf, voicesBuf] = await Promise.all([
        cachedFetch(MODEL_URL, CACHE_NAME, report),
        cachedFetch(VOICES_URL, CACHE_NAME, report),
      ]);
      this.voicesNpz = new Uint8Array(voicesBuf);
      // WASM EP only: the model is int8-quantized for CPU; WebGPU buys
      // nothing here and is disabled on iOS anyway (#26827).
      this.session = await ort.InferenceSession.create(modelBuf, {
        executionProviders: ["wasm"],
      });
      this.outputName = this.session.outputNames[0] ?? "waveform";
      onProgress?.(1);
    })();

    this.loading.then(
      () => {
        this.loading = null;
      },
      () => {
        this.loading = null;
      },
    );
    return this.loading;
  }

  async getVoices(): Promise<Voice[]> {
    return KITTEN_VOICES;
  }

  async synthesize(
    text: string,
    voiceId: string,
    options: GenerationOptions = {},
  ): Promise<SynthesisResult> {
    if (!this.session || !this.voicesNpz) {
      throw new Error("KittenEngine: load() before synthesize()");
    }
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const voice = resolveVoiceId(voiceId);
    const speed = clampSpeed(options.speed ?? 1) * speedPriorFor(voice);

    // Light normalization only — espeak-ng does the heavy text analysis
    // (numbers, currency, punctuation), verified in the gate's run 2.
    const clean = text.normalize("NFKC").replace(/\s+/g, " ").trim();
    if (!clean) throw new Error("KittenEngine: empty text after normalization");

    // espeak-ng phonemization (en-us), same as the official pipeline.
    const phonemes = (await phonemize(clean, "en-us")).join(" ");
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const tokenIds = textToTokenIds(phonemes);
    // The Nano BERT encoder has a ~512-token position limit: 382 chars
    // (≈500 tokens) fails in OrtRun with "invalid expand shape" while 196
    // chars works. Reject clearly instead of surfacing the cryptic ORT
    // error — callers (the worker) chunk to ≤200 chars.
    if (tokenIds.length > 450) {
      throw new Error(
        `KittenEngine: input too long (${tokenIds.length} tokens > 450). ` +
          `Split the text into shorter pieces (≤200 chars).`,
      );
    }
    const styleRow = this.styleRowFor(voice, clean.length);

    const inputs: Record<string, ort.Tensor> = {
      input_ids: new ort.Tensor(
        "int64",
        BigInt64Array.from(tokenIds.map(BigInt)),
        [1, tokenIds.length],
      ),
      style: new ort.Tensor("float32", styleRow, [1, STYLE_DIM]),
      speed: new ort.Tensor("float32", Float32Array.of(speed), [1]),
    };
    const outputs = await this.session.run(inputs);
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const waveform = outputs[this.outputName]?.data as
      | Float32Array
      | undefined;
    if (!waveform) throw new Error("KittenEngine: model returned no waveform");
    // Official pipeline trims the last 5000 samples.
    const trimmed = waveform.slice(0, Math.max(0, waveform.length - 5000));
    return {
      samples: Float32Array.from(trimmed),
      sampleRate: SAMPLE_RATE,
    };
  }

  async unload(): Promise<void> {
    this.session = null;
    this.voicesNpz = null;
    this.styleCache.clear();
    this.loading = null;
  }

  /** Style embedding row for this voice + text length (official rule). */
  private styleRowFor(voice: KittenVoiceId, textLength: number): Float32Array {
    let matrix = this.styleCache.get(voice);
    if (!matrix) {
      matrix = extractVoiceMatrix(this.voicesNpz!, voice);
      this.styleCache.set(voice, matrix);
    }
    const row = Math.min(textLength, STYLE_ROWS - 1);
    return matrix.slice(row * STYLE_DIM, row * STYLE_DIM + STYLE_DIM);
  }
}

/**
 * Official basic_english_tokenize + TextCleaner:
 * regex \w+|[^\w\s] (unicode-aware), joined with spaces, then per-character
 * vocab lookup — unknown chars are skipped, like the official KeyError pass.
 * Framing: [0, …ids, 10, 0].
 */
export function textToTokenIds(phonemes: string): number[] {
  const joined = (phonemes.match(/\w+|[^\w\s]/gu) ?? []).join(" ");
  const ids: number[] = [];
  for (const ch of joined) {
    const id = KITTEN_VOCAB.get(ch);
    if (id !== undefined) ids.push(id);
  }
  return [0, ...ids, 10, 0];
}

function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1;
  return Math.min(2, Math.max(0.5, speed));
}

/**
 * Fetch with Cache Storage persistence + byte progress. Uses the global
 * fetch so the worker's asset-mirror rewrite (verify harness) applies.
 */
async function cachedFetch(
  url: string,
  cacheName: string,
  onBytes: (n: number) => void,
): Promise<ArrayBuffer> {
  if (typeof caches !== "undefined") {
    try {
      const cache = await caches.open(cacheName);
      const hit = await cache.match(url);
      if (hit) {
        const buf = await hit.arrayBuffer();
        onBytes(buf.byteLength);
        return buf;
      }
    } catch {
      // Cache API unavailable or failed — fall through to network.
    }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`KittenEngine: download failed (${res.status}): ${url}`);
  const reader = res.body?.getReader();
  if (!reader) {
    const buf = await res.arrayBuffer();
    onBytes(buf.byteLength);
    return buf;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    onBytes(value.byteLength);
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.byteLength;
  }
  const buf = merged.buffer as ArrayBuffer;
  if (typeof caches !== "undefined") {
    try {
      const cache = await caches.open(cacheName);
      await cache.put(url, new Response(buf.slice(0), { status: 200 }));
    } catch {
      // Non-fatal: the model still works, it just re-downloads next time.
    }
  }
  return buf;
}

export { DEFAULT_VOICE_ID };
