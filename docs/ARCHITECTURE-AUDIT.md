# FreeTTS — Architecture Audit

**Date:** 2026-11-04 · **Auditor:** read-only audit agent · **Scope:** full repo at commit `7f5ad1f`
(No source files were modified for this audit. All line references are to the
tree at that commit.)

This document maps what the app *actually does*, layer by layer, with
`file:line` evidence. Claims about third-party behavior (ONNX Runtime,
transformers.js, kokoro-js) are grounded in the exact vendored bundle
(`node_modules/kokoro-js/dist/kokoro.web.js`, which is what ships — see
`next.config.ts`).

---

## 1. Frontend structure

Next.js 16 App Router, static export (`PAGES_EXPORT=1` → `out/`) deployed to
Cloudflare Pages. All pages are client components (`"use client"`).

| Route | File | Role |
|---|---|---|
| `/` (Studio) | `app/page.tsx` | Text input, engine tabs, generate/cancel, progress, result player |
| `/voices` | `app/voices/page.tsx` | Voice library (reads from provider) |
| `/settings` | `app/settings/page.tsx` | Device badge, model-cache manager |
| `/privacy` | `app/privacy/page.tsx` | Privacy explainer |
| `/verify` | `app/verify/page.tsx` + `components/verify-runner.tsx` | **Dev harness shipped in the production export** (`out/verify.html`, 20 KB). Runs real synthesis on `?text=&voice=&assets=` params and publishes `window.__ftts_verify`. Not linked from the UI, but publicly reachable. |

Shared state: `components/tts-provider.tsx` (`TTSProvider` context). It owns the
`EngineManager` singleton (Kokoro worker) and a lazily-created `SystemEngine`
(main thread). No component talks to an engine directly.

UI primitives: shadcn/ui wrappers in `components/ui/` (Tailwind v4). PWA shell:
`public/manifest.webmanifest`, hand-rolled `public/sw.js` (app-shell caching
only; model bytes are managed by transformers.js in Cache API), `components/sw-register.tsx`.

## 2. Kokoro integration path (end to end)

```
app/page.tsx  "Generate speech" button
  → components/tts-provider.tsx  generate()  (validates, loads model, synthesizes)
    → lib/engine-manager.ts  synthesize()  (postMessage to worker)
      → workers/tts.worker.ts  onmessage "synthesize"
        → engines/kokoro/kokoro-engine.ts  KokoroEngine (KokoroTTS from kokoro-js)
        → lib/text-chunk.ts  chunkText(text, { maxChars: 400 })
        → audio/concat.ts  concatChunks(waves)
      → postMessage back, Float32Array transferred zero-copy
    → tts-provider: audio/wav-encoder.ts encodeWav → Blob → URL.createObjectURL
      → components/studio/audio-player.tsx  <audio src={audioUrl}>
```

MP3 export: `audio/mp3-export.ts` → resolves `globalThis.lamejs` from the
`public/lame.min.js` bundle loaded as a plain `<script defer>` in
`app/layout.tsx:50`. Dynamic `import("@/audio/mp3-export")` on click
(`components/studio/audio-player.tsx`).

## 3. Inference location: worker vs main thread (verified)

**Inference runs 100% in the Web Worker.** Evidence:

- The `KokoroEngine` instance is constructed inside the worker:
  `workers/tts.worker.ts:28` (`const engine = new KokoroEngine();`). The main
  thread never imports `kokoro-js`.
- The worker's `onmessage` handler (`workers/tts.worker.ts:75`) runs
  `chunkText` (`:103`), the per-chunk `engine.synthesize` loop (`:103–116`),
  and `concatChunks` (`:119`) before posting the result back.
- The worker is created lazily on first use: `lib/engine-manager.ts:37–52`
  (`ensureWorker`), via `new Worker(new URL("../workers/tts.worker.ts", import.meta.url))`.
  Turbopack emits it as a separate asset (`out/_next/static/media/tts.worker.*.ts`, ~6 KB bootstrap).

**Main thread touches:** text validation, WAV/MP3 encoding
(`components/tts-provider.tsx:205`, `:295`), `Blob`/`ObjectURL` creation,
`<audio>` playback (`components/studio/audio-player.tsx`), and the
`SystemEngine` fallback (`engines/system/system-engine.ts`, runs
`speechSynthesis` on the main thread by API necessity).

**Phonemization also runs in the worker.** `kokoro-js` bundles the
`phonemizer` package (eSpeak-NG compiled to WASM) inside `dist/kokoro.web.js`
(Emscripten FS bootstrap strings such as `/usr/share/espeak-ng-data` are
present in the bundle). Since the only `KokoroTTS` instance lives in the
worker, phonemization never touches the main thread.

## 4. ONNX Runtime configuration

