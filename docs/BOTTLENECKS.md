# FreeTTS — Bottlenecks (ranked)

**Date:** 2026-11-04 · **Basis:** code evidence in the repo at `7f5ad1f`,
measurements in PERFORMANCE-BASELINE.md, and the research report
(`~/workspace/research_notes/mobile-tts-system-design-20261104-0713/report.md`).
Device-specific claims are marked **ESTIMATED** where no hardware was available.

Severity: **Critical** = makes the app unusable on the device class;
**High** = degrades badly or risks silent failure; **Medium** = waste/correctness nit.

---

## 1. Batch synthesis — time-to-first-audio equals full generation time [CRITICAL]

**Evidence:** `workers/tts.worker.ts:103–132` — the worker loops over all
chunks, accumulates `waves`, runs `concatChunks`, and only then posts
`synth-done`. `components/tts-provider.tsx:198–211` awaits the full result
before `encodeWav` and `URL.createObjectURL`. Playback is impossible before
that.

**Maps to:** research cause **#5** (no streaming). The worker-off-main-thread
design (good) does not help: the user still waits the entire generation with
no audio.

**Impact:** on this VM the gate text (133 chars) takes 41–82 s before any
sound; a 5000-char text is ESTIMATED at ~25 min. On iPhone (cause #2 below),
minutes per paragraph with zero feedback beyond "sentence N of M".
Perceived as a hang. Hits hardest: **iPhone Safari, Android Chrome,
low-memory devices** — but also desktop CPU-only.

## 2. Kokoro q8 on WASM is far below real-time on phone-class CPUs [CRITICAL]

**Evidence:** measured RTF **4.4–8.9** on a shared server Xeon
(PERFORMANCE-BASELINE.md). The repo selects `wasm`/`q8` for every device
without a WebGPU adapter (`engines/kokoro/kokoro-engine.ts:50–64,105`), which
is every iPhone on iOS ≤ 18 and most Androids. The vendored transformers.js
sets `wasm.numThreads = min(4, ceil(hardwareConcurrency/2))` (3 on iPhone),
but iOS serializes WASM threads in practice (research §Q1).

**Maps to:** research cause **#2** (single-threaded WASM inference speed).

**Impact:** ESTIMATED RTF 2–4+ on iPhone → even with streaming (fix #1),
playback would stall once the audio queue drains, because generation is
slower than playback. This is why the research consensus is that Kokoro-82M
cannot be the phone engine. Hits hardest: **iPhone 12 Pro and older, iOS
Safari, Android mid-range**.

## 3. iOS 26 takes the WebGPU/JSEP path with no exclusion [CRITICAL]

**Evidence:** `resolveDevice()` (`engines/kokoro/kokoro-engine.ts:50–64`)
returns `"webgpu"` whenever `navigator.gpu.requestAdapter()` succeeds — true
on iOS 26. The vendored ORT is **1.22.0** with the JSEP WebGPU build
(`ort-wasm-simd-threaded.jsep.*` references in `kokoro.web.js`). There is no
platform check. The `webgpu → wasm` retry (`kokoro-engine.ts:124–133`) only
fires on a *thrown* error; the documented `onnxruntime#26827` failure mode
(CPU 400%+, memory growing unboundedly to 14 GB+, tab crash) does not throw.

**Maps to:** research cause **#4** (the JSEP/WebGPU trap on iOS 26). Note the
irony: commit `7f5ad1f`'s adapter pre-check *increases* exposure here —
adapter-less devices are now correctly routed to WASM, but iOS 26 devices,
which *have* an adapter, are routed into the regression.

**Impact:** the "phone slows to a crawl" symptom matches the #26827 leak
profile exactly. Hits hardest: **iPhones on iOS 26+** (growing share).

## 4. Memory: no ORT tuning, 2–3× PCM transient, unfreable WASM heap [HIGH]

**Evidence:**
- The repo passes **zero** ORT session options — no `intraOpNumThreads` cap,
  no arena/`mem-pattern` disable, no tensor disposal hooks
  (`engines/kokoro/kokoro-engine.ts:116–117` passes only `dtype/device/progress_callback`;
  `workers/tts.worker.ts` sets only `wasmPaths` in verify mode).
- Peak transient ≈ 2–3× final PCM: `waves[]` accumulation
  (`tts.worker.ts:105`) + `concatChunks` output (`audio/concat.ts:49`) +
  `trimSilence` slice copies + possible `normalisePeak` copy + per-chunk
  `audio.audio.slice()` (`kokoro-engine.ts:165`), then a full second copy on
  the main thread for WAV bytes (`audio/wav-encoder.ts:56`,
  `tts-provider.tsx:205`).
- `unload()` cannot free the ORT WASM heap — documented in-code
  (`kokoro-engine.ts:170–178`).

**Maps to:** research cause **#3** (memory pressure → silent jetsam kill),
amplified by #1 (batch holds everything at once).

**Impact:** ESTIMATED several-hundred-MB peak on long texts pushes toward
iOS's per-tab jetsam cliff; the kill is silent and reloads the tab
(perceived as hang/restart loop). Hits hardest: **older iPhones (≤ 4 GB RAM),
iOS Safari**; also low-memory Android.

## 5. No failure recovery: dead worker hangs the UI forever [HIGH] — new finding

**Evidence:** `lib/engine-manager.ts:42–48` — `worker.onerror` rejects all
pending promises and clears the map, but the worker is **not recreated**;
later calls `postMessage` into a dead worker and their promises never settle.
There are **no timeouts** on any request. A worker killed silently (jetsam,
OOM) produces the same symptom: UI stuck on "Synthesizing…" with a Cancel
button that posts to a dead worker (`:90–93`). No `visibilitychange`
handling, no `sessionStorage` sentinel to detect a jetsam reload.

**Maps to:** new finding (amplifier of cause **#3** — turns a tab/worker kill
into a permanent UI hang instead of a recoverable error).

**Impact:** on flaky mobile browsers a transient kill becomes a stuck app
requiring a manual reload. Hits hardest: **iOS Safari, low-memory Android**.

## 6. Progress UX: per-file bar, unthrottled renders [MEDIUM]

**Evidence:** `kokoro-engine.ts:109–114` forwards transformers.js per-file
progress directly, so the "Downloading voice model… N%" bar
(`app/page.tsx:71`) resets at each file boundary during the ~117 MB
first-Generate download. `setLoadProgress` fires per progress event
(`tts-provider.tsx:190`) → full `StudioPage` re-render each time.

**Maps to:** research cause **#1** (download with poor feedback) — partially
mitigated already (there *is* a progress UI), but the per-file reset reads as
a stall on slow mobile networks.

## 7. Production ORT WASM resolution is unverified [MEDIUM] — new finding

**Evidence:** every gate pins `env.wasmPaths` to the test mirror
(`workers/tts.worker.ts:42–43`); the production default path has never run.
The static export bundles **only** the JSEP wasm (`out/_next/static/media/`
has `ort-wasm-simd-threaded.jsep.*.wasm`, 21.6 MB — no non-JSEP
`ort-wasm-simd-threaded.wasm`). If the `wasm` EP requests the non-JSEP name
at runtime, it 404s and falls back to a CDN fetch (subject to the CDN's
`Cross-Origin-Resource-Policy` under `require-corp`).

**Impact:** potential first-Generate failure on the live site that no gate
would catch. Hits: **all deployments** (desktop too).

## 8. Smaller findings (each one line)

- **Settings WebGPU badge is stale** (`app/settings/page.tsx:38`): still uses
  the `"gpu" in navigator` presence check that `7f5ad1f` removed from the
  engine path — can report "available" when inference uses WASM. [MEDIUM]
- **`/verify` harness ships in production** (`out/verify.html`): public,
  unlinked inference endpoint page. Harmless but untidy; also lets anyone
  burn the visitor's CPU. [LOW]
- **`lame.min.js` (156 KB) loads on every page** (`app/layout.tsx:50`) though
  only MP3 export needs it. [LOW]
- **Preview `play()` can silently fail**: `previewVoice`
  (`tts-provider.tsx:284,300`) calls `el.play()` after a 40 s+ async
  synthesis, outside the transient-activation window; the rejection is caught
  and the preview state just clears. No hang, but confusing. (The research's
  AudioContext-unlock sub-cause does **not** apply — the app uses `<audio>`
  exclusively; zero `AudioContext` references in the codebase.) [LOW]
- **`docs/COMPATIBILITY.md` is stale**: claims "the app does not attempt a
  single-threaded fallback", but the vendored ORT sets `numThreads=1` when
  the page isn't cross-origin-isolated. [LOW]
- **`docs/ARCHITECTURE.md` §4 is stale**: says EngineManager does "WAV/MP3
  encoding, AudioBuffer playback" — encoding lives in `TTSProvider`, playback
  is `<audio>`, not `AudioBuffer`. [LOW]

---

### Ranking summary

| # | Bottleneck | Severity | Worst-hit devices |
|---|---|---|---|
| 1 | Batch synthesis, no streaming | Critical | iPhone Safari, Android Chrome, low-memory |
| 2 | Kokoro q8 WASM far below real-time | Critical | iPhone ≤12 Pro, iOS Safari, mid-range Android |
| 3 | iOS 26 WebGPU/JSEP trap, no exclusion | Critical | iPhones on iOS 26+ |
| 4 | Untuned ORT memory, 2–3× PCM transient | High | Older iPhones, low-memory Android |
| 5 | Dead worker hangs UI (no recovery/timeout) | High | iOS Safari, low-memory Android |
| 6 | Per-file progress bar, unthrottled renders | Medium | Slow mobile networks |
| 7 | Production ORT wasm resolution unverified | Medium | All deployments |
| 8 | Stale badge/docs, verify in prod, misc | Low | — |
