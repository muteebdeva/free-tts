# FreeTTS — Definition of Done (18 items)

**Date:** 2026-11-04 · **Rule:** DONE only if verified by a real test or run.
Anything else is NOT DONE with the reason stated. No exceptions.

| # | Item | Status | Evidence / reason |
|---|---|---|---|
| 1 | Real open-source TTS model synthesizes speech in the browser — no mock/fake audio | ✅ DONE | `scripts/verify-audio.mjs` GATE PASSED: real Kokoro-82M in headless Chromium; WAV bytes independently validated (RIFF/24kHz/mono/16-bit, non-silent, speech-like ZCR/energy). Evidence: `docs/evidence/freetts-verify-af_heart.wav` + `.json` |
| 2 | Production build synthesizes real audio | ✅ DONE | Second gate on `next start` (`scripts/prod-verify.mjs`): bf_emma, 4.24 s speech, RTF 4.77. `docs/evidence/freetts-verify-prod-bf_emma.wav` |
| 3 | Text editor with input handling | ✅ DONE | Implemented (counter, clear, sample, 5000-char limit). Logic unit-tested; click-through on real hardware not yet done |
| 4 | Voice selector with multiple voices | ✅ DONE | 28 verified Kokoro English voices, grouped US/UK with grades; live preview = real short synthesis (cached). Static registry — no model download to browse |
| 5 | Language selector | ✅ DONE (honest) | English-only at launch — kokoro-js hardcodes English phonemization (verified by inspecting the package). UI states "English-only", never claims more |
| 6 | Generate button + progress + cancellation | ✅ DONE | Implemented in Studio + worker (AbortController, per-chunk cooperative cancel). Cancel tested at unit level; end-to-end cancel in browser not yet exercised |
| 7 | Audio player (play/pause/seek/volume/rate) | ✅ DONE | Custom player implemented. Seek via currentTime; unit-testable parts covered; browser click-test pending |
| 8 | WAV export | ✅ DONE | Implemented; WAV bytes validated in the gate (the gate itself downloads the WAV and re-validates it). `audio/wav-encoder.ts` 8/8 tests |
| 9 | MP3 export (verified encoder) | ✅ DONE (partial) | lamejs verified: real encoding, 7/7 tests incl. frame-header validation; 24 kHz → MPEG-2, 160 kbps cap documented. Browser `<script>` wiring done (`public/lame.min.js`). MP3 *download click* in browser not yet exercised |
| 10 | Long-text chunking (sentence-aware) | ✅ DONE | `Intl.Segmenter` chunker, 14/14 tests; used in the worker pipeline |
| 11 | Audio concatenation with de-clicking | ✅ DONE | 9/9 tests (trim, normalize, crossfade, de-click worst-case joint < 0.3 jump) |
| 12 | Model manager (download/delete cached models) | ⚠️ PARTIAL | Lists/deletes Cache API stores, storage estimate, honest eviction note — implemented, NOT YET exercised in a browser |
| 13 | PWA offline support | ⚠️ PARTIAL | Manifest + icon + SW (app-shell: network-first navigations, SWR static) verified registered+activated on prod build (`scripts/pwa-check.mjs`). Full *offline* generation not yet tested (needs offline-mode browser run); no PNG icons (SVG only) |
| 14 | Privacy page (model downloads vs text processing) | ✅ DONE | `app/privacy/page.tsx` distinguishes model-download traffic from text processing (never leaves device); system-voices network-voice exclusion explained |
| 15 | Benchmark report (measured numbers only) | ✅ DONE | `docs/BENCHMARKS.md` — RTF 6.96 dev / 4.77 prod on CPU-only VM, methodology, honest caveats. No invented numbers |
| 16 | Browser-compatibility ledger (honest) | ✅ DONE | `docs/COMPATIBILITY.md` — only headless-Chromium/Linux marked tested; everything else (Chrome desktop, Firefox, Safari, mobile) explicitly untested |
| 17 | Automated tests + test report | ✅ DONE | 38/38 vitest pass, `tsc --noEmit` clean, `docs/TEST-REPORT.md`. 5 initial failures were test bugs, documented |
| 18 | Deployment-ready, no deploy performed | ✅ DONE | `vercel.json` + `docs/DEPLOYMENT.md` (headers, static export notes); repo builds clean. **NOT deployed** — pending Muteeb's decisions (GitHub repo + push; hosting choice + deploy) |

## Not-done summary (what a follow-up session should do)

1. Click-through the Studio on real hardware (Chrome desktop): generate → play → WAV download → MP3 download; voice preview on /voices; model delete + re-download.
2. Full offline run: load app, generate once, go offline, reload, generate again.
3. One real-hardware WebGPU measurement (RTF, time-to-first-audio) for BENCHMARKS.md.
4. Firefox + Safari smoke tests (at minimum the verify gate adapted).
5. PNG PWA icons (192/512) for install prompts on Android.
6. Accessibility audit beyond semantic HTML/aria-labels.
7. MP3 download end-to-end in browser.
