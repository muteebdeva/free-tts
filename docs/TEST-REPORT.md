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

## 4. Production build

`npm run build` — result recorded in `docs/COMPATIBILITY.md`.

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
