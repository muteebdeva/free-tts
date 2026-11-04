# FreeTTS — Performance Baseline

**Date:** 2026-11-04 · **Method:** repo's own tooling — `npx vitest run`,
`node scripts/verify-pages.mjs`, and the committed evidence in
`docs/evidence/`. Every number is labeled **MEASURED** or **ESTIMATED**.
Do not cite these as representative of user hardware — see environment note.

## Environment (this machine)

- Linux VM, Intel Xeon CPU (shared), **no GPU** — Chromium headless-shell 156
  (Playwright), SwiftShader software GL
- Inference device selected by the app: **`wasm`** (no WebGPU adapter)
- Model: Kokoro-82M **q8** (`model_quantized.onnx`, 92,361,116 bytes) + voice
  `af_heart` (522,240 bytes), served from a same-origin localhost mirror
  (production would use the HuggingFace CDN — slower)
- Build under test: Cloudflare Pages static export (`out/`, Turbopack)

## Measured results

### Unit tests — MEASURED

`npx vitest run` (this audit): **38/38 pass**, 4 files, 3.48 s total.
Covers text chunking (14), WAV encode/decode (8), concat de-clicking (9),
MP3 encode via lamejs (7).

### Real-audio gate — MEASURED

| Run | Text | Load | Synth | Audio out | RTF |
|---|---|---|---|---|---|
| `verify-pages.mjs` **this audit** (Pages export) | 133 chars | **12,907 ms** | **40,559 ms** | 9.25 s | **4.39** |
| `verify-pages.mjs` evidence 07:01 UTC (`docs/evidence/freetts-verify-pages.json`) | 143 chars | 17,422 ms | 81,898 ms | 9.25 s | 8.86 |
| `verify-audio.mjs` evidence 06:04 UTC (`docs/evidence/freetts-verify.json`, dev build) | 135 chars | 12,309 ms | 63,842 ms | 9.17 s | 6.96 |

(RTF = synth wall time ÷ audio duration; > 1 = slower than real time. Variance
across runs reflects shared-CPU contention on this VM and different builds.
All three runs: `device: "wasm"`, GATE PASSED, 24 kHz mono WAV validated
byte-for-byte in Node.)

### Time-to-first-audio — MEASURED (by construction)

Not timed separately because the architecture makes it equal to **full
generation time**: the worker synthesizes all chunks, concatenates, and
transfers before the main thread encodes WAV and creates the playable URL
(`workers/tts.worker.ts:103–132`, `components/tts-provider.tsx:198–211`).
For the gate text: **~41–82 s** on this VM. For `MAX_CHARS = 5000`
(`components/tts-provider.tsx:29`): extrapolating linearly from the gate run,
~348 s of audio at RTF 4.4 ≈ **~25 minutes** — ESTIMATED, and only if the tab
survives that long.

### Model load time — MEASURED

12–17 s cold from a localhost mirror (worker bootstrap + 21.6 MB ORT WASM +
92 MB q8 model + tokenizer/config; voice `.bin` fetched on first synthesis).
Production CDN + mobile network will be slower — ESTIMATED 1–5 min on a
typical phone connection for the 92 MB first download (no measurement
available here).

### Bundle / asset sizes — MEASURED (from `out/` static export)

| Asset | Size | When fetched |
|---|---|---|
| First-visit JS (11 chunks, `out/index.html`) | **861 KB** uncompressed | page load |
| `public/lame.min.js` (MP3 encoder, `<script defer>` on every page) | **156 KB** | page load (needed only for MP3 export) |
| Worker chunk (`0wwuopzu8436d.js` — kokoro.web.js: transformers.js + ORT + eSpeak-NG) | **2.2 MB** (916 KB gzip) | first Generate / voice preview |
| `ort-wasm-simd-threaded.jsep.*.wasm` | **21.6 MB** | first Generate (ORT init) |
| `ort.bundle.min.*.mjs` (ORT WASM JS glue) | **398 KB** | first Generate |
| Worker bootstrap (`tts.worker.*.ts`) | ~6 KB | first Generate |
| Kokoro q8 model | 92.4 MB | first Generate (cached after) |
| Voice `.bin` | ~0.5 MB each | per voice (cached after) |
| Total `out/` on disk | 25 MB | — |

First-Generate download total before any audio: **~117 MB** (worker JS +
ORT WASM + model + voice), plus per-file progress UI that resets per file
(see ARCHITECTURE-AUDIT.md §5.4).

### WAV encode — MEASURED

< 100 ms for 220,131 samples (per `docs/BENCHMARKS.md`; consistent with the
`encodeWav` loop cost). Negligible vs inference.

### MP3 encode — unit-tested only

`tests/mp3-export.test.ts` encodes a 2 s sine in ~300–600 ms in Node.
In-browser timing on real text not measured.

## Estimated (not measured here)

| Quantity | Value | Basis |
|---|---|---|
| Kokoro q8 RTF on iPhone Safari (single-threaded WASM) | **2–4+** | Research report §Q2, anchored on Sandbook's 20–40 s per 40-word paragraph on a *fast laptop* (sources cited there); no published iPhone-browser Kokoro benchmark exists |
| Peak JS + WASM heap during max-length synthesis | **several hundred MB** | 92 MB weights + ORT overhead + 2–3× PCM transient (see ARCHITECTURE-AUDIT.md §8); `performance.measureUserAgentSpecificMemory` unavailable headless |
| WebGPU (desktop) RTF | 4.3× real-time, 1.2 s first-audio | Third-party (Verso, Sept 2026), cited in `docs/BENCHMARKS.md` — **not reproduced here** |
| iOS 26 WebGPU/JSEP behavior of this build | unknown | No iOS hardware; the code path exists (`resolveDevice` returns `webgpu` when an adapter is present) and the bundled ORT is 1.22.0 (JSEP) |

## Cannot be measured in this environment

- iPhone / iPad Safari and Android Chrome: no devices available (matches
  `docs/COMPATIBILITY.md` ledger — all mobile rows are UNTESTED).
- Real GPU / WebGPU inference path.
- Peak memory (no reliable headless API).
- Mobile-network model download time; CDN (non-mirror) load time.
- Battery impact; background-tab suspension behavior; jetsam kill rate.
- Long-text multi-chunk throughput and cancellation latency (unit tests cover
  chunking logic, not wall-clock behavior).

## Reproduce

```bash
npx vitest run                    # 38/38 unit
node scripts/verify-pages.mjs     # Pages-export real-audio gate (~1–3 min on this VM;
                                  # overwrites docs/evidence/freetts-verify-pages.{json,wav})
```

`scripts/verify-pages.mjs` stages the mirror into `out/api/verify-assets/`
(removed on the next `scripts/build-pages.sh` run, which rebuilds `out/`).