This is the single most important section for the performance work, because
**the repo sets no ORT session options at all**. Everything below is therefore
default behavior of the vendored stack — verified in the shipped bundle:

- **ORT version:** `1.22.0` (version strings in `node_modules/kokoro-js/dist/kokoro.web.js`;
  note `1.21.0` also appears once, in what looks like a changelog string).
  ORT ≥ 1.21 uses **JSEP** (JavaScript Environment for…/WebGPU shared-memory
  path) for the WebGPU execution provider — the bundle references
  `ort-wasm-simd-threaded.jsep.mjs` / `ort-wasm-simd-threaded.jsep.wasm` and
  contains `jsepInit`/`jsepRegisterBuffer` runtime code.
- **Execution providers:** chosen indirectly. `KokoroEngine.load()` passes
  `device: "webgpu" | "wasm"` to `KokoroTTS.from_pretrained`
  (`engines/kokoro/kokoro-engine.ts:116–117`), and kokoro-js/transformers.js
  maps that to the `webgpu` / `wasm` ORT execution providers. **No code in the
  repo passes `executionProviders`, `intraOpNumThreads`, arena options,
  `logLevel`, or `preferredOutputLocation`.** The only ORT-adjacent setting in
  the repo is `env.wasmPaths`, and only in verify mode
  (`workers/tts.worker.ts:43`).
- **Thread count:** the vendored transformers.js sets, at session init,
  `wasm.numThreads = Math.min(4, Math.ceil(hardwareConcurrency / 2))` when
  `self.crossOriginIsolated` is true, else `1`. On an iPhone (hardwareConcurrency
  6, COOP/COEP served via `public/_headers`) that is **3 threads** — but iOS
  in practice serializes them (see research report §Q1). On desktop Chrome
  (8+ cores) it is 4 threads.
