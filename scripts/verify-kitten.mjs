#!/usr/bin/env node
/**
 * KittenTTS Nano real-audio verification gate.
 *
 * Proves the KittenTTS Nano int8 ONNX model (KittenML/kitten-tts-nano-0.8-int8,
 * Apache-2.0) performs genuine neural TTS in headless Chromium via
 * onnxruntime-web (WASM EP) + the `phonemizer` npm package (espeak-ng,
 * GPL-3.0 — already a kokoro-js dependency, documented in
 * THIRD-PARTY-NOTICES.md). The in-page pipeline replicates the official
 * KittenML v0.8 inference (kittentts_legacy/onnx_model.py):
 * espeak phonemize (en-us) → char-level TextCleaner vocab → [0, ids, 10, 0]
 * token framing → style embedding voices[voice][min(len(text),399)] →
 * ONNX session → trim last 5000 samples → 24 kHz WAV.
 *
 * NO mocks anywhere: the WAV bytes are re-validated independently in Node.
 * PASS = real KittenTTS inference ran in the browser.
 *
 * First run bootstraps assets into $KITTEN_ASSET_DIR (default
 * /tmp/kitten-verify): model + voices.npz from HuggingFace, ORT WASM and the
 * phonemizer bundle from node_modules. Nothing is committed to the repo.
 *
 * Usage: node scripts/verify-kitten.mjs [--text "..."]
 */
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, copyFile, stat } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const ASSET_DIR = process.env.KITTEN_ASSET_DIR || "/tmp/kitten-verify";
const HF = "https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8/resolve/main";
const PORT = 3199;
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const TEXT = opt("--text", "Hello. This is a verification test of the KittenTTS Nano engine. Real neural speech, synthesized locally in your browser.");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".onnx": "application/octet-stream" };

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function download(url, dest) {
  console.log(`[gate] downloading ${url.split("/").slice(-1)[0]}…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${url} -> ${res.status}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

/** The gate page. Replicates the official KittenML v0.8 pipeline in-page. */
const PAGE = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>KittenTTS Nano gate</title></head><body>
<script type="module">
import * as ort from "./ort/ort.min.mjs";
import { phonemize } from "./phonemizer.mjs";
// Vocab mirrors the official KittenML v0.8 TextCleaner (see scripts/kitten-vocab.json);
// served as vocab.json so the gate page and engines/kitten/vocab.ts share one source.
const vocabJson = await fetch("./vocab.json").then(r => r.json());
const symbols = [vocabJson.pad, ...vocabJson.punctuation, ...vocabJson.letters, ...vocabJson.ipa];
const vocab = new Map(symbols.map((s, i) => [s, i]));
const VOICE = "expr-voice-2-f";
const SPEED_PRIOR = 0.8;
function textToTokenIds(phonemes) {
  const joined = (phonemes.match(/\\w+|[^\\w\\s]/gu) || []).join(" ");
  const ids = [];
  for (const ch of joined) { const id = vocab.get(ch); if (id !== undefined) ids.push(id); }
  return [0, ...ids, 10, 0];
}
function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); ws(8, "WAVE");
  ws(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); ws(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}
async function main() {
  const params = new URLSearchParams(location.search);
  const TEXT = params.get("text");
  const t0 = performance.now();
  try {
    ort.env.wasm.wasmPaths = "/ort/";
    ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 4);
    const [modelBuf, voicesJson] = await Promise.all([
      fetch("./kitten_tts_nano_v0_8.onnx").then(r => { if (!r.ok) throw new Error("model fetch " + r.status); return r.arrayBuffer(); }),
      fetch("./voices.json").then(r => { if (!r.ok) throw new Error("voices fetch " + r.status); return r.json(); }),
    ]);
    const session = await ort.InferenceSession.create(modelBuf, { executionProviders: ["wasm"] });
    const loadMs = performance.now() - t0;
    const tp0 = performance.now();
    const phonemes = (await phonemize(TEXT, "en-us")).join(" ");
    const phonemizeMs = performance.now() - tp0;
    const tokenIds = textToTokenIds(phonemes);
    const refId = Math.min(TEXT.length, 399); // official: voices[voice][min(len(text), rows-1)]
    const flat = voicesJson[VOICE]; // flat float32 array, 400 rows x 256
    const styleArr = new Float32Array(flat.slice(refId * 256, refId * 256 + 256));
    const inputs = {
      input_ids: new ort.Tensor("int64", BigInt64Array.from(tokenIds.map(BigInt)), [1, tokenIds.length]),
      style: new ort.Tensor("float32", styleArr, [1, styleArr.length]),
      speed: new ort.Tensor("float32", new Float32Array([1.0 * SPEED_PRIOR]), [1]),
    };
    const ts0 = performance.now();
    const outputs = await session.run(inputs);
    const synthMs = performance.now() - ts0;
    const outName = session.outputNames[0];
    let audio = Array.from(outputs[outName].data);
    audio = audio.slice(0, Math.max(0, audio.length - 5000));
    let peak = 0, nonSilent = 0;
    for (const s of audio) { const a = Math.abs(s); if (a > peak) peak = a; if (a > 0.01) nonSilent++; }
    const bytes = new Uint8Array(encodeWav(new Float32Array(audio), 24000));
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    window.__kitten_verify = { ok: true, wavBase64: btoa(bin), peak,
      nonSilentFraction: nonSilent / audio.length, phonemes: phonemes.slice(0, 200),
      tokenCount: tokenIds.length, refId, outName,
      loadMs: Math.round(loadMs), phonemizeMs: Math.round(phonemizeMs), synthMs: Math.round(synthMs) };
  } catch (e) { window.__kitten_verify = { ok: false, error: String((e && e.stack) || e) }; }
}
main();
</script></body></html>`;

async function bootstrap() {
  await mkdir(ASSET_DIR, { recursive: true });
  await mkdir(join(ASSET_DIR, "ort"), { recursive: true });
  const model = join(ASSET_DIR, "kitten_tts_nano_v0_8.onnx");
  const npz = join(ASSET_DIR, "voices.npz");
  if (!(await exists(model))) await download(`${HF}/kitten_tts_nano_v0_8.onnx?download=true`, model);
  if (!(await exists(npz))) await download(`${HF}/voices.npz?download=true`, npz);
  const ortDir = join(REPO, "node_modules", "onnxruntime-web", "dist");
  for (const f of ["ort.min.mjs", "ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.jsep.wasm", "ort-wasm-simd-threaded.jsep.mjs"]) {
    const dest = join(ASSET_DIR, "ort", f);
    if (!(await exists(dest))) await copyFile(join(ortDir, f), dest);
  }
  const phon = join(ASSET_DIR, "phonemizer.mjs");
  if (!(await exists(phon))) await copyFile(join(REPO, "node_modules", "phonemizer", "dist", "phonemizer.js"), phon);
  const vocabDest = join(ASSET_DIR, "vocab.json");
  if (!(await exists(vocabDest))) {
    // Single source of truth for the TextCleaner vocab (extracted from the
    // official KittenML source — see scripts/kitten-vocab.json provenance).
    await copyFile(join(REPO, "scripts", "kitten-vocab.json"), vocabDest);
  }
  const voicesJson = join(ASSET_DIR, "voices.json");
  if (!(await exists(voicesJson))) {
    console.log("[gate] converting voices.npz -> voices.json (stored entries, float32)…");
    const { parseVoicesNpz } = await import("./kitten-npz.mjs");
    const voices = await parseVoicesNpz(npz);
    writeFileSync(voicesJson, JSON.stringify(voices));
    console.log(`[gate] voices.json written (${Object.keys(voices).length} voices)`);
  }
  await writeFile(join(ASSET_DIR, "index.html"), PAGE);
}

const checks = [];
const check = (name, cond, detail = "") => checks.push({ name, pass: !!cond, detail: String(detail) });

await bootstrap();
const server = createServer(async (req, res) => {
  try {
    const p = join(ASSET_DIR, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html");
    const data = await readFile(p);
    res.writeHead(200, {
      "Content-Type": MIME[extname(p)] || "application/octet-stream",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Content-Length": data.length,
    });
    res.end(data);
  } catch { res.writeHead(404); res.end("nf"); }
});

await new Promise((r) => server.listen(PORT, r));
console.log(`[gate] serving ${ASSET_DIR} on :${PORT}`);
try {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));
  await page.goto(`http://localhost:${PORT}/index.html?text=${encodeURIComponent(TEXT)}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  console.log("[gate] waiting for synthesis (up to 10 min)…");
  await page.waitForFunction(() => window.__kitten_verify !== undefined, null, { timeout: 10 * 60 * 1000, polling: 2000 });
  const r = await page.evaluate(() => window.__kitten_verify);
  await browser.close();
  console.log("[gate] phonemes:", r.phonemes);
  console.log("[gate] timings ms:", JSON.stringify({ loadMs: r.loadMs, phonemizeMs: r.phonemizeMs, synthMs: r.synthMs }), "tokens:", r.tokenCount);

  check("page reported ok", r.ok === true, r.error || "");
  if (!r.ok) throw new Error("page failed: " + r.error);
  const wav = Buffer.from(r.wavBase64, "base64");
  const wavPath = join(REPO, "docs", "evidence", "kitten-verify.wav");
  writeFileSync(wavPath, wav);
  console.log(`[gate] WAV evidence: ${wavPath} (${wav.length} bytes)`);

  check("WAV magic is RIFF", wav.subarray(0, 4).toString() === "RIFF");
  check("WAVE format", wav.subarray(8, 12).toString() === "WAVE");
  const sampleRate = wav.readUInt32LE(24);
  check("sample rate is 24000 Hz", sampleRate === 24000, sampleRate);
  check("mono", wav.readUInt16LE(22) === 1);
  check("16-bit PCM", wav.readUInt16LE(34) === 16);
  const dataBytes = wav.readUInt32LE(40);
  check("data size matches header", dataBytes === wav.length - 44, `${dataBytes} vs ${wav.length - 44}`);
  const numSamples = dataBytes / 2;
  const durationSec = numSamples / sampleRate;
  check("duration plausible (1.5s–30s)", durationSec > 1.5 && durationSec < 30, durationSec.toFixed(2) + "s");
  let peak = 0, nonSilent = 0;
  for (let i = 0; i < numSamples; i++) {
    const v = Math.abs(wav.readInt16LE(44 + i * 2) / 32768);
    if (v > peak) peak = v;
    if (v > 0.01) nonSilent++;
  }
  const nsf = nonSilent / numSamples;
  check("not silent (peak > 0.02)", peak > 0.02, peak.toFixed(4));
  check("non-silent fraction > 0.05", nsf > 0.05, nsf.toFixed(4));

  const report = {
    date: new Date().toISOString(),
    engine: "kitten-tts-nano-0.8-int8 (KittenML/kitten-tts-nano-0.8-int8, Apache-2.0)",
    modelBytes: 24369971, voicesNpzBytes: 3278902,
    phonemizer: "phonemizer@1.2.1 (xenova; bundles espeak-ng GPL-3.0 — already a kokoro-js dep)",
    ort: "onnxruntime-web (wasm EP), threads<=4",
    voice: "expr-voice-2-f (Bella)", sampleRate, numSamples,
    durationSec: +durationSec.toFixed(2), peak: +peak.toFixed(4), nonSilentFraction: +nsf.toFixed(4),
    loadMs: r.loadMs, phonemizeMs: r.phonemizeMs, synthMs: r.synthMs,
    realtimeFactor: r.synthMs ? +(r.synthMs / 1000 / durationSec).toFixed(3) : null,
    text: TEXT, checks, pass: checks.every((c) => c.pass),
  };
  writeFileSync(join(REPO, "docs", "evidence", "kitten-verify.json"), JSON.stringify(report, null, 2));
  console.log("\n[gate] CHECKS:");
  for (const c of checks) console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
  console.log(report.pass ? "\n[gate] GATE PASSED — real KittenTTS audio verified." : "\n[gate] GATE FAILED.");
  process.exitCode = report.pass ? 0 : 1;
} catch (e) {
  console.error("[gate] FATAL:", e);
  process.exitCode = 1;
} finally {
  server.close();
}
