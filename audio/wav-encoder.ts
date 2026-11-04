/**
 * WAV encoder: converts raw PCM float samples into a 16-bit PCM WAV file.
 *
 * The encoder is engine-agnostic: TTS engines return `{ samples: Float32Array,
 * sampleRate: number }` at their native sample rate (e.g. Kokoro = 24000 Hz
 * mono). We encode at that native rate — no resampling here, so what the
 * model produced is exactly what the file contains.
 */

export interface WavEncodeOptions {
  /** Sample rate in Hz, e.g. 24000. */
  sampleRate: number;
  /** Number of channels. 1 = mono, 2 = stereo. */
  numChannels?: number;
  /** Bits per sample. Only 16 is supported (CD-standard PCM). */
  bitsPerSample?: 16;
}

/**
 * Encode interleaved float samples (-1..1) as a 16-bit PCM WAV Blob/File bytes.
 *
 * For mono input pass a single Float32Array. For stereo, pass an array of two
 * Float32Arrays (left, right) — they are interleaved in the output.
 *
 * Values are hard-clipped to [-1, 1] before quantisation to guarantee no
 * integer overflow. Callers that want loudness management should normalise
 * beforehand (see audio/concat.ts).
 */
export function encodeWav(
  samples: Float32Array | Float32Array[],
  options: WavEncodeOptions,
): Uint8Array {
  const { sampleRate } = options;
  const numChannels = options.numChannels ?? 1;
  const bitsPerSample = 16;

  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error(`encodeWav: invalid sampleRate ${sampleRate}`);
  }
  const channels: Float32Array[] = Array.isArray(samples) ? samples : [samples];
  if (channels.length !== numChannels) {
    throw new Error(
      `encodeWav: expected ${numChannels} channel(s), got ${channels.length}`,
    );
  }
  const numSamples = channels[0].length;
  for (const ch of channels) {
    if (ch.length !== numSamples) {
      throw new Error("encodeWav: channel lengths differ");
    }
  }

  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true); // chunk size
  writeAscii(view, 8, "WAVE");
  // fmt subchunk
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // subchunk1 size (PCM)
  view.setUint16(20, 1, true); // audio format: PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  // data subchunk
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numChannels; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, Math.round(v * 32767), true);
      offset += 2;
    }
  }
  return new Uint8Array(buffer);
}

/** Validate that bytes look like a PCM WAV file; returns parsed header info. */
export function parseWavHeader(bytes: Uint8Array): {
  sampleRate: number;
  numChannels: number;
  bitsPerSample: number;
  numSamples: number;
  dataBytes: number;
} {
  if (bytes.length < 44) throw new Error("parseWavHeader: too short for WAV");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (o: number, n: number) =>
    String.fromCharCode(...bytes.subarray(o, o + n));
  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE" || ascii(12, 4) !== "fmt ") {
    throw new Error("parseWavHeader: not a WAV file (bad magic)");
  }
  if (view.getUint16(20, true) !== 1) {
    throw new Error("parseWavHeader: not PCM format");
  }
  const numChannels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  const dataBytes = view.getUint32(40, true);
  const numSamples = dataBytes / (numChannels * (bitsPerSample / 8));
  return { sampleRate, numChannels, bitsPerSample, numSamples, dataBytes };
}

/** Peak (max absolute) amplitude of float samples. */
export function peakAmplitude(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }
  return peak;
}

/** Fraction of samples whose absolute value exceeds a silence threshold. */
export function nonSilentFraction(
  samples: Float32Array,
  threshold = 0.01,
): number {
  if (samples.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > threshold) n++;
  }
  return n / samples.length;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}
