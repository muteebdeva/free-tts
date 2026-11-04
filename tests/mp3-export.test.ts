import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { encodeMp3 } from "../audio/mp3-export";

/**
 * lamejs 1.x has no working module entry (its CJS `main` crashes — see
 * audio/mp3-export.ts), so we load the supported browser bundle exactly the
 * way a `<script>` tag would: evaluate it once and expose the `lamejs`
 * global it defines.
 */
beforeAll(() => {
  const require = createRequire(import.meta.url);
  const bundlePath = require.resolve("lamejs/lame.all.js");
  const src = readFileSync(bundlePath, "utf8");
  const factory = new Function(`${src}\n;return lamejs;`) as () => unknown;
  (globalThis as Record<string, unknown>).lamejs = factory();
  expect((globalThis as Record<string, unknown>).lamejs).toBeTruthy();
});

/** 2 s of a 440 Hz sine at 24 kHz, amplitude 0.5 — Kokoro's native rate. */
function makeSine(seconds = 2, sampleRate = 24000): Float32Array {
  const n = Math.floor(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  }
  return out;
}

interface FrameInfo {
  version: number; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
  layer: number; // 1 = Layer III
  bitrate: number; // bps
  sampleRate: number; // Hz
  frameLength: number; // bytes including header
}

/** Parse one MP3 frame header at `offset`; throws on anything invalid. */
function parseFrameHeader(bytes: Uint8Array, offset: number): FrameInfo {
  if (offset + 4 > bytes.length) throw new Error("truncated frame header");
  const b0 = bytes[offset];
  const b1 = bytes[offset + 1];
  const b2 = bytes[offset + 2];
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) {
    throw new Error(`bad frame sync at offset ${offset}`);
  }
  const version = (b1 >> 3) & 0x3;
  const layer = (b1 >> 1) & 0x3;
  if (version === 1) throw new Error("reserved MPEG version");
  if (layer !== 1) throw new Error(`expected Layer III, got layer bits ${layer}`);
  const bitrateIdx = (b2 >> 4) & 0xf;
  const srIdx = (b2 >> 2) & 0x3;
  const padding = (b2 >> 1) & 0x1;
  if (bitrateIdx === 0 || bitrateIdx === 15) throw new Error("bad bitrate index");
  if (srIdx === 3) throw new Error("reserved sample-rate index");

  const mpeg1 = version === 3;
  const bitrateTable = mpeg1
    ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
    : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const srTable = mpeg1
    ? [44100, 48000, 32000]
    : version === 2
      ? [22050, 24000, 16000]
      : [11025, 12000, 8000];
  const bitrate = bitrateTable[bitrateIdx] * 1000;
  const sampleRate = srTable[srIdx];
  const frameLength = Math.floor((144 * bitrate) / sampleRate) + padding;
  return { version, layer, bitrate, sampleRate, frameLength };
}

describe("encodeMp3", () => {
  it("encodes a 2 s 440 Hz sine at 24 kHz into a valid MP3 stream", () => {
    const mp3 = encodeMp3(makeSine(), 24000);

    expect(mp3.length).toBeGreaterThan(0);
    // Frame sync: 0xFF followed by top 3 bits set.
    expect(mp3[0]).toBe(0xff);
    expect(mp3[1] & 0xe0).toBe(0xe0);

    // Size plausibility: 128 kbps * 2 s = 32 000 bytes, ±50%.
    expect(mp3.length).toBeGreaterThan(16_000);
    expect(mp3.length).toBeLessThan(48_000);
  });

  it("produces valid MPEG-2 Layer III headers at 24000 Hz / 128 kbps", () => {
    const mp3 = encodeMp3(makeSine(), 24000, 128);
    const first = parseFrameHeader(mp3, 0);
    // 24000 Hz is a legal-but-uncommon MP3 rate (MPEG-2); confirm the
    // encoder really accepted it instead of assuming.
    expect(first.version).toBe(2); // MPEG-2
    expect(first.layer).toBe(1); // Layer III
    expect(first.sampleRate).toBe(24000);
    // Bitrate honored: 128 kbps -> 144*128000/24000 = 768-byte frames.
    expect(first.bitrate).toBe(128_000);
    expect(first.frameLength).toBe(768);
  });

  it("walks the first ~10 frames with valid headers throughout", () => {
    const mp3 = encodeMp3(makeSine(), 24000, 128);
    let offset = 0;
    let frames = 0;
    for (let i = 0; i < 10; i++) {
      const info = parseFrameHeader(mp3, offset);
      offset += info.frameLength;
      frames++;
    }
    expect(frames).toBe(10);
    expect(offset).toBeLessThan(mp3.length);

    // Whole stream should be a plausible frame count for 2 s at 24 kHz
    // (48000 samples / 1152 per frame ≈ 42 frames + encoder flush tail).
    let total = 0;
    offset = 0;
    while (offset + 4 <= mp3.length) {
      const info = parseFrameHeader(mp3, offset);
      offset += info.frameLength;
      total++;
      if (total > 100) throw new Error("runaway frame walk");
    }
    expect(total).toBeGreaterThanOrEqual(40);
    expect(total).toBeLessThanOrEqual(46);
  });

  it("honors a lower bitrate (64 kbps -> 384-byte frames at 24 kHz)", () => {
    const mp3 = encodeMp3(makeSine(), 24000, 64);
    const first = parseFrameHeader(mp3, 0);
    expect(first.bitrate).toBe(64_000);
    expect(first.frameLength).toBe(384);
  });

  it("clamps kbps into range instead of throwing", () => {
    const mp3 = encodeMp3(makeSine(), 24000, 1000);
    expect(mp3.length).toBeGreaterThan(0);
    expect(mp3[0]).toBe(0xff);
    const low = encodeMp3(makeSine(), 24000, 1);
    expect(low.length).toBeGreaterThan(0);
  });

  it("throws on invalid inputs", () => {
    const sine = makeSine();
    expect(() => encodeMp3(new Float32Array(0), 24000)).toThrow();
    expect(() => encodeMp3(sine, 0)).toThrow();
    expect(() => encodeMp3(sine, -24000)).toThrow();
    expect(() => encodeMp3(sine, NaN)).toThrow();
    expect(() => encodeMp3(sine, 24000.5)).toThrow();
    expect(() => encodeMp3(sine, 96_000)).toThrow(); // outside MP3 range
    expect(() => encodeMp3(sine, 24000, NaN)).toThrow();
    expect(() => encodeMp3("nope" as unknown as Float32Array, 24000)).toThrow();
  });

  it("throws a clear error when the lamejs bundle is not loaded", () => {
    const g = globalThis as Record<string, unknown>;
    const saved = g.lamejs;
    delete g.lamejs;
    try {
      expect(() => encodeMp3(makeSine(0.1), 24000)).toThrow(/lamejs bundle/);
    } finally {
      g.lamejs = saved;
    }
  });
});
