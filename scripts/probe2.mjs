import { chromium } from "playwright";
const PROXY_URL = process.env.HTTPS_PROXY || process.env.https_proxy;
const u = new URL(PROXY_URL);
const proxy = { server: `${u.protocol}//${u.host}`, username: decodeURIComponent(u.username), password: decodeURIComponent(u.password), bypass: "localhost,127.0.0.1" };
for (const [name, extra] of [["default", {}], ["ignore-cert", { ignoreHTTPSErrors: true }]]) {
  const browser = await chromium.launch({ headless: true, proxy });
  const ctx = await browser.newContext(extra);
  const page = await ctx.newPage();
  for (const url of ["https://example.com", "http://example.com", "https://registry.npmjs.org"]) {
    const r = await page.evaluate(async (url) => {
      try { const res = await fetch(url, { method: "HEAD" }); return res.status; }
      catch (e) { return "ERR:" + String(e).slice(0, 80); }
    }, url);
    console.log(name, url, r);
  }
  await browser.close();
}
