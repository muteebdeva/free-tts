#!/usr/bin/env node
// Probe: can headless Chromium fetch huggingface.co through the proxy?
import { chromium } from "playwright";

const PROXY_URL = process.env.HTTPS_PROXY || process.env.https_proxy;
const u = new URL(PROXY_URL);
const explicit = {
  server: `${u.protocol}//${u.host}`,
  username: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  bypass: "localhost,127.0.0.1",
};

for (const [name, proxy] of [
  ["url-embedded-creds", { server: PROXY_URL, bypass: "localhost,127.0.0.1" }],
  ["explicit-user-pass", explicit],
]) {
  const browser = await chromium.launch({ headless: true, proxy });
  const page = await browser.newPage();
  const result = await page.evaluate(async () => {
    try {
      const r = await fetch("https://huggingface.co/api/models/onnx-community/Kokoro-82M-v1.0-ONNX", { method: "HEAD" });
      return { ok: r.ok, status: r.status };
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 200) };
    }
  });
  console.log(name, JSON.stringify(result));
  await browser.close();
}
