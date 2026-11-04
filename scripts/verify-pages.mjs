#!/usr/bin/env node
/**
 * FreeTTS Cloudflare Pages artifact verification gate.
 *
 * Proves the static export (out/, built by scripts/build-pages.sh) really
 * synthesizes speech in a browser:
 *
 * 1. Copies the verification model mirror into out/api/verify-assets/
 *    (same layout the dev-only Next route serves; production loads the
 *    same bytes from the HuggingFace CDN instead).
 * 2. Serves out/ statically WITH the COOP/COEP headers from public/_headers
 *    (what Cloudflare Pages will send).
 * 3. Opens /verify in headless Chromium, synthesizes a test sentence via the
 *    real Kokoro worker, and independently re-validates the WAV bytes in Node.
 *
 * PASS = the Pages artifact performs real in-browser inference.
 * Usage: node scripts/verify-pages.mjs [--text "..."] [--voice af_heart]
 */
import { cpSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, normalize, sep } from "node:path";
import { chromium } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "out");
const PORT = 3101;
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const TEXT = opt("--text", "Hello. This is a verification test of the FreeTTS Pages build. Real artificial intelligence is speaking locally, inside your browser.");
const VOICE = opt("--voice", "af_heart");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".bin": "application/octet-stream",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain",
  ".ico": "image/x-icon",
};

function serveStatic() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      // The two headers Cloudflare Pages sends via public/_headers.
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      let rel = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^\//, "");
      if (rel.startsWith("..") || rel.includes(`..${sep}`)) {
        res.writeHead(403); res.end("forbidden"); return;
      }
      let file = join(OUT, rel);
      const candidates = [file, file + ".html", join(file, "index.html")];
      const found = candidates.find((c) => {
        try { return statSync(c).isFile(); } catch { return false; }
      });
      if (!found) { res.writeHead(404); res.end("not found"); return; }
      const ext = found.slice(found.lastIndexOf("."));
      res.setHeader("Content-Type", CONTENT_TYPES[ext] ?? "application/octet-stream");
      res.writeHead(200);
      res.end(readFileSync(found));
    });
    server.listen(PORT, () => resolve(server));
  });
}

const checks = [];
function check(name, cond, detail = "") {
  checks.push({ name, pass: !!cond, detail: String(detail) });
}

let server = null;
try {
  if (!existsSync(OUT)) throw new Error("out/ missing — run scripts/build-pages.sh first");

  // 1. Stage the mirror as static files under out/api/verify-assets/.
  const dest = join(OUT, "api", "verify-assets");
  mkdirSync(dest, { recursive: true });
  for (const sub of ["mirror", "ort"]) {
    const src = join(ROOT, ".verify-assets", sub);
    if (existsSync(src)) cpSync(src, join(dest, sub), { recursive: true });
  }
  console.log("[verify-pages] mirror staged under out/api/verify-assets/");

  // 2. Serve out/ with Pages-equivalent headers.
  server = await serveStatic();
  console.log(`[verify-pages] static server on :${PORT} (COOP/COEP set)`);

  // 3. Real browser, real inference.
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 400)));
  const url = `http://localhost:${PORT}/verify?text=${encodeURIComponent(TEXT)}&voice=${VOICE}&assets=1`;
  console.log("[verify-pages] loading", url.slice(0, 110) + "…");
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  console.log("[verify-pages] waiting for synthesis (up to 15 min)…");
  await page.waitForFunction(() => window.__ftts_verify !== undefined, null, {
    timeout: 15 * 60 * 1000, polling: 2000,
  });
  const r = await page.evaluate(() => window.__ftts_verify);
  await browser.close();
  console.log("[verify-pages] result:", JSON.stringify({ ...r, wavBase64: `[${(r.wavBase64 || "").length} chars]` }));

  // 4. Independent Node-side WAV validation (same bar as verify-audio.mjs).
  check("page reported ok", r.ok === true, r.error || "");
  if (!r.ok) throw new Error(`page failed: ${r.error}`);
  const wav = Buffer.from(r.wavBase64, "base64");
  writeFileSync(join(ROOT, "docs/evidence/freetts-verify-pages.wav"), wav);
  console.log(`[verify-pages] WAV evidence: docs/evidence/freetts-verify-pages.wav (${wav.length} bytes)`);
  check("WAV magic is RIFF", wav.subarray(0, 4).toString() === "RIFF");
  check("WAVE format", wav.subarray(8, 12).toString() === "WAVE");
  const sampleRate = wav.readUInt32LE(24);
  const numChannels = wav.readUInt16LE(22);
  const bits = wav.readUInt16LE(34);
  const dataBytes = wav.readUInt32LE(40);
  check("sample rate is 24000 Hz", sampleRate === 24000, sampleRate);
  check("mono", numChannels === 1, numChannels);
  check("16-bit PCM", bits === 16, bits);
  check("data size matches header", dataBytes === wav.length - 44, `${dataBytes} vs ${wav.length - 44}`);
  const numSamples = dataBytes / 2;
  const durationSec = numSamples / sampleRate;
  check("duration plausible for text (1.5s–20s)", durationSec > 1.5 && durationSec < 20, durationSec.toFixed(2) + "s");
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
    artifact: "cloudflare-pages static export (out/)",
    text: TEXT, voice: VOICE, device: r.device,
    sampleRate, numChannels, bits, numSamples,
    durationSec: +durationSec.toFixed(2),
    peak: +peak.toFixed(4), nonSilentFraction: +nsf.toFixed(4),
    chunkCount: r.chunkCount, loadMs: r.loadMs, synthMs: r.synthMs,
    realtimeFactor: r.synthMs ? +(r.synthMs / 1000 / durationSec).toFixed(3) : null,
    wavBytes: wav.length, checks,
    pass: checks.every((c) => c.pass),
  };
  writeFileSync(join(ROOT, "docs/evidence/freetts-verify-pages.json"), JSON.stringify(report, null, 2));
  console.log("\n[verify-pages] CHECKS:");
  for (const c of checks) console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
  console.log(report.pass ? "\n[verify-pages] GATE PASSED — Pages artifact synthesizes real audio." : "\n[verify-pages] GATE FAILED.");
  process.exitCode = report.pass ? 0 : 1;
} catch (e) {
  console.error("[verify-pages] FATAL:", e);
  process.exitCode = 1;
} finally {
  if (server) server.close();
}
