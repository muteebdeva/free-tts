/**
 * TTS Web Worker: runs neural TTS engines (Kokoro, KittenTTS Nano) off the
 * main thread. ("system" voices stay main-thread — Web Speech API.)
 *
 * Responsibilities:
 *  - load the model once (progress reported to the UI),
 *  - apply the device profile's ORT policy (thread count, WASM binary base)
 *    BEFORE session creation,
 *  - split long text into sentence-aware chunks (lib/text-chunk.ts),
 *  - synthesize chunks sequentially with per-chunk progress + cooperative
 *    cancellation,
 *  - STREAMING (protocol v2): post each chunk's PCM to the main thread the
 *    moment it is ready (`chunk-done`, zero-copy transfer), honouring
 *    backpressure — the loop pauses while unacknowledged chunks reach the
 *    high-water mark and resumes on `chunk-ack`,
 *  - batch mode (`synthesize`) is retained for the verify harness's
 *    streamed-vs-batch byte-match regression test.
 *
 * The main thread never touches the model. WAV/MP3 encoding and playback
 * stay on the main thread (playback is <audio>-only; no AudioContext).
 */
import { KokoroEngine } from "../engines/kokoro/kokoro-engine";
import { KittenEngine } from "../engines/kitten/kitten-engine";
import type { TTSEngine } from "../engines/engine-interface";
import { concatChunks } from "../audio/concat";
import { chunkText } from "../lib/text-chunk";
import { env as kokoroEnv } from "kokoro-js";
import { env as ortEnv } from "onnxruntime-web";

/** Neural engines that run inside this worker. ("system" stays main-thread.) */
export type WorkerEngineId = "kokoro" | "kitten";

/** Lazily-created engine registry — one instance per engine per worker lifetime. */
const engines = new Map<WorkerEngineId, TTSEngine>();
function getEngine(id: WorkerEngineId): TTSEngine {
  let e = engines.get(id);
  if (!e) {
    e = id === "kitten" ? new KittenEngine() : new KokoroEngine();
    engines.set(id, e);
  }
  return e;
}

interface OrtPolicy {
  /** ORT WASM thread count (positive int) — applied before session creation. */
  numThreads?: number;
  /** Point env.wasmPaths at the shipped /ort/ dir (same-origin WASM). */
  sameOriginWasm?: boolean;
}

type InMessage =
  | { type: "load"; requestId: number; assetBase?: string; ort?: OrtPolicy; engineId?: WorkerEngineId }
  | { type: "voices"; requestId: number; engineId?: WorkerEngineId }
  | { type: "synthesize"; requestId: number; text: string; voiceId: string; speed: number; engineId?: WorkerEngineId }
  | {
      type: "synthesize-stream";
      requestId: number;
      text: string;
      voiceId: string;
      speed: number;
      chunkChars?: number;
      highWater?: number;
      engineId?: WorkerEngineId;
    }
  | { type: "chunk-ack"; requestId: number }
  | { type: "cancel"; requestId: number }
  | { type: "unload"; requestId: number; engineId?: WorkerEngineId }
  | { type: "device"; requestId: number; engineId?: WorkerEngineId };

function engineIdOf(msg: { engineId?: WorkerEngineId }): WorkerEngineId {
  // Default keeps the verify harness (which sends no engineId) on Kokoro.
  return msg.engineId === "kitten" ? "kitten" : "kokoro";
}
let currentAbort: AbortController | null = null;
let currentRequestId: number | null = null;
let fetchWrapped = false;

/** Backpressure state for the single active streaming job. */
let streamCtl: {
  requestId: number;
  unacked: number;
  highWater: number;
  waiters: Array<() => void>;
} | null = null;

/**
 * Point all external asset downloads at a local mirror (same origin).
 * Used ONLY by the verification harness (scripts/verify-audio.mjs), where the
 * sandbox proxy blocks the browser's direct CDN access. Rewrites:
 *  - https://huggingface.co/... (model, tokenizer, voices — kokoro-js
 *    hardcodes voice URLs, so env config alone cannot redirect them)
 *  - https://cdn.jsdelivr.net/... (fallback)
 * and pins the ONNX Runtime WASM binaries to the mirror via env.wasmPaths.
 */
