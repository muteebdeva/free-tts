#!/usr/bin/env node
// Minimal prod verification: assumes prod server already running on 3100
// with FREETTS_VERIFY_ASSETS=1. Streams progress live.
import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage();
page.on("console", (m) => {
  const t = m.text();
  if (/error|warn/i.test(t)) console.log("[console]", m.type(), t.slice(0, 300));
});
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 600)));

const url = "http://localhost:3100/verify?text=" + encodeURIComponent("Production build check. The quick brown fox jumps over the lazy dog.") + "&voice=bf_emma&assets=1";
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
console.log("[prod-verify] page loaded");

const t0 = Date.now();
let last = "";
while (Date.now() - t0 < 15 * 60 * 1000) {
  await new Promise((r) => setTimeout(r, 5000));
  const s = await page.evaluate(() => ({
    v: window.__ftts_verify ?? null,
    status: document.querySelector('[data-testid="verify-status"]')?.textContent ?? null,
  })).catch((e) => ({ err: String(e).slice(0, 120) }));
  if (s.err) { console.log("[prod-verify] evaluate failed:", s.err); break; }
  if (s.status !== last) { console.log("[prod-verify]", s.status, `(${Math.round((Date.now() - t0) / 1000)}s)`); last = s.status; }
  if (s.v) {
    const { wavBase64, ...rest } = s.v;
    console.log("[prod-verify] RESULT:", JSON.stringify(rest, null, 1));
    if (s.v.ok && s.v.wavBase64) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync("/tmp/freetts-verify-prod.wav", Buffer.from(s.v.wavBase64, "base64"));
      console.log("[prod-verify] WAV saved to /tmp/freetts-verify-prod.wav");
    }
    break;
  }
}
await browser.close();
console.log("[prod-verify] done");
