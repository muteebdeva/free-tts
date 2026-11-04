/**
 * EngineManager: main-thread façade over the TTS Web Worker.
 *
 * The UI talks only to this class. It owns worker lifecycle (created lazily,
 * terminated on `dispose()`), routes request/response messages by requestId,
 * and exposes progress callbacks for model loading and synthesis.
 *
 * Streaming (protocol v2): `synthesizeStream` delivers per-chunk PCM via
 * `onChunk` as the worker produces it, with ack backpressure (`ack()` posts
 * `chunk-ack`; the worker pauses while unacknowledged chunks reach the
 * high-water mark). Time-to-first-audio becomes time-to-first-chunk.
 *
 * Failure recovery: every request has a watchdog; streams add a per-chunk
 * stall watchdog (no chunk-done/progress for N s → clear error, never a
 * silent "Synthesizing…" hang). On worker.onerror, watchdog timeout, or a
 * non-abort engine error, the worker is terminated and dropped — the next
 * call transparently recreates it via ensureWorker (worker rebirth). The
 * in-flight job gets a clear error suggesting system voices.
 *
 * Memory: `unloadModel()` terminates the worker outright — the ORT WASM heap
 * is process-global and engine.unload() cannot free it, so terminate+recreate
 * is the only real native-memory reset short of a tab reload.
 *
 * One synthesis job runs at a time; starting a new one cancels the previous.
 */
import type { Voice } from "../engines/engine-interface";

/** Minimal worker surface — injectable for tests. */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

export interface EngineManagerOptions {
  createWorker?: () => WorkerLike;
}

export interface SynthesisEvents {
  onProgress?: (done: number, total: number) => void;
}

export interface StreamChunk {
  index: number;
  total: number;
  samples: Float32Array;
  sampleRate: number;
}

export interface StreamEvents {
  /** Fired per chunk as PCM arrives (zero-copy transfer from the worker). */
  onChunk?: (chunk: StreamChunk) => void;
  onProgress?: (done: number, total: number) => void;
}

export interface StreamResult {
  sampleRate: number;
  chunkCount: number;
}

export interface StreamOptions {
  chunkChars?: number;
  highWater?: number;
  /**
   * Per-chunk stall watchdog: no chunk-done/synth-progress for this long →
   * the stream fails with a clear error (never a silent hang). Default 4 min
   * (worst plausible single chunk: 400 chars on sub-realtime WASM).
   */
  chunkStallMs?: number;
}

export interface StreamPromise extends Promise<StreamResult> {
  /**
   * Acknowledge one received chunk as consumed. Resumes a worker paused by
   * backpressure. Call exactly once per received chunk.
   */
  ack(): void;
  /** Cancel the streaming job (worker stops; the promise rejects with AbortError). */
  cancel(): void;
}

interface PendingBase {
  resolve: (value: never) => void;
  reject: (err: Error) => void;
  /** Per-request watchdog deadline (re-armed by progress events). */
  requestTimeout?: ReturnType<typeof setTimeout>;
  timeoutMs: number;
}

interface CallPending extends PendingBase {
  kind: "call";
  onProgress?: (done: number, total: number) => void;
  onLoadProgress?: (fraction: number) => void;
}

interface StreamPending extends PendingBase {
  kind: "stream";
  streamResolve: (result: StreamResult) => void;
  onChunk?: (chunk: StreamChunk) => void;
  onProgress?: (done: number, total: number) => void;
  stallTimer?: ReturnType<typeof setTimeout>;
  chunkStallMs: number;
  /** chunk-done received but not yet acked (backpressure accounting). */
  unacked: number;
  highWater: number;
}

type Pending = CallPending | StreamPending;

export interface SynthResult {
  samples: Float32Array;
  sampleRate: number;
  chunkCount: number;
}

export interface LoadModelOptions {
  assetBase?: string;
  /** ORT WASM thread count (profile policy; applied before session creation). */
  numThreads?: number;
  /** Point env.wasmPaths at the shipped same-origin /ort/ dir. */
  sameOriginWasm?: boolean;
}

const DEFAULT_CHUNK_STALL_MS = 240_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60_000;
const LOAD_TIMEOUT_MS = 15 * 60_000;

