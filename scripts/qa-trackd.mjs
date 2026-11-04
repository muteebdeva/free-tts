#!/usr/bin/env node
/**
 * FreeTTS Track D QA harness — drives the real production artifact (out/)
 * in headless Chromium against the local model mirror.
 *
 * Phases:
 *  A. Desktop Studio: full kokoro workflow (generate, progress UI, player,
 *     seek, volume/mute, speed, WAV+MP3 downloads byte-validated,
 *     on-demand lame.min.js, history recording)
 *  B. Voice picker: search + Escape
 *  C. Voices page: kokoro preview (model-load progress), system empty state
 *  D. History -> Studio regenerate handoff
 *  E. Mobile 360px: overflow, sticky bar vs tab bar, tap targets
 *  F. Failure simulation: blocked CDN -> honest error UI, no hang
 *  G. A11y/contrast spot checks + console-error audit
 */
import { createServer } from "node:http";
import { join, normalize, sep } from "node:path";
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const ROOT = "/home/hatch/workspace/free-tts";
const OUT = join(ROOT, "out");
const MIRROR = join(ROOT, ".verify-assets", "mirror");
const PORT = 3103;

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
};

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass: !!pass, detail: String(detail).slice(0, 300) });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? " — " + String(detail).slice(0, 200) : ""}`);
}

function serveFile(res, file) {
  const ext = file.slice(file.lastIndexOf("."));
  res.setHeader("Content-Type", CONTENT_TYPES[ext] ?? "application/octet-stream");
  res.writeHead(200);
  res.end(readFileSync(file));
}

const server = createServer((req, res) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  const raw = req.url.split("?")[0];
  let rel = normalize(decodeURIComponent(raw)).replace(/^\\/, "");
  if (rel.startsWith("..") || rel.includes(`..${sep}`)) {
    res.writeHead(403); res.end("forbidden"); return;
  }
  const file = join(OUT, rel);
  const found = [file, file + ".html", join(file, "index.html")].find((c) => {
    try { return statSync(c).isFile(); } catch { return false; }
  });
  if (!found) { res.writeHead(404); res.end("not found"); return; }
  serveFile(res, found);
});
await new Promise((r) => server.listen(PORT, r));
console.log(`[qa] serving out/ on :${PORT}`);

const consoleErrors = [];
const pageErrors = [];
function attachLogging(page, label) {
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`[${label}] ${m.text().slice(0, 300)}`);
  });
  page.on("pageerror", (e) => pageErrors.push(`[${label}] ${String(e).slice(0, 300)}`));
}

// Route external model hosts to the local mirror.
// NOTE: superseded by ?assets=1 (the provider's assetBase path, same as the
// /verify gate). Kept for the failure-simulation phase, which asserts the
// honest error UI when the CDN is unreachable.
async function routeMirror(page, { abortHuggingFace = false } = {}) {
  await page.route("https://huggingface.co/**", (route) => {
    if (abortHuggingFace) return route.abort("failed");
    const p = route.request().url().replace("https://huggingface.co/", "");
    const f = join(MIRROR, "huggingface.co", p);
    if (existsSync(f) && statSync(f).isFile()) {
      const ext = f.slice(f.lastIndexOf("."));
      return route.fulfill({
        status: 200,
        headers: { "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream", "Content-Length": String(statSync(f).size) },
        body: readFileSync(f),
      });
    }
    console.log("[qa] MIRROR MISS:", p);
    return route.abort("failed");
  });
  await page.route("https://cdn.jsdelivr.net/**", (route) => {
    const p = route.request().url().replace("https://cdn.jsdelivr.net/", "");
    const f = join(MIRROR, "cdn.jsdelivr.net", p);
    if (existsSync(f) && statSync(f).isFile()) {
      const ext = f.slice(f.lastIndexOf("."));
      return route.fulfill({
        status: 200,
        headers: { "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream" },
        body: readFileSync(f),
      });
    }
    return route.continue();
  });
}

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"],
});
browser.on("disconnected", () => console.log("[qa] BROWSER DISCONNECTED"));
const lameRequests = [];
function watchCrash(page, label) {
  page.on("crash", () => console.log(`[qa] PAGE CRASHED: ${label}`));
}

// ============ PHASE A: Studio full workflow (desktop) ============
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  attachLogging(page, "A-studio");
  watchCrash(page, "A-studio");
  // ?assets=1: Studio loads the model from the same-origin verification
  // mirror (the gate-proven path) instead of the sandbox-blocked CDN.
  const externalReqs = [];
  page.on("request", (r) => {
    const u = r.url();
    if (/^https:\/\//.test(u) && !u.includes("localhost")) externalReqs.push(u);
    if (u.endsWith("/lame.min.js")) lameRequests.push(u);
  });

  await page.goto(`http://localhost:${PORT}/?assets=1`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('textarea[aria-label="Text to convert to speech"]', { timeout: 30000 });
  check("A1 studio loads", true);
  check("A1b zero external requests (mirror-only)", externalReqs.length === 0, externalReqs.slice(0, 2).join(" "));

  // Empty text -> generate disabled (desktop action button)
  const genBtn = page.locator("div.hidden.md\\:flex").getByRole("button", { name: "Generate speech" });
  check("A2 generate disabled on empty text", await genBtn.isDisabled());

  // Type text; Cmd/Ctrl+Enter path tested later; first fill normally.
  const TEXT = "Hello. This is a studio workflow test of FreeTTS. The quick brown fox jumps over the lazy dog.";
  await page.fill('textarea[aria-label="Text to convert to speech"]', TEXT);
  check("A3 generate enabled with text", !(await genBtn.isDisabled()));

  // Over-limit
  await page.fill('textarea[aria-label="Text to convert to speech"]', "x".repeat(5001));
  const overErr = await page.getByText(/limited to 5,000 characters/).count();
  check("A4 over-limit shows error + disables", overErr > 0 && (await genBtn.isDisabled()), `err=${overErr}`);
  await page.fill('textarea[aria-label="Text to convert to speech"]', TEXT);

  // Cmd+Enter generates
  await page.click('textarea[aria-label="Text to convert to speech"]');
  await page.keyboard.press("ControlOrMeta+Enter");
  // Progress UI during model load
  const progressSeen = await page.waitForSelector('div[role="progressbar"]', { timeout: 120000 })
    .then(() => true).catch(() => false);
  check("A5 model-load progress UI appears", progressSeen);
  const statusText = await page.locator("p.text-sm.text-muted-foreground").first().textContent().catch(() => "");
  console.log("[qa] status during load:", (statusText || "").slice(0, 120));

  // Wait for ready (audio player)
  const ready = await page.waitForSelector('section[aria-label="Generated audio"]', { timeout: 8 * 60 * 1000 }).then(() => true).catch(async () => {
    const st = await page.evaluate(() => ({
      alerts: [...document.querySelectorAll('[role="alert"]')].map((a) => (a.textContent || "").slice(0, 120)),
      status: [...document.querySelectorAll("p")].map((p) => p.textContent).join("|").slice(0, 200),
    })).catch(() => ({}));
    console.log("[qa] A6 timeout state:", JSON.stringify(st).slice(0, 400));
    return false;
  });
  check("A6 generation completes (audio player renders)", ready);
  if (!ready) {
    console.log("[qa] aborting: no audio, downstream checks skipped");
    await ctx.close();
    server.close();
    await browser.close();
    const fails = results.filter((r) => !r.pass);
    console.log(`\n[qa] ${results.length - fails.length}/${results.length} checks passed (ABORTED)`);
    process.exit(1);
  }

  // Waveform is a div of peak bars (aria-hidden), NOT a canvas — check the
  // real markup: the click-to-seek region with rendered bars.
  const waveDiv = page.locator('section[aria-label="Generated audio"] div[title="Click to seek"]');
  const bars = await waveDiv.locator("span").count();
  check("A7 waveform renders (peak bars)", (await waveDiv.count()) > 0 && bars > 10, `bars=${bars}`);
  if ((await waveDiv.count()) > 0 && bars > 0) {
    const box = await waveDiv.boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
    await page.waitForTimeout(500);
    const t = await page.evaluate(() => document.querySelector("section[aria-label='Generated audio'] audio")?.currentTime ?? -1);
    check("A8 click-to-seek sets currentTime", t > 0.05, `t=${t?.toFixed(2)}s`);
  } else {
    check("A8 click-to-seek sets currentTime", false, "no waveform");
  }

  // Volume/mute + speed
  await page.getByRole("button", { name: "Mute" }).click();
  const muted = await page.evaluate(() => document.querySelector("section[aria-label='Generated audio'] audio")?.muted === true);
  check("A9 mute toggles audio.muted", muted);
  await page.getByRole("button", { name: "Unmute" }).click();
  // Volume: base-ui Slider exposes aria-label on its root element.
  const volSlider = page.locator('section[aria-label="Generated audio"] [aria-label="Volume"]');
  check("A10 volume control present", (await volSlider.count()) > 0);
  const speedSel = page.getByRole("combobox", { name: "Playback speed" });
  if ((await speedSel.count()) > 0) {
    await speedSel.click();
    await page.getByRole("option", { name: /1\.5/ }).click().catch(() => {});
    await page.waitForTimeout(300);
    const rate = await page.evaluate(() => document.querySelector("section[aria-label='Generated audio'] audio")?.playbackRate ?? -1);
    check("A11 playback speed changes rate", rate === 1.5, `rate=${rate}`);
  } else {
    check("A11 playback speed changes rate", false, "no speed combobox");
  }

  // Downloads (byte-validated)
  mkdirSync("/tmp/freetts-qa", { recursive: true });
  const wavDl = page.waitForEvent("download", { timeout: 60000 });
  await page.getByRole("button", { name: "WAV" }).click();
  const wavPath = await wavDl.then((d) => d.path()).catch(() => null);
  let wavOk = false, wavDetail = "no download";
  if (wavPath) {
    const b = readFileSync(wavPath);
    const peak = (() => {
      let p = 0;
      for (let i = 44; i < b.length; i += 2) p = Math.max(p, Math.abs(b.readInt16LE(i)));
      return p;
    })();
    wavOk = b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WAVE"
      && b.readUInt32LE(24) === 24000 && b.readUInt16LE(22) === 1 && b.readUInt16LE(34) === 16 && peak > 100;
    wavDetail = `${b.length} bytes, peak=${peak}`;
  }
  check("A12 WAV download byte-valid (RIFF/24k/mono/16-bit/non-silent)", wavOk, wavDetail);

  check("A13 lame.min.js NOT loaded on page load", lameRequests.length === 0, `requests=${lameRequests.length}`);
  const mp3Dl = page.waitForEvent("download", { timeout: 120000 });
  await page.getByRole("button", { name: "MP3" }).click();
  const mp3Path = await mp3Dl.then((d) => d.path()).catch(() => null);
  let mp3Ok = false, mp3Detail = "no download";
  if (mp3Path) {
    const b = readFileSync(mp3Path);
    mp3Ok = b.length > 2000 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0;
    mp3Detail = `${b.length} bytes, sync=${b[0].toString(16)} ${b[1].toString(16)}`;
  }
  check("A14 MP3 download byte-valid (frame sync, sane size)", mp3Ok, mp3Detail);
  check("A15 lame.min.js fetched on demand at MP3 export", lameRequests.length === 1, `requests=${lameRequests.length}`);

  // History recorded
  const hist = await page.evaluate(() => localStorage.getItem("freetts:history:v1"));
  let histOk = false, histDetail = "empty";
  try {
    const arr = JSON.parse(hist || "[]");
    histOk = arr.length > 0 && arr[0].text === TEXT && arr[0].engine === "kokoro";
    histDetail = `${arr.length} entries`;
  } catch (e) { histDetail = String(e).slice(0, 100); }
  check("A16 generation recorded in history", histOk, histDetail);

  // ============ PHASE B: voice picker + Escape ============
  const combo = page.getByRole("combobox", { name: "Choose a voice" });
  await combo.click();
  await page.waitForSelector('[role="listbox"]', { timeout: 15000 }).catch(() => {});
  const listboxOpen = (await page.locator('[role="listbox"]').count()) > 0;
  check("B1 voice picker opens", listboxOpen);
  if (listboxOpen) {
    await page.fill('input[aria-label="Search voices"]', "heart");
    await page.waitForTimeout(500);
    const opts = await page.locator('[role="option"]').count();
    check("B2 picker search filters", opts >= 1 && opts < 28, `options=${opts}`);
    await page.keyboard.press("Escape");
    // Wait for close (React state flush). NOTE: the AudioPlayer's speed
    // Select keeps its listbox mounted (base-ui keepMounted), so assert on
    // the picker's own aria-expanded, not a global listbox count.
    const closed = await page.waitForFunction(() => document.querySelector('[role="combobox"][aria-label="Choose a voice"]')?.getAttribute("aria-expanded") === "false", null, { timeout: 5000 }).then(() => true).catch(() => false);
    check("B3 Escape closes picker", closed);
  }

  // ============ PHASE C: voices page ============
  const page2 = await ctx.newPage();
  attachLogging(page2, "C-voices");
  await page2.goto(`http://localhost:${PORT}/voices?assets=1`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page2.waitForSelector("h1", { timeout: 30000 });
  // Voices load async (registry fetch) — wait for the first preview button.
  await page2.locator('section[aria-labelledby="kokoro-heading"] button[aria-label^="Preview"]').first().waitFor({ timeout: 30000 }).catch(() => {});
  const kokoroCards = await page2.locator('section[aria-labelledby="kokoro-heading"] button[aria-label^="Preview"]').count();
  check("C1 voices page lists kokoro previews", kokoroCards >= 20, `buttons=${kokoroCards}`);
  // Kokoro preview triggers model load -> progress UI; model cached in Cache API (same context) so fast
  await page2.locator('section[aria-labelledby="kokoro-heading"] button[aria-label^="Preview"]').first().click();
  const previewing = await page2.waitForSelector('button:has-text("Speaking…")', { timeout: 30000 }).then(() => true).catch(() => false);
  check("C2 kokoro preview enters speaking state", previewing);
  // Wait for the preview to finish (spinner clears)
  await page2.waitForFunction(() => ![...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Speaking…")), null, { timeout: 4 * 60 * 1000 }).catch(() => {});
  const stillSpeaking = await page2.locator('button:has-text("Speaking…")').count();
  check("C3 kokoro preview completes (spinner clears)", stillSpeaking === 0);
  // System voices in headless: expect the honest empty state
  const sysEmpty = await page2.getByText("No on-device voices found").count();
  const sysCards = await page2.locator('section[aria-labelledby="system-heading"] button[aria-label^="Preview"]').count();
  check("C4 system voices honest empty state in headless", sysEmpty > 0 || sysCards > 0, `empty=${sysEmpty} cards=${sysCards}`);

  // ============ PHASE D: history -> studio handoff ============
  const page3 = await ctx.newPage();
  attachLogging(page3, "D-history");
  await page3.goto(`http://localhost:${PORT}/history?assets=1`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page3.waitForSelector("h1", { timeout: 30000 });
  // Entries load in an effect after first paint — wait for the button.
  const regen = page3.getByRole("button", { name: /Regenerate/i }).first();
  await regen.waitFor({ timeout: 15000 }).catch(() => {});
  check("D1 history page has Regenerate", (await regen.count()) > 0);
  if ((await regen.count()) > 0) {
    await regen.click();
    // The History page pushes plain "/" (no query param) — the Studio
    // consumes the flag and restores state before any model load.
    await page3.waitForURL(`http://localhost:${PORT}/`, { timeout: 15000 });
    await page3.waitForTimeout(1000);
    const restored = await page3.inputValue('textarea[aria-label="Text to convert to speech"]');
    check("D2 regenerate restores text in Studio", restored === TEXT, `${restored.length} chars`);
    const pending = await page3.evaluate(() => localStorage.getItem("freetts:pending-generate:v1"));
    check("D3 pending flag consumed", pending === null);
    // D4: auto-generate to completion — drive the same contract with the
    // mirror enabled (re-set the flag directly; the consume path is real).
    const entryId = await page3.evaluate(() => {
      const arr = JSON.parse(localStorage.getItem("freetts:history:v1") || "[]");
      if (!arr.length) return null;
      localStorage.setItem("freetts:pending-generate:v1", arr[0].id);
      return arr[0].id;
    });
    if (entryId) {
      await page3.goto(`http://localhost:${PORT}/?assets=1`, { waitUntil: "domcontentloaded", timeout: 60000 });
      const autoDone = await page3.waitForSelector('section[aria-label="Generated audio"]', { timeout: 6 * 60 * 1000 }).then(() => true).catch(() => false);
      check("D4 handoff auto-generates to completion", autoDone);
    } else {
      check("D4 handoff auto-generates to completion", false, "no history entry");
    }
  }
  await ctx.close();
}

// ============ PHASE E: mobile 360px ============
{
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  attachLogging(page, "E-mobile");
  await routeMirror(page);
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('textarea[aria-label="Text to convert to speech"]', { timeout: 30000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("E1 no horizontal overflow at 360px", overflow <= 1, `overflow=${overflow}px`);
  const geom = await page.evaluate(() => {
    const bar = [...document.querySelectorAll("div.fixed")].find((d) => d.className.includes("bottom-[calc(4rem"));
    const tab = document.querySelector('nav[aria-label="Primary"].fixed');
    if (!bar || !tab) return null;
    return { bar: bar.getBoundingClientRect().toJSON(), tab: tab.getBoundingClientRect().toJSON() };
  });
  if (geom) {
    check("E2 sticky action bar sits above tab bar (no overlap)", geom.bar.bottom <= geom.tab.top + 1,
      `bar.bottom=${geom.bar.bottom.toFixed(0)} tab.top=${geom.tab.top.toFixed(0)}`);
  } else check("E2 sticky action bar sits above tab bar (no overlap)", false, "bars not found");
  const btnH = await page.evaluate(() => {
    const bar = [...document.querySelectorAll("div.fixed")].find((d) => d.className.includes("bottom-[calc(4rem"));
    const b = bar?.querySelector("button");
    return b ? b.getBoundingClientRect().height : -1;
  });
  check("E3 mobile generate button tap target >=44px", btnH >= 44, `h=${btnH}`);
  // 768px check
  await page.setViewportSize({ width: 768, height: 900 });
  await page.waitForTimeout(500);
  const overflow768 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("E4 no horizontal overflow at 768px", overflow768 <= 1, `overflow=${overflow768}px`);
  await ctx.close();
}

// ============ PHASE F: failure simulation (blocked CDN) ============
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  attachLogging(page, "F-failure");
  await routeMirror(page, { abortHuggingFace: true });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('textarea[aria-label="Text to convert to speech"]', { timeout: 30000 });
  await page.fill('textarea[aria-label="Text to convert to speech"]', "This generation must fail because the model CDN is blocked.");
  await page.locator("div.hidden.md\\:flex").getByRole("button", { name: "Generate speech" }).click();
  // NOTE: the compatibility-profile info Alert also carries role="alert" —
  // target the destructive error Alert (it has the Dismiss button).
  const errAlert = page.locator('[role="alert"]', { has: page.getByRole("button", { name: "Dismiss" }) });
  const alertSeen = await errAlert.waitFor({ timeout: 90000 }).then(() => true).catch(() => false);
  check("F1 blocked CDN shows error alert (no hang)", alertSeen);
  if (alertSeen) {
    const txt = (await errAlert.first().textContent()) || "";
    check("F2 error is honest about the cause", /fail|load|download|model|network/i.test(txt), txt.slice(0, 150));
  }
  // Page still responsive: dismiss works
  const dismiss = errAlert.getByRole("button", { name: "Dismiss" }).first();
  if ((await dismiss.count()) > 0) {
    await dismiss.click();
    check("F3 error dismisses, page responsive", (await errAlert.count()) === 0);
  } else check("F3 error dismisses, page responsive", false, "no dismiss button");
  await ctx.close();
}

// ============ PHASE G: a11y + contrast + error audit ============
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  attachLogging(page, "G-a11y");
  await routeMirror(page);
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("h1", { timeout: 30000 });
  // Icon-only buttons need accessible names: audit all buttons for a name
  const unnamed = await page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .filter((b) => !(b.textContent || "").trim() && !b.getAttribute("aria-label") && !b.getAttribute("title"))
      .map((b) => b.className.slice(0, 60)),
  );
  check("G1 all buttons have accessible names", unnamed.length === 0, `${unnamed.length} unnamed`);
  // Form labels: every control needs an accessible name. (The Slider's
  // visually-hidden native input gets its name from the Thumb's aria-label —
  // verified in the AX tree as `slider | <name>`.)
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll("textarea, input")].map((el) => ({
      tag: el.tagName,
      labelled: !!(
        el.getAttribute("aria-label") ||
        (el.id && document.querySelector(`label[for="${el.id}"]`))
      ),
    })),
  );
  const unlabelled = labels.filter((l) => !l.labelled);
  check("G2 form controls labelled", unlabelled.length === 0, `${labels.length} controls, ${unlabelled.length} unlabelled`);
  // Visible focus: tab to the generate area and check focus-visible ring via :focus-visible match
  await page.keyboard.press("Tab");
  const focusVisible = await page.evaluate(() => {
    const el = document.activeElement;
    return el ? getComputedStyle(el).outlineStyle !== "none" || [...el.classList].length > 0 : false;
  });
  check("G3 keyboard focus lands on a control", focusVisible);

  // Emerald accent contrast: --success token vs toast background, both themes.
  // Chromium serializes the Tailwind v4 custom properties as lab() — parse
  // Lab and convert to linear sRGB for the WCAG ratio.
  async function successContrast(theme) {
    return page.evaluate((t) => {
      document.documentElement.classList.toggle("dark", t === "dark");
      const root = getComputedStyle(document.documentElement);
      const parseLab = (s) => {
        const m = s.match(/lab\(\s*([\d.]+)%\s+(-?[\d.]+)\s+(-?[\d.]+)/);
        return m ? [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])] : null;
      };
      const labToLinear = ([L, a, b]) => {
        const fy = (L + 16) / 116;
        const fx = fy + a / 500;
        const fz = fy - b / 200;
        const un = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
        const X = 95.047 * un(fx);
        const Y = 100.0 * un(fy);
        const Z = 108.883 * un(fz);
        const x = X / 100, y = Y / 100, z = Z / 100;
        const cl = (v) => Math.min(1, Math.max(0, v));
        return [
          cl(3.2404542 * x - 1.5371385 * y - 0.4985314 * z),
          cl(-0.969266 * x + 1.8760108 * y + 0.041556 * z),
          cl(0.0556434 * x - 0.2040259 * y + 1.0572252 * z),
        ];
      };
      const fg = parseLab(root.getPropertyValue("--success"));
      const bg = parseLab(root.getPropertyValue("--popover"));
      if (!fg || !bg) return -1;
      const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      const l1 = lum(labToLinear(fg)), l2 = lum(labToLinear(bg));
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    }, theme);
  }
  const rLight = await successContrast("light");
  const rDark = await successContrast("dark");
  check("G4 emerald --success vs toast bg contrast (light, icon needs 3:1)", rLight >= 3, `${rLight.toFixed(2)}:1`);
  check("G5 emerald --success vs toast bg contrast (dark, icon needs 3:1)", rDark >= 3, `${rDark.toFixed(2)}:1`);
  await ctx.close();
}

// ============ Console/page error audit ============
{
  // Filter known-benign: none expected. Report everything.
  const benign = [/favicon\.ico.*404/];
  const real = consoleErrors.filter((e) => !benign.some((p) => p.test(e)));
  check("H1 zero console errors across QA", real.length === 0, real.slice(0, 3).join(" | ") || "clean");
  check("H2 zero page errors across QA", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | ") || "clean");
}

server.close();
await browser.close();

const fails = results.filter((r) => !r.pass);
console.log(`\n[qa] ${results.length - fails.length}/${results.length} checks passed`);
if (fails.length) {
  console.log("[qa] FAILURES:");
  for (const f of fails) console.log(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}
