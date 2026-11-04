# FreeTTS — Architecture

**Date:** 2026-11-04 · **Status:** v1 (Kokoro engine + system fallback)

## 1. Principles

1. **Local-first inference.** Speech is synthesized on the user's device. There is
   no backend TTS service, no API key, no account, no per-request cost.
2. **Privacy by construction.** User-entered text never leaves the device for
   synthesis. The only network traffic is *model/asset downloads* (weights, voice
   embeddings, WASM runtimes) from public CDNs — explicitly distinguished from
   text processing in the UI and privacy page.
3. **Engine abstraction.** The UI never talks to a model directly; it talks to
   `TTSEngine`. New models plug in without rewriting the app.
4. **Honesty over coverage.** Engines declare their own capabilities; the UI
   renders only what the engine really supports. No fake voices, no fake
   languages, no fake audio.
5. **No model weights in the JS bundle.** Models download lazily, on first use,
   and are cached by the browser.

## 2. System overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Next.js App (PWA)                     │
│                                                              │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │  Studio  │  │ Voice Library│  │ Settings / Model Mgr   │  │
│  │  (page)  │  │   (page)     │  │  Privacy (page)        │  │
│  └────┬─────┘  └──────┬───────┘  └────────────────────────┘  │
│       │               │                                      │
│       ▼               ▼                                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ EngineManager (lib/engine-manager.ts, main thread)   │   │
│  │  - owns worker lifecycle, request/response routing  │   │
│  │  - WAV/MP3 encoding, AudioBuffer playback           │   │
│  └──────────────────────┬───────────────────────────────┘   │
│                         │ postMessage (transfers PCM)        │
│  ┌──────────────────────▼───────────────────────────────┐   │
│  │ TTS Web Worker (workers/tts.worker.ts)               │   │
│  │  - TTSEngine (KokoroEngine)                          │   │
│  │  - chunkText → synthesize × N → concatChunks         │   │
│  │  - onnxruntime-web (WebGPU → WASM fallback)          │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  Fallback path (no worker): SystemEngine → speechSynthesis  │
└─────────────────────────────────────────────────────────────┘
         │ downloads (one-time, cached)         │ never sent
         ▼                                      ╳
  HuggingFace CDN / jsDelivr              user text, audio
  (model .onnx, voice .bin, ORT WASM)
