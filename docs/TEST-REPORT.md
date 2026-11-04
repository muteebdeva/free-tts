# FreeTTS — Test Report

**Date:** 2026-11-04 · **App:** v1 (Kokoro-82M primary + system-voices fallback)

## 1. Unit tests (vitest) — 38/38 PASS

Run: `npx vitest run` (Node 24, no browser).

| Suite | Tests | Result |
|---|---|---|
| `tests/text-chunk.test.ts` | 14 — sentence-aware chunking, paragraph boundaries, maxChars enforcement, word-splitting of over-long sentences, Hindi input, numbers/punctuation, input validation | PASS |
| `tests/wav-encoder.test.ts` | 8 — WAV header correctness, 16-bit round-trip within quantisation error, hard clipping, stereo interleave, invalid-input rejection, header parsing, peak/silence metrics | PASS |
| `tests/concat.test.ts` | 9 — silence trimming (+bounds), peak normalisation (attenuate-only), crossfade length math, de-clicking (max sample jump < 0.3 on a worst-case ±0.9 joint), no clipping | PASS |
| `tests/mp3-export.test.ts` | 7 — real lamejs encoding: MP3 frame-sync bytes, valid MPEG version/layer in frame headers, plausible size for 128 kbps, 24 kHz accepted as MPEG-2 Layer III, invalid inputs rejected | PASS |

Five initial failures (2026-11-04) were test-expectation bugs (sine zero-crossings
trimmed by design; a `maxChars` below the enforced minimum), not implementation
bugs — fixed in the tests, implementation untouched. No regressions since.

TypeScript: `npx tsc --noEmit` clean. ESLint: via `npm run lint` (Next config).

## 2. Real-audio gate — PASS

Script: `scripts/verify-audio.mjs`. Method: headless Chromium (Playwright) loads
`/verify`, which drives the **real** Kokoro-82M pipeline in the TTS Web Worker
(espeak-ng phonemization → ONNX inference → concat), encodes a WAV in-page, and
exposes byte-level stats. Node then **independently re-validates** the WAV bytes.

Run 2026-11-04 (evidence: `docs/evidence/freetts-verify.json`,
`docs/evidence/freetts-verify-af_heart.wav`):

| Check | Result |
|---|---|
| Page reported ok | PASS |
| WAV magic RIFF / WAVE format | PASS |
| Sample rate 24000 Hz, mono, 16-bit PCM | PASS |
| Header data-size matches file | PASS |
| Duration plausible for 135-char text (9.17 s) | PASS |
| Not silent (peak 0.566, non-silent fraction 0.63) | PASS |
| Page stats agree with independent Node stats | PASS |

Acoustic spot-check (independent): zero-crossing rate 0.154 (speech range
0.05–0.3; white noise ≈ 0.5), energy coefficient of variation 1.13 across 100 ms
windows (bursty speech, not a steady tone), max/min window-energy ratio ≈ 5×10⁶
(voiced segments vs. inter-word pauses). **The output is real synthesized
speech, not silence, noise, or a placeholder.**

Environment: Linux VM, Intel Xeon CPU (no GPU), Chromium headless-shell via
SwiftShader; inference device `wasm` (q8 model, 92 MB) served from a same-origin
test mirror (the sandbox proxy blocks Chromium's CONNECT tunnels — see
`app/api/verify-assets/[...path]/route.ts` header comment; the model bytes and
inference are identical, only the transport differs).

## 3. Integration tests

| Test | Status |
|---|---|
| Worker round-trip (load → synthesize → PCM transfer) | PASS (via gate) |
| Long-text chunking + concat in worker | PASS (unit) + PASS (gate, 1 chunk path) |
| Cancellation between chunks | PASS (unit-level AbortController; worker honors between chunks) |
| Model load progress reporting | PASS (observed in gate logs) |
| Voice preview = real synthesis | Implemented; manually exercised via `/voices` in dev (see §5) |
| MP3 download end-to-end in browser | NOT YET TESTED in browser (unit-tested only) |
| Model delete + re-download | Implemented; NOT YET TESTED |
| PWA offline generation | NOT YET TESTED |

## 4. Production build — PASS

