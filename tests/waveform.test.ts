import { describe, expect, it } from "vitest";
import { computePeaks } from "../lib/waveform";

describe("computePeaks", () => {
  it("returns the requested number of bars", () => {
    const samples = new Float32Array(24000);
    expect(computePeaks(samples, 120)).toHaveLength(120);
    expect(computePeaks(samples, 0)).toEqual([]);
  });

  it("renders silence as a hairline, not zero", () => {
    const peaks = computePeaks(new Float32Array(1000), 16);
    expect(peaks.every((p) => p === 0.04)).toBe(true);
  });

  it("normalizes the loudest bucket to 1", () => {
    const samples = new Float32Array(2400);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.sin((i / samples.length) * Math.PI * 8) * 0.5;
    }
    const peaks = computePeaks(samples, 24);
    expect(Math.max(...peaks)).toBeCloseTo(1, 5);
    expect(peaks.every((p) => p >= 0.04 && p <= 1)).toBe(true);
  });

  it("a louder second half shows up in the peaks", () => {
    const samples = new Float32Array(2000);
    for (let i = 1000; i < 2000; i++) samples[i] = 0.9;
    const peaks = computePeaks(samples, 10);
    const first = peaks.slice(0, 4);
    const last = peaks.slice(6);
    expect(Math.max(...last)).toBeGreaterThan(Math.max(...first));
  });

  it("handles empty input without crashing", () => {
    expect(computePeaks(new Float32Array(0), 8)).toHaveLength(8);
  });
});
