import { describe, expect, it } from "vitest";
import { concatChunks, normalisePeak, trimSilence } from "../audio/concat";

function tone(len: number, amp = 0.5, freq = 440, rate = 24000): Float32Array {
  // Cosine: starts at peak amplitude so trimSilence treats sample 0 as signal.
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = amp * Math.cos((2 * Math.PI * freq * i) / rate);
  }
  return out;
}

describe("trimSilence", () => {
  it("trims leading/trailing near-silence", () => {
    const sig = new Float32Array(1000);
    sig.set(tone(600), 200); // 200 samples of silence, 600 of tone, 200 silence
    const trimmed = trimSilence(sig, 0.005, 1000);
    expect(trimmed.length).toBeLessThan(1000);
    expect(trimmed.length).toBeGreaterThanOrEqual(600);
  });

  it("does not trim real signal", () => {
    const sig = tone(500);
    expect(trimSilence(sig).length).toBe(500);
  });

  it("respects maxTrimSamples bound", () => {
    const sig = new Float32Array(1000); // all silence
    const trimmed = trimSilence(sig, 0.005, 100);
    expect(trimmed.length).toBe(800);
  });
});

describe("normalisePeak", () => {
  it("attenuates peaks above target, never amplifies", () => {
    const loud = tone(100, 2.0);
    const out = normalisePeak(loud, 0.98);
    let peak = 0;
    for (const v of out) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeCloseTo(0.98, 5);

    const quiet = tone(100, 0.3);
    expect(normalisePeak(quiet, 0.98)).toBe(quiet); // same reference: untouched
  });
});

describe("concatChunks", () => {
  it("concatenates lengths minus crossfade overlap", () => {
    const a = tone(24000);
    const b = tone(24000);
    const out = concatChunks([a, b], { sampleRate: 24000, crossfadeMs: 8 });
    const overlap = Math.round(24000 * 0.008);
    expect(out.length).toBe(24000 + 24000 - overlap);
  });

  it("returns a copy for a single chunk (normalised)", () => {
    const a = tone(1000, 0.5);
    const out = concatChunks([a], { sampleRate: 24000 });
    expect(out.length).toBe(1000);
  });

  it("returns empty for no chunks", () => {
    expect(concatChunks([], { sampleRate: 24000 }).length).toBe(0);
  });

  it("produces no discontinuity spike at the joint (de-clicking)", () => {
    // Worst case: chunk A ends at +0.9, chunk B starts at -0.9.
    const a = new Float32Array(2400).fill(0.9);
    const b = new Float32Array(2400).fill(-0.9);
    const out = concatChunks([a, b], { sampleRate: 24000, crossfadeMs: 10 });
    // Max sample-to-sample jump anywhere should be far below the raw 1.8 step.
    let maxJump = 0;
    for (let i = 1; i < out.length; i++) {
      maxJump = Math.max(maxJump, Math.abs(out[i] - out[i - 1]));
    }
    expect(maxJump).toBeLessThan(0.3);
  });

  it("never clips the concatenated output", () => {
    const a = tone(5000, 0.99);
    const b = tone(5000, 0.99);
    const out = concatChunks([a, b], { sampleRate: 24000 });
    for (const v of out) expect(Math.abs(v)).toBeLessThanOrEqual(0.98 + 1e-6);
  });
});