function useAssetMirror(assetBase: string): void {
  kokoroEnv.wasmPaths = `${assetBase}/ort/`;
  if (fetchWrapped) return;
  fetchWrapped = true;
  const originalFetch = globalThis.fetch.bind(globalThis);
  const rewrites: Array<[string, string]> = [
    ["https://huggingface.co/", `${assetBase}/mirror/huggingface.co/`],
    ["https://cdn.jsdelivr.net/", `${assetBase}/mirror/cdn.jsdelivr.net/`],
  ];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    let url: string | null = null;
    if (typeof input === "string") url = input;
    else if (input instanceof URL) url = input.href;
    else if (typeof (input as Request).url === "string") url = (input as Request).url;
    if (url) {
      for (const [from, to] of rewrites) {
        if (url.startsWith(from)) {
          const rewritten = to + url.slice(from.length);
          input = (typeof input === "string" || input instanceof URL
            ? rewritten
            : new Request(rewritten, input as Request)) as RequestInfo;
          break;
        }
      }
    }
    return originalFetch(input as RequestInfo, init);
  }) as typeof fetch;
}

/**
 * Apply the device profile's ORT policy. MUST run before the first session
 * is created (transformers.js reads these globals at backend init).
 *
 * Spike notes (2026-11-04, see docs/STREAMING.md):
 *  - numThreads IS reachable via env.backends.onnx.wasm.numThreads — an
 *    explicit positive int sticks (the vendored default only applies when
 *    the value is unset/invalid).
 *  - arena / mem-pattern / tensor disposal are NOT reachable: kokoro-js
 *    1.2.1's from_pretrained destructures only {dtype, device,
 *    progress_callback}, so transformers' session_options never arrive.
 *    Compensations: thread policy + small chunks + worker-restart resets.
 *  - The vendored ORT 1.22.0 wasm backend always requests the
 *    `ort-wasm-simd-threaded.jsep.*` filenames; the non-JSEP
 *    `ort-wasm-simd-threaded.*` files shipped under public/ort/ are for
 *    forward-compat and are asserted NOT fetched by the verify gate.
 */
function applyOrtPolicy(ort: OrtPolicy | undefined, assetBase: string | undefined): void {
  if (!ort) return;
  const wasm = (kokoroEnv as unknown as { backends?: { onnx?: { wasm?: { numThreads?: unknown } } } })
    .backends?.onnx?.wasm;
  if (wasm && Number.isInteger(ort.numThreads) && (ort.numThreads as number) > 0) {
    wasm.numThreads = ort.numThreads;
  }
  // KittenTTS uses onnxruntime-web directly (not kokoro-js's vendored copy),
  // so its env needs the same policy applied to its own instance.
  const kittenWasm = (ortEnv as unknown as { wasm?: { numThreads?: unknown; wasmPaths?: unknown } }).wasm;
  if (kittenWasm && Number.isInteger(ort.numThreads) && (ort.numThreads as number) > 0) {
    kittenWasm.numThreads = ort.numThreads;
  }
  // Verify harness: the sandbox blocks CDN fetches, so the mirror's
  // wasmPaths (set by useAssetMirror) always wins there.
  if (ort.sameOriginWasm && !assetBase) {
    // Same-origin WASM binaries (public/ort/) — no CDN dependency, no
    // version-skew 404 (BOTTLENECKS.md #7). The runtime requests the
    // jsep-named files, which are shipped there; see spike note above.
    kokoroEnv.wasmPaths = "/ort/";
    if (kittenWasm) kittenWasm.wasmPaths = "/ort/";
  }
}

/** Resolve waiters blocked on backpressure (abort / supersede / unload). */
function drainStreamWaiters(): void {
  const ctl = streamCtl;
  streamCtl = null;
  if (ctl) {
    const waiters = ctl.waiters.splice(0);
    for (const w of waiters) w();
  }
}

/** Pause the streaming loop while unacknowledged chunks hit the high-water mark. */
function waitForAckSlot(aborter: AbortController): Promise<void> {
  const ctl = streamCtl;
  if (!ctl || ctl.unacked < ctl.highWater || aborter.signal.aborted) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => ctl.waiters.push(resolve));
}

function post(msg: unknown, transfer?: Transferable[]) {
  (self as unknown as Worker).postMessage(msg, transfer ?? []);
}

