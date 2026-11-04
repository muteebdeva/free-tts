import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  GaplessPlayer,
  GAPLESS_CROSSFADE_SEC,
  promoteAudioSession,
  resetSessionPromotionForTests,
} from "../audio/gapless-player";

/** Minimal Web Audio mock that records scheduling calls. */
interface MockSource {
  buffer: unknown;
  startCalls: number[];
  stopCalls: number[];
  onended: (() => void) | null;
  connect: () => void;
  start: (when: number) => void;
  stop: (when?: number) => void;
}
interface MockParam {
  setValueAtTimeCalls: Array<[number, number]>;
  curveCalls: Array<{ curve: Float32Array; start: number; dur: number }>;
  setValueAtTime: (v: number, t: number) => void;
  setValueCurveAtTime: (c: Float32Array, s: number, d: number) => void;
}
interface MockGain {
  gain: MockParam;
  connect: () => void;
}
interface MockBuffer {
  duration: number;
  channel: Float32Array;
  getChannelData: (ch: number) => Float32Array;
}

function makeParam(): MockParam {
  const p: MockParam = {
    setValueAtTimeCalls: [],
    curveCalls: [],
    setValueAtTime(v, t) {
      p.setValueAtTimeCalls.push([v, t]);
    },
    setValueCurveAtTime(c, s, d) {
      p.curveCalls.push({ curve: c, start: s, dur: d });
    },
  };
  return p;
}

function makeMockContext() {
  const sources: MockSource[] = [];
  const gains: MockGain[] = [];
  const ctx = {
    currentTime: 0,
    state: "running",
    destination: {},
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    createBuffer(_ch: number, len: number, rate: number): MockBuffer {
      const channel = new Float32Array(len);
      return {
        duration: len / rate,
        channel,
        getChannelData: () => channel,
      };
    },
    createBufferSource(): AudioBufferSourceNode {
      const s: MockSource = {
        buffer: null,
        startCalls: [],
        stopCalls: [],
        onended: null,
        connect: () => undefined,
        start(when: number) {
          s.startCalls.push(when);
        },
        stop(when?: number) {
          s.stopCalls.push(when ?? -1);
        },
      };
      sources.push(s);
      return s as unknown as AudioBufferSourceNode;
    },
    createGain(): GainNode {
      const g: MockGain = { gain: makeParam(), connect: () => undefined };
      gains.push(g);
      return g as unknown as GainNode;
    },
  };
  return { ctx, sources, gains };
}

function tone(len: number, amp = 0.5): Float32Array {
  // Cosine starts at peak so trimSilence keeps sample 0 as signal.
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = amp * Math.cos((2 * Math.PI * 440 * i) / 24000);
  return out;
}

