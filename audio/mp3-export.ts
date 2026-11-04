/**
 * MP3 encoder: converts raw PCM float samples into an MP3 file via lamejs
 * (a pure-JavaScript port of LAME — no native code, no network, runs fully
 * in the browser).
 *
 * The encoder is engine-agnostic: TTS engines return `{ samples: Float32Array,
 * sampleRate: number }` at their native sample rate (e.g. Kokoro = 24000 Hz
 * mono). We encode at that native rate — no resampling here.
 *
 * BROWSER WIRING: lamejs 1.x ships no working module entry — its `main`
 * (`src/js/index.js`) crashes under Node/bundlers (its `Lame.js` references
 * the `MPEGMode` global that only exists when the sources are concatenated).
 * The supported artifact is the concatenated bundle `lame.all.js` /
 * `lame.min.js`, which defines a `lamejs` global when loaded as a plain
 * `<script>`. Before calling `encodeMp3` in the browser, load that bundle so
 * `globalThis.lamejs` exists, e.g. copy `node_modules/lamejs/lame.min.js`
 * into `public/` and add `<script src="/lame.min.js" defer></script>`
 * (or `next/script`). This module resolves the encoder from
 * `globalThis.lamejs` at call time and throws a clear error if the bundle
 * was not loaded. The vitest suite evaluates the bundle into `globalThis`
 * the same way a `<script>` tag would.
 *
 * Caveats (verified against lamejs 1.2.1):
 * - 24000 Hz is accepted and encoded as MPEG-2 Layer III (legal MP3 rate).
 * - Requested bitrates above the MPEG-2 ceiling are silently capped by LAME:
 *   at 24000 Hz the maximum honored bitrate is 160 kbps (ask for 320, get
 *   160 — frame headers confirm this). Within range the bitrate is honored
 *   exactly (frame sizes match the CBR formula).
 * - Output is plain CBR with no ID3 tag and no Xing/VBR header
 *   (lamejs sets `bWriteVbrTag = false`, `write_id3tag_automatic = false`).
 */

/** Minimal typing for the lamejs browser bundle (no @types/lamejs on npm). */
interface LamejsMp3Encoder {
  /** Encode one block of 16-bit PCM samples (mono: left only). */
  encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
  /** Flush the encoder; returns the final delayed bytes. */
  flush(): Int8Array;
}

interface LamejsNamespace {
  Mp3Encoder: new (
    channels: number,
    sampleRate: number,
    kbps: number,
  ) => LamejsMp3Encoder;
}

/** lamejs encodes one MPEG frame per 1152 PCM samples. */
const SAMPLES_PER_FRAME = 1152;

const MIN_KBPS = 8;
const MAX_KBPS = 320;
const DEFAULT_KBPS = 128;

/** Resolve the lamejs namespace the host page (or test) must provide. */
function getLamejs(): LamejsNamespace {
  const ns = (globalThis as unknown as { lamejs?: LamejsNamespace }).lamejs;
  if (!ns || typeof ns.Mp3Encoder !== "function") {
    throw new Error(
      "encodeMp3: the lamejs bundle is not loaded — " +
        "include lame.min.js as a <script> so globalThis.lamejs exists before encoding",
    );
  }
  return ns;
}

/**
 * Encode mono float samples (-1..1) as an MP3 file's bytes.
 *
 * Values are hard-clipped to [-1, 1] before quantisation to guarantee no
 * integer overflow, mirroring `encodeWav`.
 *
 * @param samples    Mono 16-bit PCM float input at the native sample rate.
 * @param sampleRate Sample rate in Hz, e.g. 24000. Must be a finite integer
 *                   in the MP3-legal range 8000–48000.
 * @param kbps       Target bitrate; clamped to [8, 320], default 128. Note
 *                   LAME silently caps MPEG-2 rates (e.g. 24000 Hz) at
 *                   160 kbps — see module caveats.
 * @throws On empty/invalid input, unsupported sample rate, or if the lamejs
 *         bundle has not been loaded.
 */
export function encodeMp3(
  samples: Float32Array,
  sampleRate: number,
  kbps: number = DEFAULT_KBPS,
): Uint8Array {
  if (!(samples instanceof Float32Array) || samples.length === 0) {
    throw new Error("encodeMp3: samples must be a non-empty Float32Array");
  }
  if (
    !Number.isInteger(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > 48000
  ) {
    throw new Error(`encodeMp3: invalid sampleRate ${sampleRate}`);
  }
  if (!Number.isFinite(kbps)) {
    throw new Error(`encodeMp3: invalid kbps ${kbps}`);
  }
  const bitrate = Math.min(
    MAX_KBPS,
    Math.max(MIN_KBPS, Math.round(kbps)),
  );

  // Float (-1..1) -> Int16 with hard clipping, same convention as encodeWav.
  const pcm16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    pcm16[i] = Math.round(v * 32767);
  }

  const lamejs = getLamejs();
  let encoder: LamejsMp3Encoder;
  try {
    encoder = new lamejs.Mp3Encoder(1, sampleRate, bitrate);
  } catch (err) {
    throw new Error(
      `encodeMp3: lamejs rejected sampleRate=${sampleRate} kbps=${bitrate}: ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }

  const chunks: Int8Array[] = [];
  let totalBytes = 0;
  for (let offset = 0; offset < pcm16.length; offset += SAMPLES_PER_FRAME) {
    const block = pcm16.subarray(
      offset,
      Math.min(offset + SAMPLES_PER_FRAME, pcm16.length),
    );
    const out = encoder.encodeBuffer(block);
    chunks.push(out);
    totalBytes += out.length;
  }
  const tail = encoder.flush();
  chunks.push(tail);
  totalBytes += tail.length;

  const mp3 = new Uint8Array(totalBytes);
  let pos = 0;
  for (const chunk of chunks) {
    mp3.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), pos);
    pos += chunk.byteLength;
  }
  return mp3;
}
