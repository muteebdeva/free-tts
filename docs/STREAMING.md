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

Gapless streaming playback via the Web Audio API (`audio/gapless-player.ts`).

Each chunk's raw PCM is trimmed of edge silence (the same `trimSilence`
policy as the download stitcher) and scheduled as an `AudioBufferSourceNode`
with a precise start time derived from accumulated chunk durations — chunk
N+1 begins exactly where chunk N ends, so zero silence is inserted between
sentences. Consecutive chunks overlap by an 8 ms equal-power crossfade
(identical curves to `concatChunks`), which de-clicks the joints. The result
sounds like the stitched WAV download.

Time-to-first-audio is still time-to-first-chunk: the first chunk is
scheduled at the audio clock's current time the moment it arrives. A chunk
that arrives late (generation slower than playback) simply starts ASAP —
the only gap possible is audio that does not exist yet.

**iOS unlock.** The `AudioContext` is created and `resume()`d synchronously
inside the Generate button's tap gesture (`TTSProvider.generate`) — iOS
Safari will not unlock it if creation is deferred. A one-time `pointerdown`
backup re-resumes if the first attempt raced.

**iOS audio session (whisper-quiet fix, 2026-11-04).** iOS routes Web Audio
through the "ambient" session (muted by the silent switch) while `<audio>`
elements use the "playback" session (ignores the switch) — hence "loud on
the old path, whisper-quiet on Web Audio" with correct gains throughout.
`unlock()` now promotes the session in the gesture: `navigator.audioSession`
`.type = "playback"` (iOS 17+) plus a one-time silent-`<audio>` kick (older
iOS). Verified by unit test (session type set, kick played once).

**Unlock verification.** `unlock()` returning true only means "a context
exists" — iOS may still keep it suspended. `generate()` now awaits
`player.ensureUnlocked()` before committing to the Web Audio path; false
falls back to the legacy `<audio>` path (audible; the stream still
completes, so the download is built). Scheduling into a suspended context
is never attempted: besides silence, the chunk-end callbacks would never
fire and the backpressure acks would stall the stream.

**Audio-blocked UX.** If the context still isn't running ~2 s after the
first schedule (gapless path), or the legacy path's first `play()` is
refused, an "Audio is blocked — tap to enable sound" banner appears with a
tap-to-retry button (`unblockAudio`), which re-kicks resume/play inside the
tap gesture iOS requires. Never silent failure without explanation.

**Fallback.** If Web Audio is unavailable (`unlock()` false), the legacy
ping-pong `<audio>` path is used: per-chunk WAV blob URLs played
sequentially with preload of the next chunk. It has small inter-chunk gaps
(element swap + decode) but is always audible — never silence. Each played
chunk is acked in both paths (backpressure); the stream ends when the last
scheduled chunk finishes (`endedChunks == totalChunks`).

Supersedes the old documented limitation: gapless playback was previously
out of scope (feasibility flag #6); the `<audio>`-only constraint is gone.

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
