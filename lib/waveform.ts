/**
 * Waveform peak computation for the Studio audio player.
 *
 * Downsamples raw PCM into N peak buckets (max |amplitude| per bucket),
 * normalized to 0..1 with a small visual floor so silence still renders a
 * hairline. Pure function — no DOM, no audio APIs — so it is unit-testable
 * and safe to run on the retained generation PCM.
 */
export function computePeaks(samples: Float32Array, bars: number): number[] {
  if (bars <= 0) return [];
  const peaks = new Array<number>(bars).fill(0);
  const n = samples.length;
  if (n === 0) return peaks;
  const per = Math.max(1, Math.floor(n / bars));
  for (let b = 0; b < bars; b++) {
    const start = b * per;
    const end = Math.min(n, start + per);
    let max = 0;
    // Stride the scan so long audio (minutes at 24 kHz) stays cheap.
    const stride = Math.max(1, Math.floor((end - start) / 64));
    for (let i = start; i < end; i += stride) {
      const a = Math.abs(samples[i]);
      if (a > max) max = a;
    }
    peaks[b] = max;
  }
  const g = Math.max(...peaks);
  if (g <= 0) return peaks.map(() => 0.04);
  return peaks.map((p) => Math.max(0.04, p / g));
}
