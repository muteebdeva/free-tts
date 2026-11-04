import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EngineManager, type StreamChunk, type WorkerLike } from "../lib/engine-manager";

/** Controllable stand-in for the TTS Web Worker. */
class FakeWorker implements WorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  posted: Array<Record<string, unknown>> = [];
  terminated = false;

  postMessage(message: unknown): void {
    this.posted.push(message as Record<string, unknown>);
  }
  terminate(): void {
    this.terminated = true;
  }
  /** Simulate the worker posting a message to the main thread. */
  emit(msg: Record<string, unknown>): void {
    this.onmessage?.({ data: msg });
  }
  /** Simulate an uncaught worker error (crash / OOM kill). */
  crash(message: string): void {
    this.onerror?.({ message });
  }
  postedOfType(type: string): Array<Record<string, unknown>> {
    return this.posted.filter((m) => m.type === type);
  }
}

function makeManager(workers: FakeWorker[]): EngineManager {
  return new EngineManager({
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
  });
}

beforeEach(() => {
  vi.stubGlobal("window", {});
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("synthesizeStream", () => {
  it("delivers chunks in order, acks each, and resolves on synth-done", async () => {
    const workers: FakeWorker[] = [];
    const mgr = makeManager(workers);
    const seen: StreamChunk[] = [];
    const sp = mgr.synthesizeStream(
      "Hello world. This is a test.",
      "af_heart",
      1,
      {
        onChunk: (c) => {
          seen.push(c);
          sp.ack();
        },
      },
      { chunkStallMs: 60_000, highWater: 4, chunkChars: 200 },
    );

    const w = workers[0];
    const req = w.postedOfType("synthesize-stream")[0];
    expect(req.requestId).toBeDefined();
    expect(req.chunkChars).toBe(200);
    expect(req.highWater).toBe(4);

    w.emit({ type: "chunk-done", requestId: req.requestId, index: 0, total: 2, sampleRate: 24000, samples: new Float32Array([0.1]) });
    w.emit({ type: "chunk-done", requestId: req.requestId, index: 1, total: 2, sampleRate: 24000, samples: new Float32Array([0.2]) });
    w.emit({ type: "synth-done", requestId: req.requestId, sampleRate: 24000, chunkCount: 2 });

    const result = await sp;
    expect(result).toEqual({ sampleRate: 24000, chunkCount: 2 });
    expect(seen.map((c) => c.index)).toEqual([0, 1]);
    expect(seen[0].total).toBe(2);
    expect(w.postedOfType("chunk-ack")).toHaveLength(2);
    expect(w.terminated).toBe(false);
  });

  it("forwards synth-progress to onProgress", async () => {
    const workers: FakeWorker[] = [];
    const mgr = makeManager(workers);
    const progress: Array<[number, number]> = [];
    const sp = mgr.synthesizeStream("Hi.", "af_heart", 1, {
      onProgress: (d, t) => progress.push([d, t]),
    });
    const w = workers[0];
    const req = w.postedOfType("synthesize-stream")[0];
    const done = sp.then(() => "resolved", () => "rejected");
    w.emit({ type: "synth-progress", requestId: req.requestId, done: 1, total: 3 });
    w.emit({ type: "synth-done", requestId: req.requestId, sampleRate: 24000, chunkCount: 3 });
    expect(await done).toBe("resolved");
    expect(progress).toEqual([[1, 3]]);
  });

  it("stall watchdog rejects with a clear error and rebirths the worker", async () => {
    const workers: FakeWorker[] = [];
    const mgr = makeManager(workers);
    const sp = mgr.synthesizeStream("Hello.", "af_heart", 1, {}, { chunkStallMs: 1000 });
    const failed = sp.then(
      () => "resolved",
      (e: Error) => e.message,
    );
    // The worker goes silent mid-stream (jetsam/OOM signature).
    await vi.advanceTimersByTimeAsync(1000);
    const message = await failed;
    expect(message).toMatch(/stalled/);
    expect(message).toMatch(/restarted/);
    expect(message).toMatch(/system voices/);
    expect(workers[0].terminated).toBe(true);
    // Next call transparently recreates the worker.
    const v = mgr.getVoices();
    void v.catch(() => undefined);
    expect(workers).toHaveLength(2);
    expect(workers[1].terminated).toBe(false);
  });

  it("does not fire the stall watchdog while the worker is paused by our backpressure", async () => {
    const workers: FakeWorker[] = [];
    const mgr = makeManager(workers);
    const sp = mgr.synthesizeStream("Hello.", "af_heart", 1, {}, { chunkStallMs: 1000, highWater: 1 });
    const w = workers[0];
    const req = w.postedOfType("synthesize-stream")[0];
    const settled = sp.then(
      () => "resolved",
      () => "rejected",
    );
    // One chunk arrives and is NOT acked: unacked (1) >= highWater (1) —
    // the worker is paused by us, not stalled.
    w.emit({ type: "chunk-done", requestId: req.requestId, index: 0, total: 2, sampleRate: 24000, samples: new Float32Array([1]) });
    await vi.advanceTimersByTimeAsync(5000);
    let state = "pending";
    void settled.then((s) => { state = s; });
    await Promise.resolve();
    expect(state).toBe("pending");
    // Consuming the chunk re-arms the watchdog; with no further progress
    // the stall is then detected honestly.
    sp.ack();
    expect(w.postedOfType("chunk-ack")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(sp).rejects.toThrow(/stalled/);
  });

  it("a non-abort engine error drops the worker (clean heap for the next call)", async () => {
    const workers: FakeWorker[] = [];
    const mgr = makeManager(workers);
    const sp = mgr.synthesizeStream("Hello.", "af_heart", 1, {}, { chunkStallMs: 60_000 });
    const w = workers[0];
    const req = w.postedOfType("synthesize-stream")[0];
    const failed = sp.then(
      () => "resolved",
      (e: Error) => e.message,
    );
    w.emit({ type: "error", requestId: req.requestId, message: "OOM during inference", aborted: false });
    expect(await failed).toBe("OOM during inference");
    expect(w.terminated).toBe(true);
    const v = mgr.getVoices();
    void v.catch(() => undefined);
    expect(workers).toHaveLength(2);
  });

  it("cancel() posts cancel and the stream rejects with AbortError", async () => {
    const workers: FakeWorker[] = [];
    const mgr = makeManager(workers);
    const sp = mgr.synthesizeStream("Hello.", "af_heart", 1, {}, { chunkStallMs: 60_000 });
    const w = workers[0];
    const req = w.postedOfType("synthesize-stream")[0];
    const failed = sp.then(
      () => "resolved",
      (e: Error) => e.name,
    );
    sp.cancel();
    expect(w.postedOfType("cancel")).toHaveLength(1);
    // Worker honours the cancel.
    w.emit({ type: "error", requestId: req.requestId, message: "Aborted", aborted: true });
    expect(await failed).toBe("AbortError");
    // Abort is normal — the worker is NOT reborn.
    expect(w.terminated).toBe(false);
    expect(workers).toHaveLength(1);
  });
});

describe("worker rebirth", () => {
  it("worker.onerror rejects in-flight jobs and the next call recreates", async () => {
    const workers: FakeWorker[] = [];
    const mgr = makeManager(workers);
    const v = mgr.getVoices();
    const failed = v.then(
      () => "resolved",
      (e: Error) => e.message,
    );
    workers[0].crash("out of memory");
    const message = await failed;
    expect(message).toMatch(/stopped unexpectedly/);
    expect(message).toMatch(/system voices/);
    expect(workers[0].terminated).toBe(true);
    const v2 = mgr.getVoices();
    void v2.catch(() => undefined);
    expect(workers).toHaveLength(2);
  });

  it("unloadModel terminates the worker (WASM heap reset); next call recreates", async () => {
    const workers: FakeWorker[] = [];
    const mgr = makeManager(workers);
    const v = mgr.getVoices();
    void v.catch(() => undefined);
    await mgr.unloadModel();
    expect(workers[0].terminated).toBe(true);
    const v2 = mgr.getVoices();
    void v2.catch(() => undefined);
    expect(workers).toHaveLength(2);
    expect(workers[1].terminated).toBe(false);
  });

  it("per-request watchdog fires on a hung call", async () => {
    const workers: FakeWorker[] = [];
    const mgr = makeManager(workers);
    const v = mgr.getVoices();
    const failed = v.then(
      () => "resolved",
      (e: Error) => e.message,
    );
    // Default request watchdog is 5 min; the worker never answers.
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    const message = await failed;
    expect(message).toMatch(/timed out/);
    expect(message).toMatch(/restarted/);
    expect(workers[0].terminated).toBe(true);
  });
});
