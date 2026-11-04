#!/usr/bin/env node
/**
 * Minimal .npz reader for KittenTTS voices.npz (Node version).
 *
 * The official voices.npz was written with ZIP64-style local headers
 * (compressed size = 0xFFFFFFFF), so entry sizes/offsets are read from the
 * zip CENTRAL DIRECTORY, not the local headers. Entries themselves are
 * STORED (uncompressed, method 0 — verified 2026-11-04).
 *
 * Layout per voice entry: .npy = magic + header + float32 LE data,
 * shape (400, 256): 400 text-length-dependent style rows; the official
 * pipeline selects row min(len(text), 399).
 *
 * The in-browser twin of this logic lives in engines/kitten/voices.ts
 * (findCentralDirectoryEntry / parseNpyEntry) — keep the two in sync.
 * Used by scripts/verify-kitten.mjs to build voices.json for the gate page.
 */
import { readFile } from "node:fs/promises";

const EOCD_SIG = 0x06054b50;
const CD_ENTRY_SIG = 0x02014b50;

export function parseNpyEntry(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] !== 0x93 || String.fromCharCode(...bytes.slice(1, 6)) !== "NUMPY") {
    throw new Error("not an npy buffer");
  }
  const headerLen = dv.getUint16(8, true);
  const header = String.fromCharCode(...bytes.slice(10, 10 + headerLen));
  const descr = /'descr':\s*'([^']+)'/.exec(header)?.[1];
  const shape = /'shape':\s*\(([^)]*)\)/.exec(header)?.[1]
    .split(",").map((s) => s.trim()).filter(Boolean).map(Number);
  const fortran = /'fortran_order':\s*(True|False)/.exec(header)?.[1] === "True";
  if (descr !== "<f4" || fortran) {
    throw new Error(`unsupported npy layout: descr=${descr} fortran_order=${fortran}`);
  }
  const dataStart = 10 + headerLen;
  const count = shape.reduce((a, b) => a * b, 1);
  const data = new Float32Array(bytes.buffer, bytes.byteOffset + dataStart, count);
  return { shape, data: Array.from(data) };
}

/** Locate a named entry via the zip central directory. Returns data bytes. */
export function extractNpzEntry(zipBytes, entryName) {
  const dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const len = zipBytes.length;
  // Find End of Central Directory (scan back up to 64K + 22 bytes).
  let eocd = -1;
  for (let i = len - 22; i >= Math.max(0, len - 65558); i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("npz: end-of-central-directory not found");
  const cdCount = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  let off = cdOffset;
  for (let n = 0; n < cdCount; n++) {
    if (dv.getUint32(off, true) !== CD_ENTRY_SIG) throw new Error("npz: bad central directory entry");
    const method = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 24, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    const name = Buffer.from(zipBytes.subarray(off + 46, off + 46 + nameLen)).toString("utf8");
    if (name === entryName) {
      if (method !== 0) throw new Error(`npz entry ${name} is compressed (method ${method}) — only STORED is supported`);
      // Skip the local header to reach the data.
      const nameLenL = dv.getUint16(localOff + 26, true);
      const extraLenL = dv.getUint16(localOff + 28, true);
      const dataOff = localOff + 30 + nameLenL + extraLenL;
      return zipBytes.subarray(dataOff, dataOff + compSize);
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`npz: entry ${entryName} not found`);
}

/** Parse every voice entry of voices.npz into {voiceName: number[]}. */
export async function parseVoicesNpz(path) {
  const buf = await readFile(path);
  const out = {};
  const names = ["expr-voice-2-m", "expr-voice-2-f", "expr-voice-3-m", "expr-voice-3-f",
    "expr-voice-4-m", "expr-voice-4-f", "expr-voice-5-m", "expr-voice-5-f"];
  for (const voice of names) {
    const entry = extractNpzEntry(buf, `${voice}.npy`);
    out[voice] = parseNpyEntry(entry).data;
  }
  return out;
}
