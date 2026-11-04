/**
 * KittenTTS Nano voices + voice-embedding loader.
 *
 * Voice metadata mirrors the official KittenML v0.8 distribution
 * (KittenML/kitten-tts-nano-0.8-int8, config.json: voice_aliases and
 * speed_priors). The 8 style embeddings ship as the official `voices.npz`
 * (3.1 MB); each entry is a (400, 256) float32 array and the official
 * pipeline selects row min(len(text), 399).
 *
 * The npz uses ZIP64-style local headers (sizes = 0xFFFFFFFF), so entry
 * offsets/sizes are read from the zip CENTRAL DIRECTORY; entries themselves
 * are STORED (uncompressed). This is the in-browser twin of
 * scripts/kitten-npz.mjs — keep the two in sync.
 */
import type { Voice } from "../engine-interface";

export const KITTEN_VOICE_IDS = [
  "expr-voice-2-m",
  "expr-voice-2-f",
  "expr-voice-3-m",
  "expr-voice-3-f",
  "expr-voice-4-m",
  "expr-voice-4-f",
  "expr-voice-5-m",
  "expr-voice-5-f",
] as const;

export type KittenVoiceId = (typeof KITTEN_VOICE_IDS)[number];

/** Friendly aliases from the official config.json voice_aliases. */
export const KITTEN_VOICE_ALIASES: Record<string, KittenVoiceId> = {
  Bella: "expr-voice-2-f",
  Jasper: "expr-voice-2-m",
  Luna: "expr-voice-3-f",
  Bruno: "expr-voice-3-m",
  Rosie: "expr-voice-4-f",
  Hugo: "expr-voice-4-m",
  Kiki: "expr-voice-5-f",
  Leo: "expr-voice-5-m",
};

/** Per-voice speed priors from the official config.json. */
const SPEED_PRIORS: Record<KittenVoiceId, number> = {
  "expr-voice-2-f": 0.8,
  "expr-voice-2-m": 0.8,
  "expr-voice-3-m": 0.8,
  "expr-voice-3-f": 0.8,
  "expr-voice-4-m": 0.9,
  "expr-voice-4-f": 0.8,
  "expr-voice-5-m": 0.8,
  "expr-voice-5-f": 0.8,
};

export function speedPriorFor(voiceId: KittenVoiceId): number {
  return SPEED_PRIORS[voiceId] ?? 1.0;
}

const GENDER: Record<KittenVoiceId, "female" | "male"> = {
  "expr-voice-2-f": "female",
  "expr-voice-2-m": "male",
  "expr-voice-3-f": "female",
  "expr-voice-3-m": "male",
  "expr-voice-4-f": "female",
  "expr-voice-4-m": "male",
  "expr-voice-5-f": "female",
  "expr-voice-5-m": "male",
};

const ALIAS_OF = Object.fromEntries(
  Object.entries(KITTEN_VOICE_ALIASES).map(([alias, id]) => [id, alias]),
) as Record<KittenVoiceId, string>;

export const KITTEN_VOICES: Voice[] = KITTEN_VOICE_IDS.map((id) => ({
  id,
  name: ALIAS_OF[id],
  language: "en-US",
  gender: GENDER[id],
  description: `${ALIAS_OF[id]} — KittenTTS Nano expressive voice (${GENDER[id]}).`,
  accent: "American",
}));

export const DEFAULT_VOICE_ID: KittenVoiceId = "expr-voice-2-f"; // Bella (gate-verified)

export function isKnownVoice(id: string): id is KittenVoiceId {
  return (KITTEN_VOICE_IDS as readonly string[]).includes(id);
}

/** Resolve a friendly alias ("Bella") or raw id to the canonical voice id. */
export function resolveVoiceId(id: string): KittenVoiceId {
  if (isKnownVoice(id)) return id;
  const aliased = KITTEN_VOICE_ALIASES[id];
  if (aliased) return aliased;
  return DEFAULT_VOICE_ID;
}

export const STYLE_DIM = 256;
export const STYLE_ROWS = 400;

/**
 * Extract one voice's style matrix from the voices.npz bytes.
 * Returns the full (400, 256) float32 matrix; the caller selects the row.
 */
export function extractVoiceMatrix(
  npzBytes: Uint8Array,
  voiceId: KittenVoiceId,
): Float32Array {
  const entry = extractNpzEntry(npzBytes, `${voiceId}.npy`);
  const { shape, data } = parseNpyEntry(entry);
  if (shape.length !== 2 || shape[0] !== STYLE_ROWS || shape[1] !== STYLE_DIM) {
    throw new Error(
      `KittenTTS: unexpected style shape [${shape}] for ${voiceId} (expected [400, 256])`,
    );
  }
  return data;
}

const EOCD_SIG = 0x06054b50;
const CD_ENTRY_SIG = 0x02014b50;

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Locate a STORED entry via the zip central directory; return its bytes. */
export function extractNpzEntry(
  zipBytes: Uint8Array,
  entryName: string,
): Uint8Array {
  const dv = dataView(zipBytes);
  const len = zipBytes.length;
  let eocd = -1;
  for (let i = len - 22; i >= Math.max(0, len - 65558); i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("KittenTTS: npz end-of-central-directory not found");
  const cdCount = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  const decoder = new TextDecoder("utf-8");
  let off = cdOffset;
  for (let n = 0; n < cdCount; n++) {
    if (dv.getUint32(off, true) !== CD_ENTRY_SIG) {
      throw new Error("KittenTTS: corrupt npz central directory");
    }
    const method = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 24, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    const name = decoder.decode(zipBytes.subarray(off + 46, off + 46 + nameLen));
    if (name === entryName) {
      if (method !== 0) {
        throw new Error(
          `KittenTTS: npz entry ${name} uses compression method ${method} (only STORED is supported)`,
        );
      }
      const nameLenL = dv.getUint16(localOff + 26, true);
      const extraLenL = dv.getUint16(localOff + 28, true);
      const dataOff = localOff + 30 + nameLenL + extraLenL;
      return zipBytes.subarray(dataOff, dataOff + compSize);
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`KittenTTS: npz entry ${entryName} not found`);
}

/** Parse a .npy buffer into shape + float32 data (little-endian only). */
export function parseNpyEntry(bytes: Uint8Array): {
  shape: number[];
  data: Float32Array;
} {
  const dv = dataView(bytes);
  if (
    bytes[0] !== 0x93 ||
    String.fromCharCode(bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]) !== "NUMPY"
  ) {
    throw new Error("KittenTTS: not an npy buffer");
  }
  const headerLen = dv.getUint16(8, true);
  const header = String.fromCharCode(
    ...bytes.slice(10, 10 + headerLen),
  );
  const descr = /'descr':\s*'([^']+)'/.exec(header)?.[1];
  const shape =
    /'shape':\s*\(([^)]*)\)/
      .exec(header)?.[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number) ?? [];
  const fortran = /'fortran_order':\s*(True|False)/.exec(header)?.[1] === "True";
  if (descr !== "<f4" || fortran) {
    throw new Error(
      `KittenTTS: unsupported npy layout descr=${descr} fortran_order=${fortran}`,
    );
  }
  const dataStart = 10 + headerLen;
  const count = shape.reduce((a, b) => a * b, 1);
  return {
    shape,
    data: new Float32Array(bytes.buffer, bytes.byteOffset + dataStart, count),
  };
}
