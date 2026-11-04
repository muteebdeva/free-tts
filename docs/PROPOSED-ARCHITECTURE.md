# FreeTTS — Proposed Architecture (Phase 2 design)

**Date:** 2026-11-04 · **Status:** design doc — no code changed.
Implements the research report's ranked fix
(`~/workspace/research_notes/mobile-tts-system-design-20261104-0713/report.md`)
inside the hard constraints: **Kokoro-82M stays for WebGPU desktop** (its phone
failure is the documented justification for the ladder, not a violation),
existing voices/features preserved, local-first, no paid APIs, **no new
backend**, still a Cloudflare Pages static export. iPhone/Android real-device
testing is unavailable here — every device-specific claim is marked accordingly.

Design principle: the `TTSEngine` interface (`engines/engine-interface.ts`)
already abstracts engines, and inference is already worker-isolated. Phase 2
adds **routing** (which engine, which ORT config, on which device),
**streaming** (first audio fast), and **recovery** (timeouts, worker rebirth,
OOM hygiene) — without rewriting the audio pipeline.

---

## (a) Device-aware engine ladder

**What changes.** A new module `lib/device-profile.ts` classifies the device
once per page load and picks the *default* engine and the Kokoro ORT
configuration. The user can always override; the ladder only sets the default
and gates what is offered.

| Device class (detected) | Default engine | Kokoro availability |
|---|---|---|
| iOS / iPadOS (any version) | **System voices** (Web Speech, local-only) | Opt-in only, forced to `wasm`/`q8`/non-JSEP/1-thread (see (d)); on iOS 26 the WebGPU path is **disabled** until `onnxruntime#26827` is fixed |
| Android / mobile, no usable WebGPU | **System voices** | Opt-in, `wasm`/`q8`, threads per profile |
| Desktop + working WebGPU adapter | **Kokoro-82M** (`webgpu`/`fp32`) — unchanged | Default |
| Desktop, no WebGPU | **Kokoro-82M** (`wasm`/`q8`) — current behavior, honest banner kept | Default |

Detection inputs: `navigator.gpu?.requestAdapter()` result (reuse the
`resolveDevice()` logic, extended), UA-based iOS check (`/iPad|iPhone|iPod/`
or Mac + `navigator.maxTouchPoints > 1`), `navigator.hardwareConcurrency`,
`navigator.deviceMemory` where available (Chromium-only; iOS reports nothing —
treat absence as "unknown", never as "capable").

**Light neural opt-up (mobile only, gated).** Candidate: **KittenTTS Nano**
(~24 MB, Apache-2.0, ~3× real-time in browser WASM per research sources) as a
new `engines/kitten/` implementing `TTSEngine`. **Ship-blockers, non-negotiable:**
(1) it must pass the repo's real-audio gate (`scripts/verify-pages.mjs`
extended — real WAV bytes, non-silent, sane duration); (2) license verified
against the exact distribution (weights Apache-2.0; note its espeak-ng
dependency is GPL-3.0 — consistent with this app's existing GPL-3.0 license,
but verify the bundle actually used); (3) size/speed claims re-measured, not
quoted. **Piper stays out** until its license conflict (MIT vs GPLv3 across
2026 sources) is resolved per distribution — flag, do not ship on hope.

**Files:** new `lib/device-profile.ts`; new `engines/kitten/*` (only after the
gate passes); `components/tts-provider.tsx` (default `engineChoice` from
profile, engine tabs show/hide per ladder); `app/settings/page.tsx` (device
badge shows profile + active path); `engines/kokoro/kokoro-engine.ts` (accept
an injected device/dtype policy instead of self-detecting only).
**Untouched:** `engines/engine-interface.ts`, `engines/kokoro/voices.ts`
(28 voices preserved), `engines/system/system-engine.ts`.

**Verified by:** unit tests for the classifier with mocked `navigator`
(iOS UA → compatibility, desktop+adapter → performance, etc.);
`docs/COMPATIBILITY.md` ledger updated; the existing verify gate runs
unchanged for the Kokoro path.

## (b) Sentence streaming with first-chunk playback + bounded queue + backpressure

**What changes.** The worker stops batching. Protocol v2 between
`workers/tts.worker.ts` and `lib/engine-manager.ts`:

1. Worker synthesizes chunk *i*, then immediately
   `post({ type: "chunk-done", requestId, index: i, samples }, [buffer])` —
   zero-copy transfer per chunk, same mechanism as today
   (`tts.worker.ts:121–132`).
2. Main thread appends each chunk's PCM to a retained array (needed for
   WAV/MP3 export — reuse `concatChunks` on demand at export time), creates a
   per-chunk blob URL, and enqueues it in a **bounded audio queue**
   (high-water mark 3 chunks).
3. **Backpressure:** the worker pauses when unacknowledged chunks reach the
   high-water mark and resumes on `chunk-ack`. Implemented as an ack-promise
   map in the worker's `onmessage` (no `SharedArrayBuffer` tricks).
4. **Playback:** sequential `<audio>` elements — the iOS-privileged playback
   path (no `AudioContext`, consistent with the current architecture). While
   chunk *i* plays, chunk *i+1* is preloaded (`preload="auto"` + `.load()`).
   Each played chunk's blob URL is revoked after `ended`.
5. **Time-to-first-audio** becomes time-to-first-chunk (~one 400-char
   inference instead of the whole text).

**Cancellation** becomes graceful for free: completed chunks stay playable
and exportable; the worker just stops producing. New provider phase
`streaming` ("Playing… still generating — sentence N of M"); cancel during
streaming → `ready-partial` with the partial audio retained.

**Files:** `workers/tts.worker.ts` (streaming loop, ack handling);
`lib/engine-manager.ts` (streaming API: `synthesizeStream` with
`onChunk`/`onProgress` events, per-chunk watchdog — see (e));
`components/tts-provider.tsx` (queue state, phases, partial-export);
new `components/studio/streaming-player.tsx` (or extend `audio-player.tsx`).
**Untouched:** `lib/text-chunk.ts`, `audio/concat.ts` (still used for export),
`audio/wav-encoder.ts`, `audio/mp3-export.ts`.

**Verified by:** extended `verify-pages.mjs --stream` asserting a `chunk-done`
event arrives well before `synth-done` and that concatenated streamed PCM
byte-matches batch PCM for the same input (regression: streaming must not
change audio); vitest for the queue/backpressure state machine with a mocked
worker.

**Explicitly out of scope:** gapless MSE/WebCodecs playback (WAV isn't MSE-
streamable; AAC-via-WebCodecs is a project of its own). Small inter-chunk
gaps with sequential `<audio>` are documented and acceptable for v1.

## (c) Device profiles (PERFORMANCE / BALANCED / COMPATIBILITY)

**What changes.** `lib/device-profile.ts` emits a profile consumed by the
worker and the UI:

| | PERFORMANCE (desktop + WebGPU) | BALANCED (desktop CPU / capable Android) | COMPATIBILITY (iOS, low-memory) |
|---|---|---|---|
| Default engine | kokoro fp32 | kokoro q8 | system voices |
| Kokoro ORT | webgpu EP, defaults | wasm EP, `numThreads = min(4, ceil(hw/2))` | wasm EP, **1 thread, non-JSEP build**, q8 |
| Chunk size | 400 chars | 300 chars | 200 chars (faster first audio, smaller transients) |
| Stream high-water | 4 | 3 | 2 |
| Worker count | 1 (already singleton) | 1 | 1 — never a pool |

**Files:** new `lib/device-profile.ts`; `workers/tts.worker.ts` (apply
`chunkChars`, high-water, and ORT env per profile); `app/page.tsx` (show
profile-appropriate hints). **Untouched:** everything in `audio/`,
`lib/text-chunk.ts` (takes `maxChars` as a parameter already).

**Verified by:** unit tests over the profile table; benchmark deltas recorded
in `docs/BENCHMARKS.md` per profile on this VM (wasm profiles are measurable
here; iOS profile behavior is ESTIMATED until device testing exists).

## (d) Memory management

**What changes.**

- **Threading:** set `env.backends.onnx.wasm.numThreads` from the profile
  *before* session creation in the worker (`import { env as kokoroEnv } from
  "kokoro-js"` is already imported at `workers/tts.worker.ts:18`). COMPATIBILITY → 1.
