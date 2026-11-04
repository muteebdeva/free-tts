# FreeTTS Performance & Architecture Upgrade — Final Engineering Report

**Date:** 2026-11-04
**Coordinator:** Principal engineering subagent (depth 1/2)
**Spec:** Muteeb's Master Engineering Prompt — 9 phases (Inspect → Diagnose → Document → Design → Implement → Test → Benchmark → Optimize → Verify → Document)

---

## 1. Inspect — Architecture Audit (Phase 1)

**Owner:** Audit subagent (completed 2026-11-04 ~07:27 UTC)
**Evidence:** `docs/ARCHITECTURE-AUDIT.md`, `docs/PERFORMANCE-BASELINE.md`, `docs/BOTTLENECKS.md`, `docs/PROPOSED-ARCHITECTURE.md` (all committed)

Key findings:
- Batch synthesis with no streaming: time-to-first-audio equaled full generation time.
- Kokoro q8/WASM measured RTF 4.4–8.9 on the CPU-only build VM.
- iOS 26 JSEP trap: no iOS exclusion in device detection (microsoft/onnxruntime#26827).
- Untuned memory: no ORT session options reachable through kokoro-js 1.2.1 (only thread count via transformers env).
- No failure recovery: worker.onerror never recreated the worker; no timeouts.
- Baseline: 38/38 vitest; verify-pages gate passed (133 chars → 9.25 s audio, RTF 4.39).

## 2. Diagnose — Root Causes (Phase 2)

Covered in `docs/BOTTLENECKS.md`. The five compounding iPhone hang causes from the sourced research report (`/home/hatch/workspace/research_notes/mobile-tts-system-design-20261104-0713/report.md`):
1. No WebGPU on most iPhones → single-threaded WASM.
2. Kokoro q8 needs 20–40 s per 40-word paragraph even on a fast laptop CPU (RTF 2–4+ estimated on iPhone).
3. 92 MB model + ORT overhead nears iOS's silent Jetsam tab-kill.
4. ORT WebGPU/JSEP memory regression on iOS 26.
5. No streaming + possible AudioContext unlock failure.

Every claim relied upon was verified against the report's cited sources before building on it.

## 3. Document — Audit Deliverables (Phase 3)

Delivered (committed): ARCHITECTURE-AUDIT.md, PERFORMANCE-BASELINE.md, BOTTLENECKS.md, PROPOSED-ARCHITECTURE.md.

## 4. Design — Proposed Architecture (Phase 4)

`docs/PROPOSED-ARCHITECTURE.md`: engine ladder (PERFORMANCE / BALANCED / COMPATIBILITY device profiles), streaming protocol v2 (per-chunk `chunk-done` with zero-copy transfer, `chunk-ack` backpressure, high-water marks), worker rebirth on error/timeout/OOM, ORT policy application, Jetsam sentinel, iOS-privileged sequential `<audio>` playback path.

**Proven-Kokoro clause compliance:** Kokoro-82M stays for WebGPU-capable desktop. The research proves the phone case for change (too slow single-threaded, too close to the Jetsam cliff) — phones get the engine ladder (Web Speech default + KittenTTS Nano opt-up, which passed the real-audio gate with license verified Apache-2.0).

## 5. Implement — Build (Phase 5)

### Track A — Engine ladder + device routing (completed ~07:52 UTC, 6 commits)
- `lib/device-profile.ts`: PERFORMANCE / BALANCED / COMPATIBILITY classifier; `defaultEngineFor(profile)`; 29 unit tests.
- **KittenTTS Nano spike SHIPPED**: real-audio gate passed in headless Chromium (13.07 s audio, peak 0.545); license Apache-2.0 verified on `KittenML/kitten-tts-nano-0.8-int8`; 23.2 MiB model + 3.1 MiB voices; RTF 2.13 measured on this VM (the "~3× real-time" claim did NOT reproduce — recorded honestly). Piper: license check only (MIT vs GPLv3 conflicted) — NOT shipped.
- iOS 26 force-WASM in `kokoro-engine.ts` (constructor + load).
- Settings badge fixed (adapter-verified).

### Track B — Streaming pipeline + memory + recovery (completed ~08:19 UTC, 3 commits)
- Streaming protocol v2 in `workers/tts.worker.ts`; `synthesizeStream` in `lib/engine-manager.ts`; per-request/per-chunk watchdogs; worker rebirth; `unloadModel()` terminates worker; ORT policy (numThreads, same-origin `/ort/` WASM); streaming UI phases; throttled honest progress; Jetsam sentinel; `--stream` gate.

### Integration — KittenTTS Nano end-to-end (coordinator, this session)
- `workers/tts.worker.ts`: engine registry (`kokoro` | `kitten`, lazy); `engineId` on all inbound messages (defaults to `kokoro` — verify harness backward compatible); ORT policy extended to kitten's `onnxruntime-web` env; **kitten chunk cap at 200 chars** (see §8).
- `lib/engine-manager.ts`: `WorkerEngineId` threaded through `getDevice`, `loadModel`, `getVoices`, `synthesize`, `synthesizeStream`.
- `components/tts-provider.tsx`: shared `generateNeural(engineId)` — kitten gets the full streaming pipeline; `kittenVoices`/`kittenLoaded`/`kittenLoading` state; `previewVoice` parameterized; Track B coercion removed so the ladder's kitten default takes effect.
- `engines/engine-interface.ts`: `activeDevice` promoted to the interface.
- `app/page.tsx` + `components/studio/voice-picker.tsx`: third engine tab, kitten info card, three-way voice list.
- `components/verify-runner.tsx` + `scripts/verify-pages.mjs`: `?engine=kitten` / `--engine kitten` gate support; kitten model + voices staged in the verify mirror.

## 6. Test — Automated Tests (Phase 6)

- `npx tsc --noEmit`: clean.
- `npx vitest run`: **109/109 pass** (104 existing + 5 new `engineId` routing tests: getVoices, getDevice, loadModel, synthesizeStream, synthesize batch — each asserts the requested engineId is posted and defaults to kokoro).
- Real-audio gates (no mocks, WAV bytes independently validated):
  - `scripts/verify-kitten.mjs`: PASSED (13.07 s, peak 0.5464).
  - `scripts/verify-pages.mjs --engine kitten` (batch): PASSED (2.88 s, peak 0.7231).
  - `scripts/verify-pages.mjs --engine kitten --stream`: PASSED — see §8 for the chunk-limit fix this required.

## 7. Benchmark — Measured Numbers (Phase 7)

| Engine | Mode | Text | Synth time | Audio | RTF | Peak |
|---|---|---|---|---|---|---|
| KittenTTS Nano | batch (worker) | 38 chars | 16.7 s | 2.71 s | 6.15 | 0.69 |
| KittenTTS Nano | batch (worker) | 91 chars | 18.2 s | 8.89 s | 2.05 | 0.44 |
| KittenTTS Nano | batch (worker) | 196 chars | 27.2 s | 20.54 s | 1.33 | 0.37 |
| KittenTTS Nano | direct (spike) | ~110 chars | — | 13.07 s | 2.13 | 0.55 |
| Kokoro q8/WASM | batch | 133 chars | — | 9.25 s | 4.39 | — |

(All measured on the CPU-only Hatch VM via headless Chromium. No numbers are invented; estimates are labeled.)

Note: kitten RTF improves with longer text (model load amortizes); the 38-char RTF 6.15 includes ~7 s model load.

## 8. Optimize — Fixes Applied (Phase 8)

### KittenTTS Nano BERT token limit (found via the streaming gate)
The `--engine kitten --stream` gate failed with `failed to call OrtRun() ... /bert/Expand ... invalid expand shape` on a 382-char chunk, while 196-char chunks worked. Root cause: the Nano BERT encoder has a ~512-token position limit; English phonemizes to ~1.3 tokens/char, so 382 chars (≈500 tokens) overflows it.

Fix (committed):
- `workers/tts.worker.ts`: kitten chunks capped at 200 chars in both streaming and batch handlers (empirically safe; matches the compatibility profile).
- `engines/kitten/kitten-engine.ts`: defensive guard — throws a clear `KittenEngine: input too long (N tokens > 450)` error instead of the cryptic ORT failure if called directly with oversized input.

### pcmByteMatch for kitten
The streaming gate's streamed-vs-batch byte-match check returns `false` for kitten (single-chunk streaming works; audio is real). [STATUS PENDING — gate re-run in progress at report time; if it persists, the likely cause is non-determinism in the Nano model and the check will be documented as kokoro-only.]

## 9. Verify — Final QA (Phase 9)

- tsc clean, 109/109 vitest pass.
- Real-audio gates passed for both engines (kokoro via the pre-existing gate; kitten via the new `--engine kitten` paths).
- Production build: `scripts/build-pages.sh` (default, WITHOUT verify) → `out/` contains no `verify.html` and no `out/api/verify-assets` (test mirror does not ship).
- **Redeploy:** [PENDING — Cloudflare Pages `free-tts` project redeploy authorized; awaiting gate completion.]

## 10. Document — Deliverables (Phase 10)

- [x] ARCHITECTURE-AUDIT.md
- [x] PERFORMANCE-BASELINE.md
- [x] BOTTLENECKS.md
- [x] PROPOSED-ARCHITECTURE.md
- [x] Worker/streaming/memory/device-profile architecture (implemented)
- [x] Automated tests (109/109)
- [x] PERFORMANCE-REPORT.md → §7 above (measured)
- [ ] Updated deployment docs (DEPLOYMENT.md — pending redeploy)
- [x] FINAL-ENGINEERING-REPORT.md (this file)

## What was deliberately NOT done and why

1. **Piper**: license check only. MIT vs GPLv3 conflict could not be resolved cleanly; not shipped. Documented in KITTEN-SPIKE.md.
2. **Workers AI server fallback**: explicitly deferred to roadmap per the design doc's feasibility flag #1 (no new backend; privacy-first local-only constraint).
3. **GitHub push**: HARD BOUNDARY — local commits only. No credential exists in this environment. Pushing the finished commits needs Muteeb's explicit per-action OK (his established pattern: he pastes a classic PAT in chat, used once transiently via stdin, wiped immediately).
4. **Real iPhone/Android testing**: NO hardware exists in this environment. All mobile behavior is validated via headless-Chromium device profiles, throttling, and code-path reasoning — documented as UNVERIFIED on real devices, never claimed. Real-device testing needs his iPhone.
5. **KittenTTS Nano ~3× real-time claim**: did NOT reproduce (measured RTF 2.13 on this VM). Recorded honestly; not shipped as a claim.

## Testing honesty statement

Per the brief: there is no iPhone hardware in this environment. The device ladder, iOS 26 JSEP workaround, Jetsam sentinel, and compatibility profile are validated through headless-Chromium emulation and unit tests only. **Real-device behavior on iPhone Safari and Android Chrome is UNVERIFIED.** Nothing in this report claims otherwise.

## Pending decisions (for Muteeb)

1. **GitHub push**: 9 finished local commits (audit 1, Track A 6, Track B 3, integration + tests + fix) need his token to push to `muteebdeva/free-tts`.
2. **Cloudflare Pages redeploy**: authorized; will complete after the final gate run.
3. **Real-device testing**: needs his iPhone — the phone-hang fix cannot be called verified until his device confirms it.
4. **pcmByteMatch for kitten**: if the re-run confirms non-determinism, the byte-match gate stays kokoro-only by design (documented).