self.onmessage = async (event: MessageEvent<InMessage>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case "device": {
        post({ type: "device", requestId: msg.requestId, device: getEngine(engineIdOf(msg)).activeDevice });
        break;
      }
      case "load": {
        if (msg.assetBase) useAssetMirror(msg.assetBase);
        applyOrtPolicy(msg.ort, msg.assetBase);
        const loadEngine = getEngine(engineIdOf(msg));
        await loadEngine.load((fraction) =>
          post({ type: "load-progress", requestId: msg.requestId, fraction }),
        );
        post({ type: "loaded", requestId: msg.requestId, device: loadEngine.activeDevice });
        break;
      }
      case "voices": {
        // The voice registry is static metadata — no model download needed.
        post({ type: "voices", requestId: msg.requestId, voices: await getEngine(engineIdOf(msg)).getVoices() });
        break;
      }
      case "synthesize": {
        // Batch mode: retained for the verify harness byte-match regression
        // (streamed PCM must equal batch PCM for the same input).
        currentAbort?.abort();
        drainStreamWaiters();
        const aborter = new AbortController();
        currentAbort = aborter;
        currentRequestId = msg.requestId;

        const chunks = chunkText(msg.text, { maxChars: 400, locale: "en" });
        const waves: Float32Array[] = [];
        let sampleRate = 24000;

        for (let i = 0; i < chunks.length; i++) {
          if (aborter.signal.aborted) throw new DOMException("Aborted", "AbortError");
          const result = await getEngine(engineIdOf(msg)).synthesize(chunks[i], msg.voiceId, {
            speed: msg.speed,
            signal: aborter.signal,
          });
          sampleRate = result.sampleRate;
          waves.push(result.samples);
          post({ type: "synth-progress", requestId: msg.requestId, done: i + 1, total: chunks.length });
        }

        if (aborter.signal.aborted) throw new DOMException("Aborted", "AbortError");
        const combined = concatChunks(waves, { sampleRate });
        // Samples travel in the same message as the transfer: structured
        // clone moves the Float32Array zero-copy; the buffer is detached here.
        post(
          {
            type: "synth-done",
            requestId: msg.requestId,
            sampleRate,
            chunkCount: chunks.length,
            samples: combined,
          },
          [combined.buffer as Transferable],
        );
        break;
      }
      case "synthesize-stream": {
        // Protocol v2: one synthesis at a time; abort any in-flight job first.
        currentAbort?.abort();
        drainStreamWaiters();
        const aborter = new AbortController();
        currentAbort = aborter;
        currentRequestId = msg.requestId;

        const chunkChars =
          msg.chunkChars && msg.chunkChars >= 20 ? msg.chunkChars : 400;
        const highWater = msg.highWater && msg.highWater >= 1 ? msg.highWater : 3;
        streamCtl = { requestId: msg.requestId, unacked: 0, highWater, waiters: [] };

        const chunks = chunkText(msg.text, { maxChars: chunkChars, locale: "en" });
        let sampleRate = 24000;

        for (let i = 0; i < chunks.length; i++) {
          if (aborter.signal.aborted) throw new DOMException("Aborted", "AbortError");
          // Backpressure: wait until the main thread has acknowledged
          // enough chunks to drop below the high-water mark.
          await waitForAckSlot(aborter);
          if (aborter.signal.aborted) throw new DOMException("Aborted", "AbortError");
          const result = await getEngine(engineIdOf(msg)).synthesize(chunks[i], msg.voiceId, {
            speed: msg.speed,
            signal: aborter.signal,
          });
          sampleRate = result.sampleRate;
          if (streamCtl && streamCtl.requestId === msg.requestId) streamCtl.unacked++;
          post(
            {
              type: "chunk-done",
              requestId: msg.requestId,
              index: i,
              total: chunks.length,
              sampleRate,
              samples: result.samples,
            },
            [result.samples.buffer as Transferable],
          );
          post({ type: "synth-progress", requestId: msg.requestId, done: i + 1, total: chunks.length });
        }

        if (aborter.signal.aborted) throw new DOMException("Aborted", "AbortError");
        post({ type: "synth-done", requestId: msg.requestId, sampleRate, chunkCount: chunks.length });
        break;
      }
      case "chunk-ack": {
        // Main thread consumed a chunk: the worker may produce more.
        if (streamCtl && msg.requestId === streamCtl.requestId) {
          streamCtl.unacked = Math.max(0, streamCtl.unacked - 1);
          while (streamCtl.waiters.length > 0 && streamCtl.unacked < streamCtl.highWater) {
            const w = streamCtl.waiters.shift();
            w?.();
          }
        }
        break;
      }
      case "cancel": {
        if (msg.requestId === currentRequestId) currentAbort?.abort();
        drainStreamWaiters();
        break;
      }
      case "unload": {
        currentAbort?.abort();
        drainStreamWaiters();
        await getEngine(engineIdOf(msg)).unload();
        post({ type: "unloaded", requestId: msg.requestId });
        break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const aborted =
      err instanceof DOMException && err.name === "AbortError";
    post({
      type: "error",
      requestId: (msg as { requestId?: number }).requestId ?? null,
      message,
      aborted,
    });
  } finally {
    if (
      (msg.type === "synthesize" || msg.type === "synthesize-stream") &&
      currentRequestId === msg.requestId
    ) {
      currentAbort = null;
      currentRequestId = null;
      drainStreamWaiters();
    }
  }
};