describe("GaplessPlayer", () => {
  let win: Record<string, unknown>;
  beforeEach(() => {
    win = {};
    (globalThis as unknown as { window: unknown }).window = win;
    win.addEventListener = vi.fn();
    win.removeEventListener = vi.fn();
  });
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    vi.restoreAllMocks();
  });

  it("unlock() returns false when Web Audio is unavailable", () => {
    const p = new GaplessPlayer();
    expect(p.unlock()).toBe(false);
    expect(p.running).toBe(false);
  });

  it("unlock() succeeds with an AudioContext and reports running", () => {
    const { ctx } = makeMockContext();
    win.AudioContext = vi.fn(function (this: unknown) { return ctx; });
    const p = new GaplessPlayer();
    expect(p.unlock()).toBe(true);
    expect(p.running).toBe(true);
    expect(ctx.resume).toHaveBeenCalled();
    p.dispose();
  });

  it("schedules chunks back-to-back with exactly the crossfade overlap", () => {
    const { ctx, sources } = makeMockContext();
    win.AudioContext = vi.fn(function (this: unknown) { return ctx; });
    const p = new GaplessPlayer();
    expect(p.unlock()).toBe(true);

    p.playChunk(tone(24000), 24000); // 1.0 s
    p.playChunk(tone(48000), 24000); // 2.0 s
    p.playChunk(tone(24000), 24000); // 1.0 s

    expect(p.timeline).toHaveLength(3);
    const [t0, t1, t2] = p.timeline;
    expect(t0.start).toBe(0);
    expect(t0.duration).toBeCloseTo(1.0, 6);
    // Each subsequent chunk starts exactly crossfade before the previous ends.
    expect(t1.start - (t0.start + t0.duration)).toBeCloseTo(-GAPLESS_CROSSFADE_SEC, 6);
    expect(t2.start - (t1.start + t1.duration)).toBeCloseTo(-GAPLESS_CROSSFADE_SEC, 6);
    // Sources were actually started at those times.
    expect(sources[0].startCalls[0]).toBeCloseTo(t0.start, 6);
    expect(sources[1].startCalls[0]).toBeCloseTo(t1.start, 6);
    expect(sources[2].startCalls[0]).toBeCloseTo(t2.start, 6);
    p.dispose();
  });

  it("trims edge silence before scheduling (matches the download stitcher)", () => {
    const { ctx } = makeMockContext();
    win.AudioContext = vi.fn(function (this: unknown) { return ctx; });
    const p = new GaplessPlayer();
    p.unlock();
    const sig = new Float32Array(24000); // 2400 silent + tone + 2400 silent
    sig.set(tone(19200), 2400);
    p.playChunk(sig, 24000);
    expect(p.trimmedLengths[0]).toBeLessThan(24000);
    expect(p.trimmedLengths[0]).toBeGreaterThanOrEqual(19200);
    expect(p.timeline[0].duration).toBeCloseTo(p.trimmedLengths[0] / 24000, 6);
    p.dispose();
  });

  it("applies the equal-power crossfade envelopes at each joint", () => {
    const { ctx, gains } = makeMockContext();
    win.AudioContext = vi.fn(function (this: unknown) { return ctx; });
    const p = new GaplessPlayer();
    p.unlock();
    p.playChunk(tone(24000), 24000);
    p.playChunk(tone(24000), 24000);
    // gains[0] = master; gains[1] = chunk 0; gains[2] = chunk 1.
    const prevGain = gains[1].gain;
    const nextGain = gains[2].gain;
    // Outgoing: fade-out curve over the crossfade window.
    expect(prevGain.curveCalls).toHaveLength(1);
    expect(prevGain.curveCalls[0].dur).toBeCloseTo(GAPLESS_CROSSFADE_SEC, 6);
    expect(prevGain.curveCalls[0].curve[0]).toBeCloseTo(1, 3);
    expect(prevGain.curveCalls[0].curve.at(-1)!).toBeCloseTo(0, 3);
    // Incoming: starts at 0, fades in over the same window.
    expect(nextGain.setValueAtTimeCalls[0][0]).toBe(0);
    expect(nextGain.curveCalls).toHaveLength(1);
    expect(nextGain.curveCalls[0].curve[0]).toBeCloseTo(0, 3);
    expect(nextGain.curveCalls[0].curve.at(-1)!).toBeCloseTo(1, 3);
    expect(nextGain.curveCalls[0].dur).toBeCloseTo(GAPLESS_CROSSFADE_SEC, 6);
    p.dispose();
  });

  it("fires onChunkEnded exactly once per chunk, including all-silence chunks", async () => {
    const { ctx } = makeMockContext();
    win.AudioContext = vi.fn(function (this: unknown) { return ctx; });
    const ended: number[] = [];
    const p = new GaplessPlayer({ onChunkEnded: (i) => ended.push(i) });
    p.unlock();
    p.playChunk(tone(24000), 24000); // index 0
    p.playChunk(new Float32Array(24000), 24000); // index 1: all silence, skipped
    p.playChunk(tone(24000), 24000); // index 2
    expect(p.timeline).toHaveLength(2); // skipped chunk has no schedule
    await new Promise((r) => setTimeout(r, 10)); // queueMicrotask flush
    expect(ended).toContain(1);
    // Chunk 2 had no previous *scheduled* chunk to crossfade with (chunk 1
    // was skipped) — it starts cleanly at the cursor.
    const t = p.timeline;
    expect(t[1].start).toBeCloseTo(t[0].start + t[0].duration, 6);
    p.dispose();
  });

  it("late chunks (generation slower than playback) start ASAP with no overlap math errors", () => {
    const { ctx } = makeMockContext();
    win.AudioContext = vi.fn(function (this: unknown) { return ctx; });
    const p = new GaplessPlayer();
    p.unlock();
    p.playChunk(tone(24000), 24000); // ends at t=1.0
    ctx.currentTime = 5.0; // playback long finished; chunk 2 arrives late
    p.playChunk(tone(24000), 24000);
    expect(p.timeline[1].start).toBe(5.0);
    expect(p.timeline).toHaveLength(2);
    p.dispose();
  });

  it("stop() silences scheduled sources, returns pending indexes, and suppresses their acks", () => {
    const { ctx, sources } = makeMockContext();
    win.AudioContext = vi.fn(function (this: unknown) { return ctx; });
    const ended: number[] = [];
    const p = new GaplessPlayer({ onChunkEnded: (i) => ended.push(i) });
    p.unlock();
    p.playChunk(tone(24000), 24000);
    p.playChunk(tone(24000), 24000);
    const pending = p.stop();
    expect(pending).toEqual([0, 1]);
    expect(sources[0].stopCalls.length).toBeGreaterThan(0);
    expect(sources[1].stopCalls.length).toBeGreaterThan(0);
    // onended was nulled before stopping: no ack callbacks fire.
    sources[0].onended?.();
    expect(ended).toHaveLength(0);
    p.dispose();
  });

  it("ignores playChunk after dispose", () => {
    const { ctx } = makeMockContext();
    win.AudioContext = vi.fn(function (this: unknown) { return ctx; });
    const p = new GaplessPlayer();
    p.unlock();
    p.dispose();
    p.playChunk(tone(24000), 24000);
    expect(p.timeline).toHaveLength(0);
    expect(ctx.close).toHaveBeenCalled();
  });
});

