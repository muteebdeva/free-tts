import { describe, expect, it } from "vitest";
import {
  encodeWav,
  nonSilentFraction,
  parseWavHeader,
  peakAmplitude,
} from "../audio/wav-encoder";

function sineWave(len: number, freq = 440, rate = 24000): Float32Array {
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / rate);
  }
  return out;
}

describe("encodeWav", () => {
  it("produces a valid WAV header with correct sample rate", () => {
    const bytes = encodeWav(sineWave(24000), { sampleRate: 24000 });
    const h = parseWavHeader(bytes);
    expect(h.sampleRate).toBe(24000);
    expect(h.numChannels).toBe(1);
    expect(h.bitsPerSample).toBe(16);
    expect(h.numSamples).toBe(24000);
    expect(bytes.length).toBe(44 + 24000 * 2);
  });

  it("round-trips sample values within 16-bit quantisation error", () => {
    const src = sineWave(1000);
    const bytes = encodeWav(src, { sampleRate: 16000 });
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    for (let i = 0; i < 1000; i++) {
      const decoded = view.getInt16(44 + i * 2, true) / 32767;
      expect(Math.abs(decoded - src[i])).toBeLessThan(1 / 32767 + 1e-9);
    }
  });

  it("hard-clips out-of-range values instead of overflowing", () => {
    const src = new Float32Array([2.0, -3.0, 0.5]);
    const bytes = encodeWav(src, { sampleRate: 8000 });
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32767);
  });

  it("encodes stereo by interleaving channels", () => {
    const left = new Float32Array([0.5, 0.5]);
    const right = new Float32Array([-0.5, -0.5]);
    const bytes = encodeWav([left, right], { sampleRate: 8000, numChannels: 2 });
    const h = parseWavHeader(bytes);
    expect(h.numChannels).toBe(2);
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    expect(view.getInt16(44, true)).toBeGreaterThan(0); // left
    expect(view.getInt16(46, true)).toBeLessThan(0); // right
  });

  it("rejects mismatched channel counts and bad sample rates", () => {
    expect(() =>
      encodeWav(new Float32Array(10), { sampleRate: 0 }),
    ).toThrow();
    expect(() =>
      encodeWav([new Float32Array(10)], { sampleRate: 8000, numChannels: 2 }),
    ).toThrow();
  });

  it("parseWavHeader rejects non-WAV bytes", () => {
    expect(() => parseWavHeader(new Uint8Array(100))).toThrow(/not a WAV/);
    expect(() => parseWavHeader(new Uint8Array(10))).toThrow(/too short/);
  });
});

describe("peakAmplitude / nonSilentFraction", () => {
  it("measures peak correctly", () => {
    expect(peakAmplitude(new Float32Array([0.2, -0.8, 0.5]))).toBeCloseTo(0.8);
    expect(peakAmplitude(new Float32Array(0))).toBe(0);
  });

  it("detects silence vs signal", () => {
    expect(nonSilentFraction(new Float32Array(1000))).toBe(0);
    expect(nonSilentFraction(sineWave(1000))).toBeGreaterThan(0.9);
  });
});
