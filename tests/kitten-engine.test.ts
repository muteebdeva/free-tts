import { describe, expect, it } from "vitest";
import { textToTokenIds } from "../engines/kitten/kitten-engine";
import {
  DEFAULT_VOICE_ID,
  KITTEN_VOICES,
  extractNpzEntry,
  isKnownVoice,
  parseNpyEntry,
  resolveVoiceId,
} from "../engines/kitten/voices";
import { KITTEN_VOCAB } from "../engines/kitten/vocab";

describe("KITTEN_VOCAB (official TextCleaner order)", () => {
  it("has 175 unique symbols (178 list entries; 3 duplicates collapse last-wins, exactly like the official dict)", () => {
    // '"' appears 3× and "'" 2× in the official symbol list; the official
    // `dicts[symbols[i]] = i` keeps the LAST index — our Map does the same.
    expect(KITTEN_VOCAB.size).toBe(175);
  });
  it("id 0 is '$' and id 10 is '…'", () => {
    expect(KITTEN_VOCAB.get("$")).toBe(0);
    expect(KITTEN_VOCAB.get("…")).toBe(10);
  });
});

describe("textToTokenIds", () => {
  it("frames ids as [0, …ids, 10, 0] like the official pipeline", () => {
    const ids = textToTokenIds("həlˈoʊ");
    expect(ids[0]).toBe(0);
    expect(ids[ids.length - 2]).toBe(10);
    expect(ids[ids.length - 1]).toBe(0);
    expect(ids.length).toBeGreaterThan(3);
  });
  it("maps every char through the vocab", () => {
    const ids = textToTokenIds("ab");
    // "ab" → tokens ["ab"] → joined "ab" → chars a, b
    expect(ids).toEqual([0, KITTEN_VOCAB.get("a")!, KITTEN_VOCAB.get("b")!, 10, 0]);
  });
  it("skips characters missing from the vocab (official KeyError pass)", () => {
    // "a😀b" tokenizes to ["a", "😀", "b"], joined as "a 😀 b" — the spaces
    // are real vocab entries, the emoji is skipped like the official pass.
    expect(textToTokenIds("a😀b")).toEqual([
      0,
      KITTEN_VOCAB.get("a")!,
      KITTEN_VOCAB.get(" ")!,
      KITTEN_VOCAB.get(" ")!,
      KITTEN_VOCAB.get("b")!,
      10,
      0,
    ]);
  });
  it("keeps punctuation the official vocab covers", () => {
    const ids = textToTokenIds("hi!");
    expect(ids).toContain(KITTEN_VOCAB.get("!"));
  });
});

describe("voice registry", () => {
  it("exposes 8 voices with aliases, genders, en-US", () => {
    expect(KITTEN_VOICES).toHaveLength(8);
    const bella = KITTEN_VOICES.find((v) => v.name === "Bella")!;
    expect(bella.id).toBe("expr-voice-2-f");
    expect(bella.gender).toBe("female");
    expect(bella.language).toBe("en-US");
    const leo = KITTEN_VOICES.find((v) => v.name === "Leo")!;
    expect(leo.gender).toBe("male");
  });
  it("resolveVoiceId handles aliases, raw ids, and unknowns", () => {
    expect(resolveVoiceId("Bella")).toBe("expr-voice-2-f");
    expect(resolveVoiceId("expr-voice-5-m")).toBe("expr-voice-5-m");
    expect(resolveVoiceId("nope")).toBe(DEFAULT_VOICE_ID);
    expect(isKnownVoice("expr-voice-3-f")).toBe(true);
    expect(isKnownVoice("Bella")).toBe(false);
  });
});

/** Build a minimal .npy buffer (float32 LE, C-order). */
function makeNpy(shape: number[], data: number[]): Uint8Array {
  const headerStr = `{'descr': '<f4', 'fortran_order': False, 'shape': (${shape.join(", ")},), }`;
  // npy v1.0: 10 + headerLen must be a multiple of 64; the header ends with \n.
  const headerLen = 64 * Math.ceil((10 + headerStr.length + 1) / 64) - 10;
  const header =
    headerStr + " ".repeat(headerLen - headerStr.length - 1) + "\n";
  const hlen = header.length;
  const out = new Uint8Array(10 + hlen + data.length * 4);
  out[0] = 0x93;
  for (let i = 0; i < 5; i++) out[1 + i] = "NUMPY".charCodeAt(i);
  out[6] = 1; out[7] = 0;
  out[8] = hlen & 0xff; out[9] = (hlen >> 8) & 0xff;
  for (let i = 0; i < hlen; i++) out[10 + i] = header.charCodeAt(i);
  new Float32Array(out.buffer, 10 + hlen, data.length).set(data);
  return out;
}

/**
 * Build a minimal .npz-equivalent zip: STORED entries, central directory,
 * and the real-world quirk — local headers with size 0xFFFFFFFF (ZIP64
 * style), true sizes only in the central directory.
 */
function makeNpz(entries: Array<[string, Uint8Array]>): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  const enc = new TextEncoder();
  let offset = 0;
  const dv = new DataView(new ArrayBuffer(4));
  const u32 = (n: number) => {
    dv.setUint32(0, n, true);
    return new Uint8Array(dv.buffer.slice(0));
  };
  const u16 = (n: number) => {
    dv.setUint16(0, n, true);
    return new Uint8Array(dv.buffer.slice(0, 2));
  };
  for (const [name, data] of entries) {
    const nameB = enc.encode(name);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(0xffffffff), u32(0xffffffff), u32(0xffffffff), // sizes: unknown here
      u16(nameB.length), u16(0), nameB,
    ]);
    parts.push(local, data);
    central.push(
      Buffer.concat([
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(0), u32(data.length), u32(data.length),
        u16(nameB.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameB,
      ]),
    );
    offset += local.length + data.length;
  }
  const cdStart = offset;
  const cd = Buffer.concat(central);
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0),
    u16(entries.length), u16(entries.length),
    u32(cd.length), u32(cdStart), u16(0),
  ]);
  return Buffer.concat([...parts, cd, eocd]);
}

describe("parseNpyEntry", () => {
  it("parses shape and float32 LE data", () => {
    const { shape, data } = parseNpyEntry(makeNpy([2, 3], [1, 2, 3, 4, 5, 6]));
    expect(shape).toEqual([2, 3]);
    expect(Array.from(data)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("rejects non-npy buffers", () => {
    expect(() => parseNpyEntry(new Uint8Array([1, 2, 3]))).toThrow();
  });
});

describe("extractNpzEntry", () => {
  it("finds entries via the central directory despite 0xFFFFFFFF local sizes", () => {
    const npy = makeNpy([1, 2], [0.5, -0.25]);
    const zip = makeNpz([["expr-voice-2-f.npy", npy]]);
    const entry = extractNpzEntry(zip, "expr-voice-2-f.npy");
    expect(entry.length).toBe(npy.length);
    const { shape, data } = parseNpyEntry(entry);
    expect(shape).toEqual([1, 2]);
    expect(data[0]).toBeCloseTo(0.5);
    expect(data[1]).toBeCloseTo(-0.25);
  });
  it("throws for a missing entry", () => {
    const zip = makeNpz([["a.npy", makeNpy([1], [1])]]);
    expect(() => extractNpzEntry(zip, "nope.npy")).toThrow(/not found/);
  });
});
