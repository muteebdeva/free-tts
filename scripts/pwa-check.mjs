#!/usr/bin/env node
// Checks PWA wiring on the prod build: SW registration, manifest, icon.
import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto("http://localhost:3101/", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, 6000)); // allow SW registration

const out = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  const manifestLink = !!document.querySelector('link[rel="manifest"]');
  return {
    swRegistered: !!reg,
    swScope: reg?.scope ?? null,
    swState: reg?.active?.state ?? null,
    manifestLink,
    themeColor: document.querySelector('meta[name="theme-color"]')?.content ?? null,
  };
});
console.log(JSON.stringify(out, null, 2));

for (const u of ["/manifest.webmanifest", "/sw.js", "/icons/icon.svg"]) {
  const r = await page.request.get("http://localhost:3101" + u);
  console.log(u, "->", r.status(), r.headers()["content-type"]);
}
await browser.close();
