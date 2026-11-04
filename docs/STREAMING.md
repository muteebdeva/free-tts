# FreeTTS — Streaming synthesis (protocol v2)

**Date:** 2026-11-04 · **Status:** implemented (Track B).

Replaces batch synthesis for the Studio path. Time-to-first-audio is now
time-to-first-chunk (~one sentence inference instead of the whole text).

## Protocol (worker ↔ engine-manager)

`workers/tts.worker.ts` → main thread, per sentence-chunk, immediately after
inference:

- `chunk-done { requestId, index, total, sampleRate, samples }` — the
  `Float32Array` is **transferred** (zero-copy; the worker's buffer detaches).
- `synth-progress { requestId, done, total }` — per chunk (liveness).
- `synth-done { requestId, sampleRate, chunkCount }` — terminal, no samples.

Main thread → worker:

- `chunk-ack { requestId }` — exactly one per consumed chunk (see below).
- `cancel { requestId }`, `synthesize-stream { requestId, text, voiceId,
  speed, chunkChars, highWater }`.

The old batch `synthesize` message is retained for the verify harness's
streamed-vs-batch byte-match regression test.

## Backpressure

The worker counts `unacked` (chunk-done posted − chunk-ack received). Before
synthesizing each chunk it pauses while `unacked >= highWater` (per profile:
4 / 3 / 2) and resumes when acks arrive. Implementation is an ack-waiter list
in the worker's `onmessage` — no `SharedArrayBuffer`.

The main thread acks a chunk when it is **consumed**: handed to an `<audio>`
element for playback, or discarded on Stop/teardown. The provider-side queue
(`lib/stream-queue.ts`) is bounded by the same high-water mark, so a fast
device can't race ahead generating audio the user may never hear.

## Playback

Sequential `<audio>` elements (the iOS-privileged path — zero `AudioContext`
references in the codebase, unchanged). Two elements ping-pong: while chunk
*i* plays, chunk *i+1* is preloaded (`preload="auto"` + `.load()`) on the
idle element. Each played chunk's blob URL is revoked after `ended` (or on
decode error, which is treated like `ended` so one bad chunk can't stall the
queue). Each consumed chunk is acked.

**Documented limitation — inter-chunk gaps.** Sequential `<audio>` playback
has small gaps between chunks (element swap + decode). WAV is not
MSE-streamable and AAC-via-WebCodecs would be a project of its own, so
gapless playback is explicitly out of scope (design doc feasibility flag
#6). The gaps are disclosed in the Studio UI ("Small gaps between sentences
are normal").

## Cancellation / Stop

- **Stop during streaming** (the Generate button becomes Stop): the worker
  halts, playback silences, queued chunk URLs are revoked (acked), but the
  retained PCM is kept → phase `ready-partial`, playable and exportable.
- **Cancel during loading/synthesizing** (before first audio): all-or-nothing
  → `idle`, as before.
- Late chunks arriving after Stop are retained for export but never queued
  for playback.

## Watchdogs (no silent hangs)

- **Per-chunk stall** (`EngineManager`, default 240 s — worst plausible
  single chunk on sub-realtime WASM): no `chunk-done`/`synth-progress` for
  N s → worker rebirth + clear error ("stalled … try again or switch to
  system voices"). Suspended while the worker is paused by *our*
  backpressure (`unacked >= highWater`); the next `ack()` re-arms it.
- **Per-request** (`call()`, default 5 min; load 15 min; batch synth derived
  from text length): re-armed by every progress event → same rebirth + clear
  error.
- **Worker rebirth**: `worker.onerror`, any watchdog timeout, or any
  non-abort engine error → `terminate()`, drop the reference, reject
  in-flight jobs loudly. The next call transparently recreates the worker
  via the existing lazy `ensureWorker()`. Abort (user cancel) never rebirths.

## Memory

- ORT thread policy is applied in the worker **before** session creation
  (`env.backends.onnx.wasm.numThreads`; COMPATIBILITY → 1). The vendored
  default only applies when the value is unset, so an explicit set sticks.
- `env.wasmPaths` → `/ort/` (shipped same-origin binaries) when the profile
  selects `same-origin` (COMPATIBILITY). Measured (verify gate asserts):
  the vendored ORT 1.22.0 wasm backend **always** fetches
  `ort-wasm-simd-threaded.jsep.*`, even on the pure-WASM path — the non-JSEP
  files are shipped for forward-compat and asserted *not* fetched.
- **Arena / mem-pattern / tensor disposal: NOT reachable.** ORT web reads
  `enableCpuMemArena`/`enableMemPattern` from per-session options and
  transformers.js v3 forwards `session_options` from `from_pretrained` —
  but kokoro-js 1.2.1's `from_pretrained` destructures only
  `{dtype, device, progress_callback}`, dropping everything else.
  Compensations (all implemented): 1-thread policy on COMPATIBILITY,
  smaller chunks (200 chars), worker terminate+recreate as the memory reset
  (`unloadModel()`), blob-URL revocation everywhere, per-chunk transfers
  (no batch PCM accumulation). Revisit if kokoro-js exposes session options.
- The per-chunk `audio.audio.slice()` copy in kokoro-engine.ts is **kept**
  (not removed): engines/ is out of scope for this track, and the copy is
  the safe choice under streaming.

## Jetsam sentinel

`sessionStorage` flag set on Generate, cleared on every clean completion
(ready / error / cancel / unload). A stale flag on page load → one-time
notice: "The last session was interrupted — your device may be low on
memory. System voices are the safest choice here." (On iOS a jetsam kill
may clear sessionStorage on tab restore — then the notice simply doesn't
appear; absence never claims anything.)

## Verification

- `npx vitest run` — queue/backpressure state machine (mocked worker),
  throttle, watchdog/recovery (fake dying worker), sentinel, classifier.
- `node scripts/verify-pages.mjs --stream` — first chunk-done well before
  synth-done, streamed PCM byte-matches batch PCM (identical 400-char
  chunking control), fetched ORT binary name asserted per profile.
- Numbers: docs/BENCHMARKS.md (streaming table).