const UNEXPECTED_STOP =
  "Speech engine stopped unexpectedly — try again or switch to system voices.";

export class EngineManager {
  private worker: WorkerLike | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private activeSynthId: number | null = null;
  private createWorker: () => WorkerLike;

  constructor(opts: EngineManagerOptions = {}) {
    this.createWorker =
      opts.createWorker ??
      (() => new Worker(new URL("../workers/tts.worker.ts", import.meta.url)) as unknown as WorkerLike);
  }

  private ensureWorker(): WorkerLike {
    if (typeof window === "undefined") {
      throw new Error("EngineManager requires a browser (window)");
    }
    if (!this.worker) {
      this.worker = this.createWorker();
      this.worker.onmessage = (event: { data: unknown }) =>
        this.handle(event.data as Parameters<EngineManager["handle"]>[0]);
      this.worker.onerror = (event) => {
        // Worker crashed (or was killed, e.g. OOM): drop it so the next
        // call starts clean, and fail in-flight jobs loudly — never hang.
        this.rebirthWorker(
          `TTS worker error: ${event.message || "unknown"}. ${UNEXPECTED_STOP}`,
        );
      };
    }
    return this.worker;
  }

  /**
   * Terminate the worker, drop it, and reject every in-flight job with a
   * clear error. The next call transparently creates a fresh worker.
   */
  private rebirthWorker(reason: string): void {
    try {
      this.worker?.terminate();
    } catch {
      // Terminate is best-effort.
    }
    this.worker = null;
    const err = new Error(reason);
    for (const [, p] of this.pending) {
      clearTimeout(p.requestTimeout);
      if (p.kind === "stream") clearTimeout(p.stallTimer);
      p.reject(err);
    }
    this.pending.clear();
    this.activeSynthId = null;
  }

  /** "webgpu" | "wasm" — which path the engine selected on this device. */
  async getDevice(): Promise<string> {
    const res = await this.call("device", {});
    return (res as { device: string }).device;
  }

  async loadModel(
    onProgress?: (fraction: number) => void,
    opts: LoadModelOptions = {},
  ): Promise<string> {
    const res = await this.call(
      "load",
      {
        assetBase: opts.assetBase,
        ort: { numThreads: opts.numThreads, sameOriginWasm: opts.sameOriginWasm },
      },
      { onLoadProgress: onProgress },
      { timeoutMs: LOAD_TIMEOUT_MS },
    );
    return (res as { device: string }).device;
  }

  async getVoices(): Promise<Voice[]> {
    const res = await this.call("voices", {});
    return (res as { voices: Voice[] }).voices;
  }

  async synthesize(
    text: string,
    voiceId: string,
    speed: number,
    events: SynthesisEvents = {},
  ): Promise<SynthResult> {
    // Cancel any in-flight synthesis before starting a new one.
    this.cancel();
    const estChunks = Math.max(1, Math.ceil(text.length / 400));
    const res = await this.call(
      "synthesize",
      { text, voiceId, speed },
      { onProgress: events.onProgress },
      { timeoutMs: Math.max(DEFAULT_REQUEST_TIMEOUT_MS, estChunks * DEFAULT_CHUNK_STALL_MS + 60_000) },
    );
    const r = res as { samples: Float32Array; sampleRate: number; chunkCount: number };
    return { samples: r.samples, sampleRate: r.sampleRate, chunkCount: r.chunkCount };
  }

