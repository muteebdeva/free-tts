#!/usr/bin/env node
// Debug probe: streams page console/pageerrors live, 120s budget.
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const PORT = 3101;
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || null;

const proc = spawn("npx", ["next", "dev", "--port", String(PORT)], {
  cwd: new URL("..", import.meta.url).pathname,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("dev not ready")), 90000);
  const on = (d) => {
    const s = d.toString();
    if (/Ready in/i.test(s)) { clearTimeout(t); resolve(); }
    if (/error/i.test(s)) console.log("[dev]", s.slice(0, 400));
  };
  proc.stdout.on("data", on);
  proc.stderr.on("data", on);
});
console.log("[probe] dev ready");

const browser = await chromium.launch({
  headless: true,
  proxy: PROXY ? { server: PROXY, bypass: "localhost,127.0.0.1" } : undefined,
});
const page = await browser.newPage();
page.on("console", (m) => console.log("[console]", m.type(), m.text().slice(0, 500)));
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 800)));
page.on("requestfailed", (r) => console.log("[reqfail]", r.url().slice(0, 120), r.failure()?.errorText));

await page.goto(`http://localhost:${PORT}/verify?text=${encodeURIComponent("Hello world.")}&voice=af_heart`, {
  waitUntil: "domcontentloaded", timeout: 60000,
});
console.log("[probe] page loaded, watching 120s…");
const t0 = Date.now();
let lastStatus = "";
while (Date.now() - t0 < 120000) {
  await new Promise((r) => setTimeout(r, 5000));
  const s = await page.evaluate(() => ({
    verify: window.__ftts_verify ?? null,
    status: document.querySelector('[data-testid="verify-status"]')?.textContent ?? null,
  }));
  if (s.status !== lastStatus) { console.log("[status]", s.status); lastStatus = s.status; }
  if (s.verify) {
    console.log("[verify]", JSON.stringify({ ...s.verify, wavBase64: undefined }).slice(0, 1000));
    break;
  }
}
await browser.close();
proc.kill();
console.log("[probe] done");
