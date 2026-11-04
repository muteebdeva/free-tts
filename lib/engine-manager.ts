/**
 * EngineManager: main-thread façade over the TTS Web Worker.
 *
 * The UI talks only to this class. It owns worker lifecycle (created lazily,
 * terminated on `dispose()`), routes request/response messages by requestId,
 * and exposes progress callbacks for model loading and synthesis.
 *
 * One synthesis job runs at a time; starting a new one cancels the previous.
 */
import type { Voice } from "../engines/engine-interface";

export interface SynthesisEvents {
  onProgress?: (done: number, total: number) => void;
}

interface Pending {
  resolve: (value: never) => void;
  reject: (err: Error) => void;
  onProgress?: (done: number, total: number) => void;
  onLoadProgress?: (fraction: number) => void;
}

export interface SynthResult {
  samples: Float32Array;
  sampleRate: number;
  chunkCount: number;
}

export class EngineManager {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private activeSynthId: number | null = null;

  private ensureWorker(): Worker {
    if (typeof window === "undefined") {
      throw new Error("EngineManager requires a browser (window)");
    }
    if (!this.worker) {
      this.worker = new Worker(new URL("../workers/tts.worker.ts", import.meta.url));
      this.worker.onmessage = (event: MessageEvent) => this.handle(event.data);
      this.worker.onerror = (event) => {
        const err = new Error(
          `TTS worker error: ${event.message || "unknown"}`,
        );
        for (const [, p] of this.pending) p.reject(err);
        this.pending.clear();
      };
    }
    return this.worker;
  }

  /** "webgpu" | "wasm" — which path the engine selected on this device. */
  async getDevice(): Promise<string> {
    const res = await this.call("device", {});
    return (res as { device: string }).device;
  }

  async loadModel(onProgress?: (fraction: number) => void): Promise<string> {
    const res = await this.call("load", {}, { onLoadProgress: onProgress });
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
    const res = await this.call(
      "synthesize",
      { text, voiceId, speed },
      { onProgress: events.onProgress },
    );
    const r = res as { samples: Float32Array; sampleRate: number; chunkCount: number };
    return { samples: r.samples, sampleRate: r.sampleRate, chunkCount: r.chunkCount };
  }

  cancel(): void {
    if (this.activeSynthId !== null && this.worker) {
      this.worker.postMessage({ type: "cancel", requestId: this.activeSynthId });
    }
  }

  async unloadModel(): Promise<void> {
    await this.call("unload", {});
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const [, p] of this.pending) {
      p.reject(new Error("EngineManager disposed"));
    }
    this.pending.clear();
    this.activeSynthId = null;
  }

  private call(
    type: string,
    payload: Record<string, unknown>,
    hooks: {
      onProgress?: (done: number, total: number) => void;
      onLoadProgress?: (fraction: number) => void;
    } = {},
  ): Promise<never> {
    const worker = this.ensureWorker();
    const requestId = this.nextId++;
    return new Promise<never>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: resolve as (value: never) => void,
        reject,
        onProgress: hooks.onProgress,
        onLoadProgress: hooks.onLoadProgress,
      });
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
        pending?.onLoadProgress?.(msg.fraction as number);
        break;
      }
      case "synth-progress": {
        pending?.onProgress?.(msg.done as number, msg.total as number);
        break;
      }
      case "loaded":
      case "device":
      case "voices":
      case "synth-done":
      case "unloaded": {
        if (pending && msg.requestId != null) {
          this.pending.delete(msg.requestId);
          if (this.activeSynthId === msg.requestId) this.activeSynthId = null;
          pending.resolve(msg as never);
        }
        break;
      }
      case "error": {
        if (pending && msg.requestId != null) {
          this.pending.delete(msg.requestId);
          if (this.activeSynthId === msg.requestId) this.activeSynthId = null;
          const aborted = msg.aborted === true;
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
