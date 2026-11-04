#!/usr/bin/env node
/**
 * FreeTTS real-audio verification gate.
 *
 * 1. Starts `next dev` on port 3100.
 * 2. Opens /verify in headless Chromium (real browser, real WebAssembly/WebGPU).
 * 3. The page loads Kokoro-82M via kokoro-js in a Web Worker, synthesizes a
 *    test sentence, encodes a WAV in-page, and exposes byte-level stats.
 * 4. This script independently re-validates the WAV bytes in Node and writes
 *    an evidence report.
 *
 * PASS = real open-source TTS inference ran in the browser. Any failure here
 * is a hard STOP: the project must not proceed to UI work on fake audio.
 *
 * Usage: node scripts/verify-audio.mjs [--text "..."] [--voice af_heart]
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";

const PORT = 3100;
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const TEXT = opt("--text", "Hello. This is a verification test of the FreeTTS speech engine. Real artificial intelligence is speaking locally, inside your browser.");
const VOICE = opt("--voice", "af_heart");

function startDevServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn("npx", ["next", "dev", "--port", String(PORT)], {
      cwd: new URL("..", import.meta.url).pathname,
      // FREETTS_VERIFY_ASSETS=1 enables the same-origin model mirror
      // (app/api/verify-assets) — dev/test only, never production.
      env: { ...process.env, FREETTS_VERIFY_ASSETS: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("next dev did not become ready in 120s"));
    }, 120000);
    let out = "";
    const onData = (d) => {
      out += d.toString();
      if (/Ready in|started server/i.test(out)) {
        clearTimeout(timer);
        proc.stdout.off("data", onData);
        proc.stderr.off("data", onData);
        resolve(proc);
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

const checks = [];
function check(name, cond, detail = "") {
  checks.push({ name, pass: !!cond, detail: String(detail) });
}

let devProc = null;
try {
  console.log("[verify] starting next dev…");
  devProc = await startDevServer();
  console.log("[verify] dev server ready");

  // No proxy for the browser: the page, worker, model, voices and WASM
  // runtime are ALL served same-origin (dev server + /api/verify-assets
  // mirror). The sandbox proxy blocks Chromium's CONNECT tunnels, so routing
  // the browser through it would break the run; localhost bypasses it anyway.
  console.log("[verify] launching chromium (no proxy — all same-origin)…");
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage();
  page.on("console", (m) => {
    const t = m.text();
    if (/error|warn|fail/i.test(t)) console.log("[page]", m.type(), t.slice(0, 300));
  });
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 500)));

  const url = `http://localhost:${PORT}/verify?text=${encodeURIComponent(TEXT)}&voice=${VOICE}&assets=1`;
  console.log("[verify] loading", url.slice(0, 120) + "…");
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  console.log("[verify] waiting for synthesis (up to 20 min: model download + CPU inference)…");
  await page.waitForFunction(() => window.__ftts_verify !== undefined, null, {
    timeout: 20 * 60 * 1000,
    polling: 2000,
  });

  const r = await page.evaluate(() => window.__ftts_verify);
  await browser.close();

  console.log("[verify] result:", JSON.stringify({ ...r, wavBase64: `[${(r.wavBase64 || "").length} chars]` }, null, 1));

  // ---- Independent Node-side validation of the WAV bytes ----
  check("page reported ok", r.ok === true, r.error || "");
  if (!r.ok) throw new Error(`page failed: ${r.error}`);

  const wav = Buffer.from(r.wavBase64, "base64");
  writeFileSync("/tmp/freetts-verify.wav", wav);
  console.log(`[verify] WAV evidence saved: /tmp/freetts-verify.wav (${wav.length} bytes)`);

  const magic = wav.subarray(0, 4).toString();
  check("WAV magic is RIFF", magic === "RIFF", magic);
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

  // PCM stats, computed independently in Node (not trusting page JS).
  let peak = 0, nonSilent = 0;
  for (let i = 0; i < numSamples; i++) {
    const v = Math.abs(wav.readInt16LE(44 + i * 2) / 32768);
    if (v > peak) peak = v;
    if (v > 0.01) nonSilent++;
  }
  const nsf = nonSilent / numSamples;
  check("not silent (peak > 0.02)", peak > 0.02, peak.toFixed(4));
  check("non-silent fraction > 0.05", nsf > 0.05, nsf.toFixed(4));
  check("page stats agree with Node", Math.abs(r.peak - peak) < 0.02 && Math.abs(r.nonSilentFraction - nsf) < 0.02,
    `page peak=${r.peak} node peak=${peak.toFixed(4)}`);

  const report = {
    date: new Date().toISOString(),
    text: TEXT,
    voice: VOICE,
    device: r.device,
    sampleRate, numChannels, bits, numSamples,
    durationSec: +durationSec.toFixed(2),
    peak: +peak.toFixed(4),
    nonSilentFraction: +nsf.toFixed(4),
    chunkCount: r.chunkCount,
    loadMs: r.loadMs,
    synthMs: r.synthMs,
    realtimeFactor: r.synthMs ? +(r.synthMs / 1000 / durationSec).toFixed(3) : null,
    wavBytes: wav.length,
    checks,
    pass: checks.every((c) => c.pass),
  };
  writeFileSync("/tmp/freetts-verify.json", JSON.stringify(report, null, 2));

  console.log("\n[verify] CHECKS:");
  for (const c of checks) console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
  console.log(report.pass ? "\n[verify] GATE PASSED — real audio verified." : "\n[verify] GATE FAILED.");
  process.exitCode = report.pass ? 0 : 1;
} catch (e) {
  console.error("[verify] FATAL:", e);
  checks.push({ name: "no fatal error", pass: false, detail: String(e).slice(0, 200) });
  process.exitCode = 1;
} finally {
  // Kill the whole dev-server tree (npx wrapper + next-server child).
  try {
    const { execSync } = await import("node:child_process");
    execSync(`pkill -f "[n]ext dev --port ${PORT}"`);
  } catch { /* already dead */ }
  if (devProc) devProc.kill("SIGKILL");
}
