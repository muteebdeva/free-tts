/**
 * Audio post-processing for multi-chunk TTS output.
 *
 * Long texts are synthesised as sequential chunks (see lib/text-chunk.ts).
 * Simply appending chunk waveforms produces audible clicks at the joints
 * (discontinuities) and the small silences models emit at chunk edges add up
 * to stuttery pacing. This module:
 *
 *  1. trims leading/trailing near-digital-silence from each chunk,
 *  2. joins chunks with a short equal-power crossfade (de-clicking),
 *  3. applies peak normalisation so concatenated output never clips.
 */

export interface ConcatOptions {
  /** Sample rate in Hz (all chunks must share it). */
  sampleRate: number;
  /** Crossfade length in milliseconds. Default 8ms. */
  crossfadeMs?: number;
  /** Samples below this abs value count as silence for trimming. Default 0.005. */
  silenceThreshold?: number;
  /** Max silence trimmed from each chunk edge, in ms. Default 400ms. */
  maxTrimMs?: number;
  /** Target peak after normalisation. Default 0.98. */
  targetPeak?: number;
}

/**
 * Concatenate mono chunk waveforms into one smooth waveform.
 * All chunks must be Float32Array at the same sample rate.
 */
export function concatChunks(
  chunks: Float32Array[],
  options: ConcatOptions,
): Float32Array {
  const {
    sampleRate,
    crossfadeMs = 8,
    silenceThreshold = 0.005,
    maxTrimMs = 400,
    targetPeak = 0.98,
  } = options;

  if (chunks.length === 0) return new Float32Array(0);

  const crossfadeSamples = Math.max(1, Math.round((sampleRate * crossfadeMs) / 1000));
  const maxTrimSamples = Math.round((sampleRate * maxTrimMs) / 1000);

  const trimmed = chunks.map((c) =>
    trimSilence(c, silenceThreshold, maxTrimSamples),
  );

  // Total length accounting for crossfade overlap between neighbours.
  let total = 0;
  for (const t of trimmed) total += t.length;
  total -= crossfadeSamples * (trimmed.length - 1);
  if (total <= 0) return new Float32Array(0);

  const out = new Float32Array(total);
  let writePos = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const chunk = trimmed[i];
    if (i === 0) {
      out.set(chunk, 0);
      writePos = chunk.length;
      continue;
    }
    // Overlap the tail of the previous chunk with the head of this one.
    const overlap = Math.min(crossfadeSamples, writePos, chunk.length);
    const start = writePos - overlap;
    for (let j = 0; j < overlap; j++) {
      // Equal-power crossfade: cos/sin^2 curves keep loudness constant.
      const t = j / overlap;
      const gOut = Math.cos((t * Math.PI) / 2) ** 2;
      const gIn = Math.sin((t * Math.PI) / 2) ** 2;
      out[start + j] = out[start + j] * gOut + chunk[j] * gIn;
    }
    out.set(chunk.subarray(overlap), writePos);
    writePos = writePos + chunk.length - overlap;
  }

  return normalisePeak(out.subarray(0, writePos), targetPeak);
}

/** Remove leading/trailing near-silence, bounded by maxTrimSamples per edge. */
export function trimSilence(
  samples: Float32Array,
  threshold = 0.005,
  maxTrimSamples = Infinity,
): Float32Array {
  let start = 0;
  const startLimit = Math.min(samples.length, maxTrimSamples);
  while (start < startLimit && Math.abs(samples[start]) < threshold) start++;

  let end = samples.length;
  const endLimit = Math.max(start, samples.length - maxTrimSamples);
  while (end > endLimit && Math.abs(samples[end - 1]) < threshold) end--;

  return start === 0 && end === samples.length
    ? samples
    : samples.slice(start, end);
}

/**
 * Scale so the peak equals targetPeak, but only attenuate — never amplify.
 * (Models already produce well-levelled audio; we only guard against clipping
 * introduced at chunk joints.)
 */
export function normalisePeak(
  samples: Float32Array,
  targetPeak = 0.98,
): Float32Array {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  if (peak <= targetPeak || peak === 0) return samples;
  const gain = targetPeak / peak;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
  return out;
}