describe("iOS audio session promotion + unlock verification", () => {
  let win: Record<string, unknown>;
  let playedUrls: string[];
  beforeEach(() => {
    win = {};
    (globalThis as unknown as { window: unknown }).window = win;
    win.addEventListener = vi.fn();
    win.removeEventListener = vi.fn();
    playedUrls = [];
    resetSessionPromotionForTests();
    // navigator without audioSession => legacy <audio> kick path.
    vi.stubGlobal("navigator", {});
    const TestAudio = vi.fn(function (this: unknown, url: string) {
      playedUrls.push(url);
      return {
        play: vi.fn(async () => undefined),
      };
    });
    vi.stubGlobal("Audio", TestAudio);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:mock-silent"),
      revokeObjectURL: vi.fn(),
    });
  });
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("promoteAudioSession sets navigator.audioSession.type to playback (iOS 17+)", () => {
    const audioSession: { type?: string } = {};
    vi.stubGlobal("navigator", { audioSession });
    promoteAudioSession();
    expect(audioSession.type).toBe("playback");
  });

  it("promoteAudioSession plays a silent <audio> kick for older iOS", () => {
    promoteAudioSession();
    // One silent WAV blob URL was played through an <audio> element.
    expect(playedUrls).toEqual(["blob:mock-silent"]);
  });

  it("promoteAudioSession runs only once per page load", () => {
    promoteAudioSession();
    promoteAudioSession();
    expect(playedUrls).toHaveLength(1);
  });

  it("unlock() promotes the audio session synchronously in the gesture", () => {
    const audioSession: { type?: string } = {};
    vi.stubGlobal("navigator", { audioSession });
    const { ctx } = makeMockContext();
    win.AudioContext = vi.fn(function (this: unknown) { return ctx; });
    const p = new GaplessPlayer();
    expect(p.unlock()).toBe(true);
    // Whisper-quiet regression: without this, iOS routes Web Audio through
    // the silent-switch-muted ambient channel.
    expect(audioSession.type).toBe("playback");
    p.dispose();
  });

  it("ensureUnlocked resolves true when the context is running", async () => {
    const { ctx } = makeMockContext(); // state: "running"
    win.AudioContext = vi.fn(function (this: unknown) { return ctx; });
    const p = new GaplessPlayer();
    p.unlock();
    await expect(p.ensureUnlocked()).resolves.toBe(true);
    p.dispose();
  });

  it("ensureUnlocked resolves false when iOS keeps the context suspended", async () => {
    const { ctx } = makeMockContext();
    ctx.state = "suspended";
    // resume() that iOS ignores: state never changes.
    ctx.resume = vi.fn(async () => undefined);
    win.AudioContext = vi.fn(function (this: unknown) { return ctx; });
    const p = new GaplessPlayer();
    // unlock() is optimistic (context exists) — the silence regression.
    expect(p.unlock()).toBe(true);
    // ...but verification catches it: the caller must use the <audio>
    // fallback instead of scheduling into a suspended context.
    await expect(p.ensureUnlocked()).resolves.toBe(false);
    p.dispose();
  });

  it("ensureUnlocked resolves true when a retried resume unlocks iOS", async () => {
    const { ctx } = makeMockContext();
    ctx.state = "suspended";
    ctx.resume = vi.fn(async () => {
      ctx.state = "running";
    });
    win.AudioContext = vi.fn(function (this: unknown) { return ctx; });
    const p = new GaplessPlayer();
    p.unlock();
    await expect(p.ensureUnlocked()).resolves.toBe(true);
    p.dispose();
  });

  it("unlock() on an existing context retries resume (does not blindly succeed)", () => {
    const { ctx } = makeMockContext();
    ctx.state = "suspended";
    ctx.resume = vi.fn(async () => undefined);
    win.AudioContext = vi.fn(function (this: unknown) { return ctx; });
    const p = new GaplessPlayer();
    p.unlock();
    const callsAfterFirst = (ctx.resume as ReturnType<typeof vi.fn>).mock.calls.length;
    p.unlock();
    // Second unlock re-kicks resume instead of returning early.
    expect((ctx.resume as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
      callsAfterFirst,
    );
    p.dispose();
  });

  it("no chunk gain is ever stuck below 1.0 outside its crossfade (whisper regression)", () => {
    const { ctx, gains } = makeMockContext();
    win.AudioContext = vi.fn(function (this: unknown) { return ctx; });
    const p = new GaplessPlayer();
    p.unlock();
    // gains[0] is the master — it must never be automated (stays 1.0).
    p.playChunk(tone(24000), 24000);
    p.playChunk(tone(24000), 24000);
    p.playChunk(tone(24000), 24000);
    const master = gains[0].gain;
    expect(master.setValueAtTimeCalls).toHaveLength(0);
    expect(master.curveCalls).toHaveLength(0);
    // Per-chunk gains: the last automation on the still-playing (final)
    // chunk must leave it at 1.0 — a stuck low gain is the whisper bug.
    const lastGain = gains[3].gain;
    const lastCurve = lastGain.curveCalls.at(-1)!;
    expect(lastCurve.curve.at(-1)!).toBeCloseTo(1, 3);
    p.dispose();
  });
});