- **`wasmPaths` in production: unverified.** The static export bundles
  `out/_next/static/media/ort-wasm-simd-threaded.jsep.*.wasm` (21.6 MB) and
  `out/_next/static/media/ort.bundle.min.*.mjs` (398 KB) — but **only the JSEP
  wasm binary is present; the non-JSEP `ort-wasm-simd-threaded.wasm` is not**.
  Every automated gate (`scripts/verify-audio.mjs`, `scripts/verify-pages.mjs`)
  pins `wasmPaths` to the local mirror (`workers/tts.worker.ts:42–43`), so the
  production resolution path (ORT deriving the wasm URL from the Turbopack
  worker bundle location) has **never been exercised**. If ORT requests the
  non-JSEP binary name at runtime for the `wasm` EP, it will 404 from
  `_next/static/media/` and fall back to a CDN fetch (which then depends on
  the CDN's `Cross-Origin-Resource-Policy` under `require-corp`).
- **Device selection:** `engines/kokoro/kokoro-engine.ts:50–64`
  (`resolveDevice`) — async `navigator.gpu.requestAdapter()` pre-check with an
  8 s timeout (added in `7f5ad1f`); adapter-less devices go straight to
  `wasm`/`q8`. **There is no iOS/platform exclusion**: an iOS 26 device *has* a
  WebGPU adapter, so it takes the `webgpu`/`fp32` path — the exact JSEP
  configuration implicated in `microsoft/onnxruntime#26827` (see
  `docs/research/…/report.md` §Q1). The `webgpu → wasm` retry
  (`kokoro-engine.ts:124–133`) only fires when session creation *throws*; the
  #26827 failure mode is a silent CPU/memory runaway, which does not throw.
- **Dtype policy:** `webgpu → fp32` (326 MB download), `wasm → q8`
  (92,361,116 bytes per `docs/BENCHMARKS.md`) — `kokoro-engine.ts:105`.

## 5. Model loading / init flow

1. User presses **Generate** (or previews a Kokoro voice): `tts-provider.tsx`
   `generate()` (`:185–229`) / `previewVoice()` (`:290`).
2. `EngineManager.loadModel(onProgress)` (`lib/engine-manager.ts:65–70`) →
   worker `"load"` message. The worker module (2.2 MB `kokoro.web.js` +
   dependencies) is fetched and instantiated at this point — **not at page
   load**.
3. Worker: `engine.load()` (`kokoro-engine.ts:94–141`):
   - `resolveDevice()` (adapter pre-check),
   - `KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype, device, progress_callback })`
     → downloads `model_quantized.onnx` (q8, ~92 MB) or fp32 (~326 MB) +
     `tokenizer.json` + `config.json` into the `transformers-cache` Cache API
     store, initializes the ORT session (compiles WASM, allocates the WASM
     heap), then lazily fetches the selected voice `.bin` (~523 KB for
     `af_heart`) into the `kokoro-voices` store on first `generate`.
4. Progress: transformers.js `progress_callback` reports **per-file** 0–100;
   `kokoro-engine.ts:109–114` forwards `info.progress / 100` directly, so the
   UI bar (`app/page.tsx:71` "Downloading voice model… N%") tracks the *current
   file*, not total bytes — it jumps back toward 0 at each file boundary.
5. `unload()` (`kokoro-engine.ts:170–178`): drops the `KokoroTTS` reference.
   The comment is honest — **the ORT WASM heap is process-global and cannot be
   freed per model**; JS-side memory is GC-eligible, native-side is not.

Cache inventory: `lib/model-store.ts` — the only persistent artifacts are the
two Cache API stores `transformers-cache` and `kokoro-voices` (`:17`).

## 6. Tokenization / phonemization path

`KokoroTTS.generate(text, { voice, speed })` (called per chunk in the worker)
does, in order: eSpeak-NG phonemization (WASM, in-worker) → tokenizer
(tokenizer.json) → ONNX forward pass → vocoder → `RawAudio { audio:
Float32Array, sampling_rate: 24000 }`. `KokoroEngine.synthesize`
(`kokoro-engine.ts:146–168`) copies the PCM (`audio.audio.slice()`, `:165`)
before returning. Chunk budget: `maxChars: 400` (`workers/tts.worker.ts:103`),
well under Kokoro's ~510-token cap.

## 7. Audio generation → playback path

1. Worker synthesizes chunks **sequentially**, accumulating `Float32Array[]`
   (`workers/tts.worker.ts:104–116`), posts per-chunk `synth-progress`.
2. `concatChunks` (`:119`) trims edge silence, joins with 8 ms equal-power
   crossfade, peak-normalizes (attenuate-only) — `audio/concat.ts`.
3. `post(..., [combined.buffer])` (`:121–132`) — **zero-copy transfer**; the
   worker-side buffer is detached.
4. Main thread (`tts-provider.tsx:201–209`): stores PCM in `audioDataRef`,
   `encodeWav(samples)` → `Blob("audio/wav")` → `URL.createObjectURL` →
   `setAudioUrl` (revoking the previous URL, `:207–209`).
5. `AudioPlayer` (`components/studio/audio-player.tsx`) renders `<audio
   src={audioUrl} preload="metadata">` with play/pause, seek slider
   (`onTimeUpdate` → `setCurrent`, `:109`), volume, speed select, WAV download
   (anchor click) and MP3 download (dynamic import of `audio/mp3-export.ts`,
   lamejs encode on the main thread, blob URL revoked after 10 s).
6. **There is no `AudioContext` anywhere in the codebase** (grep over
   `app components workers engines lib audio` returns zero hits). The research
   report's "AudioContext unlock failure" sub-cause therefore does not apply;
   playback unlock relies on the user's Play press (a real gesture) or on
   `el.play()`'s promise in `previewVoice` (`tts-provider.tsx:284,300`) —
   which, after a 40 s+ async synthesis, may fall outside Chrome's transient
   activation window and reject; the rejection is caught and silently clears
   the preview state.

**Critical sequencing fact:** playback is only possible after the *entire*
text is synthesized, concatenated, transferred, and WAV-encoded. There is no
streaming: time-to-first-audio = full generation time
(`tts-provider.tsx:198–211` awaits `mgr.synthesize` before encoding).

## 8. Memory touchpoints (complete inventory)

| # | Location | What | Size at MAX_CHARS=5000 |
|---|---|---|---|
| 1 | `workers/tts.worker.ts:105` | `waves: Float32Array[]` — all chunk PCM held simultaneously | ~13 chunks × ~3.8 MB ≈ 50 MB (at 24 kHz mono, 4 B/sample; ~348 s audio) |
| 2 | `kokoro-engine.ts:165` | `audio.audio.slice()` per chunk — full PCM copy in worker | transient ~3.8 MB per chunk |
| 3 | `audio/concat.ts:49` | `out = new Float32Array(total)` — combined buffer | ~33 MB |
| 4 | `audio/concat.ts` `trimSilence` | `.slice()` copies when trimming occurs | up to ~50 MB transient |
| 5 | `audio/concat.ts` `normalisePeak` | new `Float32Array` when peak > 0.98 | ~33 MB transient |
| 6 | Worker→main transfer | `combined.buffer` detached; main thread receives its own copy | ~33 MB on main thread (`audioDataRef`, `tts-provider.tsx:201`) |
| 7 | `audio/wav-encoder.ts:56` | `new ArrayBuffer(44 + dataSize)` — full WAV bytes | ~17 MB |
| 8 | `tts-provider.tsx:207` | WAV `Blob` + ObjectURL | ~17 MB (browser-managed) |
| 9 | ORT WASM heap | model q8 (92 MB) + session/arena overhead; **arena pre-allocation enabled by default, no disposal API reachable through kokoro-js** | several hundred MB (unmeasured; see PERFORMANCE-BASELINE.md) |
| 10 | `tts-provider.tsx` preview cache | per-voice WAV blob URLs, revoked only on `unloadModel` (`:259–260`) | ~0.5 MB per preview |
| 11 | `lib/model-store.ts` | Cache API `transformers-cache` + `kokoro-voices` | ~92 MB + voices, persistent |

Peak worker transient for a max-length text is therefore roughly **2–3× the
final PCM size** (waves + combined + trim/normalize copies alive
simultaneously), on top of the ORT heap. `unloadModel` (`tts-provider.tsx:243–261`)
revokes the audio URL and clears refs, but the WASM heap stays.

## 9. React render hotspots

- **Model-load progress** (`tts-provider.tsx:190,290` → `setLoadProgress`
  passed as the worker's `progress_callback`): transformers.js fires progress
  events frequently during a 92 MB download; every event triggers a
  `setLoadProgress` → full `StudioPage` re-render (the `statusLine` `useMemo`
  in `app/page.tsx:63–71` recomputes). Not a hang, but hundreds of wasted
  renders; also the bar is per-file, not aggregate (see §5.4).
- **Synthesis progress** (`tts-provider.tsx:199`): one `setSynthProgress`
  per chunk — cheap (chunks take seconds).
- **Seek slider** (`audio-player.tsx:109`): `onTimeUpdate` → `setCurrent` at
  ~4 Hz during playback — the only high-frequency state update; acceptable,
  standard pattern.
- **Text editor**: controlled `<textarea>` re-renders on keystroke — fine.
- **Settings WebGPU badge** (`app/settings/page.tsx:38`): uses the
  presence-only check `"gpu" in navigator` — the exact check commit `7f5ad1f`
  removed from the engine path as unreliable (adapter-less browsers report
  `true`). The badge can claim "available" when inference will actually use
  WASM.

## 10. Error handling per layer

| Layer | Mechanism | Gaps |
|---|---|---|
| `KokoroEngine.load` | WebGPU→WASM single retry on throw (`kokoro-engine.ts:124–133`); `loading` promise cleared on settle for retry (`:136–139`) | Retry does not catch silent runaway (JSEP leak); no timeout on the 8 s adapter race beyond the race itself |
| Worker `onmessage` | Whole-handler try/catch → `{ type: "error", aborted }` (`tts.worker.ts:137–149`); cooperative abort between chunks (`:107,117`) | In-flight ONNX forward pass cannot be interrupted (documented in UI); abort of one job aborts any previous (`:98`) |
| `EngineManager` | `worker.onerror` rejects **all** pending and clears (`lib/engine-manager.ts:42–48`); `dispose()` terminates | **No recovery**: after `onerror`, the worker is left in a broken state but not recreated; subsequent calls post into a dead worker and hang. **No timeouts anywhere** — a silently-killed worker (e.g., iOS jetsam of the worker thread) leaves the UI stuck on "Synthesizing…" with a Cancel button that posts to a dead worker |
| `TTSProvider.generate` | `fail()` → error banner; `AbortError` → idle (`tts-provider.tsx:212–223`) | Cancel during `loading-model` does not abort the download (no signal threaded into `load`) |
| `SystemEngine` | `utter.onerror` → reject; `synth.cancel()` on abort (`system-engine.ts:78–101`) | Chrome's stale-queue `cancel()` before `speak()` is handled (`:98`) |
| App shell | Error banner with dismiss (`app/page.tsx`) | No `visibilitychange`/background handling; no `sessionStorage` sentinel to detect a jetsam reload; `/verify` harness errors surface as `window.__ftts_verify = { ok: false }` only |

## 11. What the audit confirms vs the research report

- ✅ Inference is already in a Web Worker; the main thread is never blocked by inference. The iPhone "hang" is therefore *not* main-thread blocking from inference — it is the compounding of slow single-threaded WASM (cause 2), batch synthesis with no streaming (cause 5), memory pressure (cause 3), and — on iOS 26 — the JSEP/WebGPU trap (cause 4), which this codebase walks into because `resolveDevice()` has no iOS exclusion.
- ✅ `commit 7f5ad1f` fixed the adapter-less download trap (cause 1's worst case), but the progress bar is still per-file, and the Settings badge still uses the old presence check.
- ⚠️ The "no single-threaded fallback" claim in `docs/COMPATIBILITY.md` ("the app does not attempt a single-threaded fallback") is stale: the vendored ORT itself sets `numThreads=1` when the page is not cross-origin-isolated. The doc describes intent; the bundle describes behavior.
- ⚠️ `docs/ARCHITECTURE.md` §4 says the EngineManager does "WAV/MP3 encoding, AudioBuffer playback" — encoding is actually done in `TTSProvider` (`tts-provider.tsx:205`), and playback uses `<audio>`, not `AudioBuffer`.