```

## 3. Engine abstraction (`engines/`)

`TTSEngine` (`engines/engine-interface.ts`) is the only contract the app depends on:

- `load(onProgress)` — idempotent; downloads + initializes the model.
- `getVoices()` — voices available **after** load.
- `synthesize(text, voiceId, options)` — one short chunk → `{ samples, sampleRate }`.
- `unload()`, `isLoaded()`.
- `capabilities` — `{ languages, speedControl, audioExport, limitations }`.
  Engines declare what they can do; the UI must not assume.

| Engine | Status | Quality | License note |
|---|---|---|---|
| `engines/kokoro/` — Kokoro-82M via kokoro-js | ✅ primary | high (arena-verified) | Apache-2.0 weights/code; app is GPL-3.0-or-later because the `phonemizer` dep bundles eSpeak-NG (GPL-3.0) |
| `engines/system/` — Web Speech API (`speechSynthesis`, local voices only) | ✅ tier-0 fallback | OS-dependent | built-in |
| Piper (VITS, WASM) | 🔶 documented future | medium | engine code GPL-3.0; per-voice dataset licenses |
| Chatterbox (clone mode) | 🔶 documented future | high | MIT; 1.5 GB, 5–10 s/call cap |

Rationale for the choice is in `MODEL-RESEARCH.md` §8.

### 3.1 Why `audioExport` exists
Some engines (system voices) render audio directly and cannot hand the app PCM.
Rather than faking downloadable audio, the capability flag lets the UI hide
export controls honestly.

## 4. Threading & inference flow

1. User presses Generate → UI validates text (`lib/text-chunk.ts`).
2. `EngineManager.synthesize()` posts `{ text, voiceId, speed }` to the worker.
3. Worker: `chunkText(text, { maxChars: 400, locale: "en" })` → for each chunk,
   `engine.synthesize()` (checks `AbortSignal` between chunks; reports
   `synth-progress`) → `concatChunks()` (trims edge silence, equal-power
   crossfade, peak-normalize) → transfers the `Float32Array` back (zero-copy).
4. Main thread: encodes WAV (`audio/wav-encoder.ts`) / MP3, builds an
   `AudioBuffer` at the engine's native sample rate for playback.

The main thread never blocks on inference; cancellation is cooperative between
chunks (an in-flight ONNX forward pass cannot be interrupted — stated in the UI
as "cancel applies between sentences").

### 4.1 Device capability detection
`KokoroEngine` selects WebGPU (`dtype fp32`) when `navigator.gpu` exists,
otherwise WASM (`dtype q8`). If WebGPU initialization fails, it retries once on
WASM. If both fail, the error propagates to the UI with a plain-language message
and the system-voices fallback is offered. The active device is reported to the
UI (and to the verification harness).

## 5. Audio pipeline (`audio/`)

- **Native sample rates preserved.** Kokoro outputs 24 kHz mono; the app encodes
  and plays at the engine's native rate — no resampling, no fake upsampling.
- **`wav-encoder.ts`** — float → 16-bit PCM WAV, hard-clips to [-1,1],
  validates headers (`parseWavHeader`), exposes `peakAmplitude` /
  `nonSilentFraction` used by the verification gate.
- **`concat.ts`** — `trimSilence` (bounded), `concatChunks` (equal-power
  crossfade, default 8 ms), `normalisePeak` (attenuate-only, target 0.98).
  We never claim "seamless" — the crossfade removes clicks; tiny prosodic
  seams between independently synthesized sentences are expected and documented.
- **MP3 export** — `lamejs` (browser-compatible, BSD-licensed), verified in tests.

## 6. Model distribution & caching

- **Source:** `onnx-community/Kokoro-82M-v1.0-ONNX` on HuggingFace (transformers.js
  cache) + `voices/*.bin` (kokoro-js `Cache API` store `"kokoro-voices"`).
- **Lazy:** nothing downloads at startup. The model downloads on first Generate;
  voices download per voice selection (~523 KB each).
- **Smallest viable default:** WASM path uses the q8 quantized model (~92 MB);
  WebGPU uses fp32 (~326 MB). The choice is automatic per device.
- **User control:** Settings → Model manager lists cached assets with sizes and
  offers deletion (Cache API + transformers.js cache). Honest notes about
  browser storage eviction (see Privacy page).
- **No weights in the JS bundle:** `next.config.ts` aliases `kokoro-js` to its
  self-contained `dist/kokoro.web.js` (transformers.js + ORT + eSpeak-NG inlined,
  ~2.1 MB, no node builtins) so client/worker bundles stay lean.

## 7. Offline (PWA)

- Service worker (Next-PWA style) caches the app shell.
- Models/voices live in Cache API / IndexedDB (transformers.js + kokoro-js),
  which the service worker does not need to manage.
- After first successful generation, the app works offline for the downloaded
  voice. Offline detection shows a clear banner; generation with a
  not-yet-downloaded voice explains what is missing.
- Honest limit: browsers may evict opaque cache storage under pressure — the
  app says so instead of promising permanent offline availability.

## 8. Privacy architecture

- Text is processed in a Web Worker and in onnxruntime-web tensors. It is never
  `fetch()`ed anywhere, never logged, never sent to analytics (there are none).
- The system-voices fallback uses **only** `localService === true` voices, so
  Chrome/Edge network voices (which would send text to vendor servers) are
  excluded by construction.
- Generated audio is held in memory; it is written to disk only when the user
  presses Download. No audio is retained after the tab closes (unless the user
  saved it).
- Network requests the app makes, all user-visible in Settings → Privacy:
  1. model/weight downloads (HuggingFace, jsDelivr) — one-time, cached;
  2. nothing else.

## 9. Testing

- **Unit** (`vitest`): text chunking, WAV encode/decode round-trip, concat
  de-clicking, normalization — `tests/`.
- **Real-audio gate** (`scripts/verify-audio.mjs`): headless Chromium + `next dev`
  + `/verify` harness; asserts valid WAV bytes, 24 kHz, non-silence, plausible
  duration, page-vs-Node stat agreement. **Must pass before any UI work.**
- **Integration** (planned): worker round-trip, cancellation, model-manager
  delete, PWA offline — see `docs/TEST-REPORT.md`.
- **Compatibility ledger** (`docs/COMPATIBILITY.md`): tested / partially tested /
  untested per environment — never claimed without evidence.

## 10. Key engineering decisions

| # | Decision | Why |
|---|---|---|
| 1 | Kokoro-82M primary, English-only at launch | Only browser-proven high-quality model with permissive weights license; kokoro-js 1.2.1 is English-only — advertising more would be dishonest |
| 2 | App licensed GPL-3.0-or-later | `phonemizer` (kokoro-js dep) bundles eSpeak-NG (GPL-3.0); shipping it to browsers is distribution |
| 3 | Inference in a Web Worker, PCM transferred zero-copy | UI stays responsive during multi-second synthesis |
| 4 | Sentence-aware chunking (Intl.Segmenter, 400 chars) + crossfade concat | Kokoro's 510-token limit; progress + cancellation; de-clicked joints |
| 5 | Native 24 kHz throughout | No resampling artifacts; WAV contains exactly what the model produced |
| 6 | Web Speech API (local voices) as tier-0 fallback | Zero-byte guarantee that the app always speaks something |
| 7 | `kokoro-js` → `dist/kokoro.web.js` alias | Self-contained bundle; no node core modules in client/worker builds |
| 8 | No backend, no accounts, no analytics | Privacy-first product vision; zero operating cost |