- **Non-JSEP WASM on iOS:** the static export currently bundles only the JSEP
  wasm (BOTTLENECKS.md #7). Ship the non-JSEP `ort-wasm-simd-threaded.wasm`
  under `public/ort/` and set `env.wasmPaths` to it when the profile is
  COMPATIBILITY — this dodges the #26827 JSEP regression *and* the WASM-EP
  binary-name 404 risk in one move. (Build plumbing required; gate it in the
  verify script by asserting which binary the page fetches.)
- **Tensor disposal / arena opts:** flagged as **partially infeasible** —
  kokoro-js 1.2.1 exposes no per-session ORT options, so `arena`,
  `mem-pattern`, and tensor disposal are only reachable if transformers.js
  `env` exposes them. Spike first: if unreachable, document and rely on
  thread-count + chunk sizing + the worker-restart reset below.
- **App-level hygiene (fully feasible):** per-chunk transfers already avoid
  copies; add blob-URL revocation after each played chunk (streaming player);
  keep the existing `audioUrl`/`previewCache` revocation
  (`tts-provider.tsx:207–209,259–260`); drop the per-chunk
  `audio.audio.slice()` copy in `kokoro-engine.ts:165` if kokoro-js's reuse
  proves safe under streaming (verify with the byte-match regression test —
  otherwise keep the copy).
- **Worker lifecycle as the memory reset:** since the ORT WASM heap is
  process-global and `unload()` can't free it (`kokoro-engine.ts:170–178`),
  `unloadModel` should **terminate and recreate the worker** — the only real
  way to reclaim native memory short of a tab reload. Same treatment after a
  suspected OOM error.

**Files:** `workers/tts.worker.ts`, `lib/engine-manager.ts` (recreate worker
on demand — `ensureWorker` already lazily recreates when `this.worker` is
null; set it null on error/terminate), `components/tts-provider.tsx`,
`next.config.ts` or `public/ort/` (non-JSEP binary).
**Untouched:** `lib/model-store.ts`, ORT version pin (stays 1.22.0 via
kokoro-js; revisit if a fixed release resolves #26827).

**Verified by:** heap snapshots where measurable (desktop DevTools;
`performance.measureUserAgentSpecificMemory`); on this VM, assert
worker-recreate actually drops RSS in the verify harness; iOS numbers remain
ESTIMATED.

## (e) Failure recovery

**What changes.**

- **Timeouts:** `EngineManager.call()` gains a per-request watchdog; the
  streaming API adds a per-chunk watchdog (no `chunk-done`/`synth-progress`
  for N s → reject as stalled). Ends the "stuck on Synthesizing…" class
  (BOTTLENECKS.md #5).
- **Worker rebirth:** `worker.onerror` and watchdog timeouts set
  `this.worker = null` after `terminate()`; the next call transparently
  creates a fresh worker (extends the existing lazy `ensureWorker`,
  `lib/engine-manager.ts:37–52`). In-flight job reports a clear error
  ("Speech engine stopped unexpectedly — try again or switch to system
  voices") instead of hanging.
- **Jetsam sentinel:** `sessionStorage` flag set on generate start, cleared
  on completion; on page load, a stale flag means the last tab died
  mid-generate → show a one-time honest notice ("The last session was
  interrupted — your device may be low on memory. System voices are the
  safest choice here.") instead of a blank slate.
- **Backgrounding:** `visibilitychange` during streaming pauses *UI* queue
  advancement bookkeeping (the worker keeps generating; iOS may suspend it —
  the watchdog converts a suspended-forever worker into the clear error
  above rather than a silent stall).
- **Cancellation:** with streaming, completed chunks are retained and
  playable/exportable (see (b)) — cancel stops being destructive.

**Files:** `lib/engine-manager.ts`, `components/tts-provider.tsx`,
`app/page.tsx` (sentinel notice).
**Untouched:** engine implementations (recovery lives above them).

**Verified by:** vitest with a fake worker that dies mid-stream (assert UI
recovers + worker recreated); manual kill test in the verify harness
(`worker.terminate()` injected → assert watchdog fires and message is clear).

## (f) UX: honest progress, real percentages, first-audio state

**What changes.**

- **Throttle load progress:** wrap the `setLoadProgress` callback so state
  updates at most every ~250 ms or on ≥1 % delta — ends the hundreds of
  re-renders during the 92 MB download
  (`components/tts-provider.tsx:190,290`).
- **Real percentages only:** label per-file progress honestly
  ("Downloading model weights… 42%") instead of implying a total; drop the
  fake `{ done: 0, total: 1 }` seed (`tts-provider.tsx:197`) — show
  "Preparing…" until the first real event.
- **First-audio-ready state:** new `streaming` phase with "Playing — still
  generating (sentence N of M)"; the Generate button becomes "Stop" (keeps
  partial audio) vs today's all-or-nothing Cancel.
- **Fix the Settings badge** (`app/settings/page.tsx:38`): show the profile
  name + `engine.activeDevice` via `getEngineManager().getDevice()` instead
  of the `"gpu" in navigator` presence check.
- **Ladder transparency:** on COMPATIBILITY devices the Studio explains *why*
  system voices are the default ("Neural voices need ~X MB and are slower
  than real time on this device") with a one-tap opt-in — no hidden
  downgrade.

**Files:** `components/tts-provider.tsx`, `app/page.tsx`,
`app/settings/page.tsx`. **Untouched:** visual design system, voice library.

**Verified by:** vitest for the throttle; screenshot/selector checks in the
verify harness for phase transitions (`loading-model` → `streaming` →
`ready`); no fake-progress assertion (progress values must be monotonic per
file).

---

## Feasibility flags (research recommendations judged against this codebase)

1. **Cloudflare Workers AI fallback (research rec #2) — DEFERRED, not
   infeasible technically.** It needs a backend Worker, which violates the
   "no new backend" constraint and weakens the local-first privacy story
   (text leaves the device). Keep as an explicit, user-opt-in future tier
   with server-side token proxying and rate limiting — do not build in
   Phase 2.
2. **ORT arena / mem-pattern / tensor disposal — PARTIALLY INFEASIBLE**
   through kokoro-js 1.2.1: no per-session options are exposed. Reachable
   surface is transformers `env` globals (thread count confirmed reachable).
   Spike before committing; otherwise compensate with 1-thread policy,
   smaller chunks, and worker-restart resets.
3. **Non-JSEP WASM pinning — FEASIBLE** but needs build plumbing (ship the
   binary, set `wasmPaths` per profile) and a gate asserting the fetched
   binary name. Do it; it also fixes BOTTLENECKS.md #7.
4. **KittenTTS Nano / Piper as neural opt-up — FEASIBLE but GATED** on the
   real-audio gate + license verification (see (a)). Never ship on quoted
   benchmarks.
5. **iOS 26 WebGPU re-enable — CONDITIONAL** on `microsoft/onnxruntime#26827`
   being fixed upstream; watch the issue, keep the force-WASM rule until then.
6. **Gapless streaming (MSE/WebCodecs) — OUT OF SCOPE** for Phase 2;
   sequential `<audio>` gaps are acceptable and documented.

## What stays untouched (Phase 2 non-goals)

`engines/engine-interface.ts` (the contract holds), `lib/text-chunk.ts`,
`audio/concat.ts`, `audio/wav-encoder.ts`, `audio/mp3-export.ts`,
`lib/model-store.ts`, `engines/kokoro/voices.ts` (28 voices),
`engines/system/system-engine.ts`, PWA shell (`public/sw.js`,
`public/manifest.webmanifest`), `public/_headers`, all `app/` routes'
structure, and the `/verify` harness concept (extended, not removed —
though it should stop shipping in the production export; serve it
dev-only like `app/api/verify-assets`).

## Verification spine for Phase 2

1. `npx vitest run` — 38 existing + new tests (classifier, streaming
   protocol, throttle, recovery) must pass.
2. `node scripts/verify-pages.mjs --stream` — gate extended: first-chunk
   latency asserted, streamed PCM byte-matches batch PCM, fetched ORT binary
   name asserted per profile.
3. `docs/BENCHMARKS.md` — new table per device profile (measured on this VM
   where possible; iOS rows stay ESTIMATED until device testing exists).
4. `docs/COMPATIBILITY.md` — ledger gains the ladder's device classes and
   the iOS-26 force-WASM rule.
5. No step ships without the real-audio gate passing on the Pages artifact.