  /**
   * Streaming synthesis (protocol v2). Resolves when the worker posts
   * `synth-done`; per-chunk PCM arrives via `events.onChunk` (zero-copy).
   * The returned promise also carries `ack()` (backpressure) and `cancel()`.
   */
  synthesizeStream(
    text: string,
    voiceId: string,
    speed: number,
    events: StreamEvents = {},
    opts: StreamOptions = {},
  ): StreamPromise {
    // Cancel any in-flight synthesis before starting a new one.
    this.cancel();
    const worker = this.ensureWorker();
    const requestId = this.nextId++;
    const chunkStallMs = opts.chunkStallMs ?? DEFAULT_CHUNK_STALL_MS;
    const highWater = opts.highWater && opts.highWater >= 1 ? opts.highWater : 3;

    let ackFn!: () => void;
    let cancelFn!: () => void;

    const promise = new Promise<StreamResult>((resolve, reject) => {
      const pending: StreamPending = {
        kind: "stream",
        resolve: resolve as (value: never) => void,
        reject,
        streamResolve: resolve,
        onChunk: events.onChunk,
        onProgress: events.onProgress,
        chunkStallMs,
        unacked: 0,
        highWater,
        timeoutMs: Number.POSITIVE_INFINITY,
      };
      this.pending.set(requestId, pending);
      this.activeSynthId = requestId;
      this.armChunkWatchdog(requestId);
      worker.postMessage({
        type: "synthesize-stream",
        requestId,
        text,
        voiceId,
        speed,
        chunkChars: opts.chunkChars,
        highWater,
      });

      ackFn = () => {
        const p = this.pending.get(requestId);
        if (p?.kind === "stream" && p.unacked > 0) {
          p.unacked--;
          // Forward progress (a consumed chunk may unblock the worker) —
          // re-arm the stall watchdog from here.
          this.armChunkWatchdog(requestId);
          if (this.worker && this.activeSynthId === requestId) {
            this.worker.postMessage({ type: "chunk-ack", requestId });
          }
        }
      };
      cancelFn = () => {
        if (this.activeSynthId === requestId && this.worker) {
          this.worker.postMessage({ type: "cancel", requestId });
        }
      };
    }) as StreamPromise;
    promise.ack = () => ackFn();
    promise.cancel = () => cancelFn();
    return promise;
  }

  cancel(): void {
    if (this.activeSynthId !== null && this.worker) {
      this.worker.postMessage({ type: "cancel", requestId: this.activeSynthId });
    }
  }