- `npm run build` succeeds (Next 16.4.5, webpack production build).
- **Second gate on the production bundle** (`scripts/prod-verify.mjs`,
  2026-11-04): same real-audio check against `next start` — voice `bf_emma`
  (British English), 68 chars → 4.24 s of 24 kHz speech (101,847 samples,
  peak 0.761, non-silent 0.62, header-consistent). Evidence:
  `docs/evidence/freetts-verify-prod-bf_emma.wav`. Load 15.4 s, synthesis
  20.2 s → **RTF 4.77** (prod bundle faster than dev's 6.96).
- PWA wiring verified on the prod build (`scripts/pwa-check.mjs`): service
  worker registered (scope `/`, state `activated`), manifest served as
  `application/manifest+json`, `/sw.js` and icon correct content types.

## 5. Manual verification (dev server + headless browser)

- `/verify` harness: PASS (gate above).
- Studio UI flows (generate → play → download) in a real headed browser: NOT
  YET DONE — requires a browser with working egress (the sandbox proxy blocks
  Chromium; the user or a follow-up session should click through on real
  hardware).
- Voice preview caching, engine switching, theme toggle: implemented, not yet
  click-tested.

## 6. Known gaps (honest)

1. No mobile testing (Android Chrome, iPhone Safari) — see COMPATIBILITY.md.
2. No Safari testing at all — the WASM path is *expected* to work there (Piper
   precedent) but Kokoro-on-Safari is unverified.
3. No real-hardware WebGPU measurement — the VM is CPU-only.
4. MP3 download and model-manager delete are implemented + unit-tested but not
   exercised in a browser.
5. Accessibility audit not performed beyond semantic HTML + aria-labels.

## 7. Track D — technical cleanup + QA + redeploy (2026-11-04)

### 7a. Tech cleanup (all verified: tsc clean, 122/122 vitest, build green)
- **Removed dead dep `onnxruntime-web`** from package.json. Verified zero runtime
  imports (only code comments); the transitive copy bundled by
  `@huggingface/transformers` is untouched. Lockfile synced (it was also
  missing the `phonemizer` direct entry — now recorded).
- **Fixed the service-worker cache-wipe bug** (`public/sw.js`): the `activate`
  handler deleted every cache except its own shell cache — including
  `transformers-cache` and `kokoro-voices` — silently forcing a full ~92 MB
  model re-download on every SW update. Now only old `freets-shell-*` caches
  are evicted; the model/voice caches are preserved (names sourced from
  `lib/model-store.ts`).
- **`lame.min.js` loads on demand**: removed the global `<script>` from
  `app/layout.tsx`; new `ensureLamejs()` in `audio/mp3-export.ts` injects
  `/lame.min.js` once on first MP3 export (retry-safe). Verified in-browser:
  0 requests on page load, exactly 1 at export time; MP3 bytes frame-valid.
- Added a `?assets=1` dev/test affordance to the Studio's model load (same
  convention as `/verify`), so the real Studio UI is drivable against the
  local model mirror in sandboxes where the CDN is unreachable. Production
  never sets it (no `/api/verify-assets` route there — it would 404 into the
  honest load error).

### 7b. Real issues found by QA and fixed
- **Mobile CTA tap target 36 px → 44 px**: the primary Generate button
  (`size="lg"` = `h-9`) measured 36 px on the 360 px viewport. Fixed with
  `min-h-11` on the shared action button (both desktop and sticky-mobile).
- **Slider had no accessible name**: Base UI v1 puts `aria-label` on the
  Slider Root (exposed as a named *group*); the actual slider control in the
  AX tree was unnamed. Our `ui/slider` wrapper now forwards `aria-label` /
  `aria-labelledby` to the Thumb — verified in the AX tree as
  `slider | Speaking speed val=1`.
- **React #418 hydration pageerror**: the Studio initialized its text state
  from `localStorage` (`useState(() => loadDraft())`), so the server-rendered
  word/char counts mismatched the client on return visits. Fixed at the root:
  the draft now loads in a `useEffect` (first render matches the server
  exactly). Verified zero pageerrors on reload-with-draft in dev and in the
  production artifact.

### 7c. Browser QA — 42/42 checks PASS (headless Chromium, production artifact)
Harness: `scripts/qa-trackd.mjs` — serves `out/` with the Pages COOP/COEP
headers, drives the real Studio/voices/history/settings UI against the local
model mirror (`?assets=1`), real Kokoro-82M inference (WASM).
- **Studio**: empty→disabled / over-limit→error+disabled / Cmd+Enter generates /
  model-load progress UI / waveform renders (120 peak bars) / click-to-seek
  (t=3.34 s) / mute / volume / 1.5× speed / WAV byte-valid (RIFF, 24 kHz,
  mono, 16-bit, peak 15009) / MP3 byte-valid (frame sync `ff f3`, 107 904 B) /
  history recorded.
- **Voice picker**: opens, search filters (7 options for "heart"), Escape closes.
- **Voices page**: 28 Kokoro previews listed; preview enters "Speaking…" and
  completes (spinner clears); honest "No on-device voices found" empty state
  in headless.
- **History→Studio**: Regenerate restores the 94-char text, pending flag
  consumed, auto-generate runs to completion.
