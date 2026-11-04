#!/usr/bin/env node
/**
 * Reproduce the production failure: serve out/ statically (Pages-equivalent
 * headers) and run the REAL production asset path (no mirror) in headless
 * Chromium WITHOUT SwiftShader flags — matching the live-browser test env.
 */
import { readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { join, normalize, sep } from "node:path";
import { chromium } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "out");
const PORT = 3102;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json",
  ".wasm": "application/wasm", ".onnx": "application/octet-stream",
  ".bin": "application/octet-stream", ".svg": "image/svg+xml",
  ".png": "image/png", ".webmanifest": "application/manifest+json",
  ".txt": "text/plain", ".ico": "image/x-icon",
};

const server = createServer((req, res) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  let rel = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^\//, "");
  if (rel.startsWith("..") || rel.includes(`..${sep}`)) { res.writeHead(403); res.end(); return; }
  const file = join(OUT, rel);
  const found = [file, file + ".html", join(file, "index.html")].find((c) => {
    try { return statSync(c).isFile(); } catch { return false; }
  });
  if (!found) { res.writeHead(404); res.end("nf"); return; }
  res.setHeader("Content-Type", CONTENT_TYPES[found.slice(found.lastIndexOf("."))] ?? "application/octet-stream");
  res.writeHead(200); res.end(readFileSync(found));
});

await new Promise((r) => server.listen(PORT, r));
console.log("[repro] serving out/ on", PORT);

const browser = await chromium.launch({ headless: true }); // NO swiftshader flags
const page = await browser.newPage();
page.on("console", (m) => {
  const t = m.text();
  if (/error|warn|fail|gpu|webgpu|wasm|backend/i.test(t)) console.log("[page]", m.type(), t.slice(0, 400));
});
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 500)));

await page.goto(`http://localhost:${PORT}/verify?text=${encodeURIComponent("Hello world, mirror assets, no swiftshader flags.")}&voice=af_heart&assets=1`, { waitUntil: "domcontentloaded", timeout: 60000 });

// Probe environment facts first.
const probe = await page.evaluate(async () => {
  const out = {
    hasGpu: "gpu" in navigator,
    crossOriginIsolated,
    hardwareConcurrency: navigator.hardwareConcurrency,
  };
  if ("gpu" in navigator) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      out.adapter = adapter ? adapter.info.device || "got-adapter" : null;
    } catch (e) { out.adapterError = String(e).slice(0, 200); }
  }
  return out;
});
console.log("[repro] env probe:", JSON.stringify(probe));

console.log("[repro] waiting up to 12 min for synthesis…");
try {
  await page.waitForFunction(() => window.__ftts_verify !== undefined, null, { timeout: 12 * 60 * 1000, polling: 3000 });
  const r = await page.evaluate(() => window.__ftts_verify);
  console.log("[repro] RESULT:", JSON.stringify({ ...r, wavBase64: `[${(r.wavBase64 || "").length} chars]` }));
} catch (e) {
  console.log("[repro] TIMEOUT/FAIL — no result. Last state:",
    await page.evaluate(() => JSON.stringify(window.__ftts_verify || null)).catch(() => "?"));
}
await browser.close();
server.close();