  /**
   * Unload the model AND reclaim native memory: the ORT WASM heap is
   * process-global inside the worker and engine.unload() cannot free it, so
   * the worker is terminated outright. The next call transparently recreates
   * a fresh worker via ensureWorker(). In-flight jobs reject with AbortError
   * (same as a user cancel).
   */
  async unloadModel(): Promise<void> {
    this.cancel();
    try {
      this.worker?.terminate();
    } catch {
      // Best-effort.
    }
    this.worker = null;
    const abort = new DOMException("Model unloaded", "AbortError");
    for (const [, p] of this.pending) {
      clearTimeout(p.requestTimeout);
      if (p.kind === "stream") clearTimeout(p.stallTimer);
      p.reject(abort);
    }
    this.pending.clear();
    this.activeSynthId = null;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const [, p] of this.pending) {
      clearTimeout(p.requestTimeout);
      if (p.kind === "stream") clearTimeout(p.stallTimer);
      p.reject(new Error("EngineManager disposed"));
    }
    this.pending.clear();
    this.activeSynthId = null;
  }

  private armChunkWatchdog(requestId: number): void {
    const p = this.pending.get(requestId);
    if (!p || p.kind !== "stream") return;
    clearTimeout(p.stallTimer);
    p.stallTimer = setTimeout(() => this.onChunkStall(requestId), p.chunkStallMs);
  }

  private onChunkStall(requestId: number): void {
    const p = this.pending.get(requestId);
    if (!p || p.kind !== "stream") return;
    if (p.unacked >= p.highWater) {
      // The worker is paused by OUR backpressure, not stalled — keep
      // waiting; the next ack() re-arms this timer.
      this.armChunkWatchdog(requestId);
      return;
    }
    this.rebirthWorker(
      `Speech generation stalled — no audio for ${Math.round(p.chunkStallMs / 1000)}s. ` +
        "The engine was restarted. Try again or switch to system voices.",
    );
  }

  private rearmRequestTimeout(requestId: number, p: Pending): void {
    clearTimeout(p.requestTimeout);
    if (Number.isFinite(p.timeoutMs)) {
      p.requestTimeout = setTimeout(() => {
        if (this.pending.has(requestId)) {
          this.rebirthWorker(
            `Speech engine timed out after ${Math.round(p.timeoutMs / 1000)}s with no progress. ` +
              "The engine was restarted. Try again or switch to system voices.",
          );
        }
      }, p.timeoutMs);
    }
  }

  private call(
    type: string,
    payload: Record<string, unknown>,
    hooks: {
      onProgress?: (done: number, total: number) => void;
      onLoadProgress?: (fraction: number) => void;
    } = {},
    opts: { timeoutMs?: number } = {},
  ): Promise<never> {
    const worker = this.ensureWorker();
    const requestId = this.nextId++;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    return new Promise<never>((resolve, reject) => {
      const pending: CallPending = {
        kind: "call",
        resolve: resolve as (value: never) => void,
        reject,
        onProgress: hooks.onProgress,
        onLoadProgress: hooks.onLoadProgress,
        timeoutMs,
      };
      this.pending.set(requestId, pending);
      this.rearmRequestTimeout(requestId, pending);
      if (type === "synthesize") this.activeSynthId = requestId;
      worker.postMessage({ type, requestId, ...payload });
    });
  }

  private handle(msg: {
    type: string;
    requestId?: number;
    [key: string]: unknown;
  }): void {
    const pending = msg.requestId != null ? this.pending.get(msg.requestId) : undefined;

    switch (msg.type) {
      case "load-progress": {
        if (pending?.kind === "call" && msg.requestId != null) {
          // Progress = liveness: re-arm the request watchdog.
          this.rearmRequestTimeout(msg.requestId, pending);
          pending.onLoadProgress?.(msg.fraction as number);
        }
        break;
      }
      case "synth-progress": {
        if (pending && msg.requestId != null) {
          if (pending.kind === "stream") this.armChunkWatchdog(msg.requestId);
          else this.rearmRequestTimeout(msg.requestId, pending);
          pending.onProgress?.(msg.done as number, msg.total as number);
        }
        break;
      }
      case "chunk-done": {
        if (pending?.kind === "stream" && msg.requestId != null) {
          pending.unacked++;
          this.armChunkWatchdog(msg.requestId);
          pending.onChunk?.({
            index: msg.index as number,
            total: msg.total as number,
            samples: msg.samples as Float32Array,
            sampleRate: msg.sampleRate as number,
          });
        }
        break;
      }
      case "loaded":
      case "device":
      case "voices":
      case "unloaded": {
        if (pending && msg.requestId != null) {
          this.pending.delete(msg.requestId);
          if (this.activeSynthId === msg.requestId) this.activeSynthId = null;
          clearTimeout(pending.requestTimeout);
          pending.resolve(msg as never);
        }
        break;
      }
      case "synth-done": {
        if (pending && msg.requestId != null) {
          this.pending.delete(msg.requestId);
          if (this.activeSynthId === msg.requestId) this.activeSynthId = null;
          if (pending.kind === "stream") {
            clearTimeout(pending.stallTimer);
            pending.streamResolve({
              sampleRate: msg.sampleRate as number,
              chunkCount: msg.chunkCount as number,
            });
          } else {
            clearTimeout(pending.requestTimeout);
            pending.resolve(msg as never);
          }
        }
        break;
      }
      case "error": {
        if (pending && msg.requestId != null) {
          this.pending.delete(msg.requestId);
          if (this.activeSynthId === msg.requestId) this.activeSynthId = null;
          clearTimeout(pending.requestTimeout);
          if (pending.kind === "stream") clearTimeout(pending.stallTimer);
          const aborted = msg.aborted === true;
          if (!aborted) {
            // Non-abort engine failure (possibly OOM): drop the worker so
            // the next call starts from a clean WASM heap (design doc §d).
            try {
              this.worker?.terminate();
            } catch {
              // Best-effort.
            }
            this.worker = null;
          }
          pending.reject(
            aborted
              ? new DOMException(String(msg.message), "AbortError")
              : new Error(String(msg.message)),
          );
        }
        break;
      }
    }
  }
}

// Singleton for the app: one worker per page lifetime.
let singleton: EngineManager | null = null;
export function getEngineManager(): EngineManager {
  if (!singleton) singleton = new EngineManager();
  return singleton;
}