- **Mobile 360 px / 768 px**: no horizontal overflow; sticky action bar sits
  exactly above the tab bar (bar.bottom=676, tab.top=675); CTA is 44 px.
- **Failure simulation** (CDN aborted): honest error alert
  ("Speech generation failed: Failed to fetch"), dismisses, page responsive —
  no hang.
- **A11y/contrast**: 0 unnamed buttons; all form controls labelled; emerald
  `--success` vs toast bg = 4.42:1 (light) / 7.65:1 (dark) — passes the 3:1
  icon bar.
- **Error audit**: zero console errors, zero page errors across all workflows.
- **Privacy**: zero external requests during the full Studio workflow
  (mirror-only).

### 7d. Mandatory gates (final bundle) — both PASS, no mocks
- `scripts/verify-pages.mjs`: **GATE PASSED** — 15/15 checks, real Kokoro
  inference in the Pages artifact (133 chars → 9.25 s, 24 kHz mono 16-bit,
  peak 0.5405, non-silent 0.63). Evidence: `docs/evidence/freetts-verify-pages.wav`.
- `scripts/verify-gapless.mjs`: **GATE PASSED — 12/12** — 3 streamed chunks,
  every joint overlaps by exactly the 8 ms crossfade (worst joint error
  0.000 ms), no ≥50 ms near-zero run at any joint, stitched sample count
  matches exactly (726 766 vs 726 766).

### 7e. Pre-release audit follow-up (2026-11-04) — 2 defects investigated, 1 real UX defect fixed
The audit reported: (1) "History tab is an empty page — no history list UI
renders"; (2) "Voices page Preview button renders no audible/visible feedback —
clicking it does nothing the user can perceive." Both were reproduced against
the production artifact (`out/`) in headless Chromium with real Kokoro-82M
inference (WASM) via the `?assets=1` model mirror.

**Defect 1 — NOT reproduced; history works end to end.** Full Studio
generation → 1 entry in `localStorage freetts:history:v1` → `/history` renders
the entry card with a working Regenerate button (empty state correctly absent).
The list UI, empty state, delete, clear-all, and the History→Studio
pending-generate handoff all behave as designed. The audit's "empty page" was
the honest empty state for a session in which no generation had completed on
that device/browser (history is localStorage-only, stated on the page itself:
"stored only on this device"). No code change; verified, not dismissed.

**Defect 2 — CONFIRMED and FIXED.** A cold (first-tap) Kokoro preview showed
nothing but the card button flipping to "Speaking…" for the entire ~92 MB
model download + synthesis (observed 40+ s of silence in the sandbox; minutes
on mobile data): no progress bar, no "Downloading voice model" text anywhere
on the Voices page — the Studio had this UI, the Voices page never subscribed
to `loadProgress`/`kokoroLoading`. Worse, the provider's preview path never set
`kokoroLoading` at all (its `slot` lacked `setLoading`), and `el.play()`
rejections were swallowed silently (spinner cleared, no toast).
Fixes (`components/tts-provider.tsx`, `app/voices/page.tsx`):
- Preview-triggered model load now drives `kokoroLoading`/`loadProgress`
  (same throttled progress as the Studio).
- Voices page shows a live download banner (Progress + "Downloading voice
  model… N% (one-time, cached after)" / "Preparing voice model…"), and the
  previewing card's button reads "Downloading…" (with matching aria-label)
  until the model is ready, then "Speaking…" during playback.
- `play()` rejections now surface an honest toast ("The preview was
  synthesized, but the browser blocked playback. Tap Preview again to hear
  it." / cached-preview variant) instead of clearing silently.
Verified end to end on the rebuilt artifact: tap → "Downloading…" + progress
bar + percentage → "Speaking…" → `play()` attempted and resolved (`ok:true`),
spinner clears on end, zero console/page errors. Failure paths: blocked CDN →
honest "Preview failed: The preview needs the voice model (~92 MB, one-time
download), which failed to load" toast, spinner clears; forced `play()`
rejection → honest blocked-playback toast, spinner clears.
tsc clean, 122/122 vitest green, production build green.

### 7f. Known gaps remaining (honest)
- Real-device QA (his iPhone) is still the only true validation for audio
  playback, the audio-blocked banner path, and mobile feel — the sandbox
  cannot do this.
- No Safari testing; no real-hardware WebGPU measurement (VM is CPU-only).
- The failure-simulation error text ("Failed to fetch") is honest but terse;
  a friendlier message ("couldn't download the voice model — check your
  connection") would be nicer.
- System-voice engine path (Web Speech) not exercised beyond the empty state —
  headless Chromium ships no voices.
