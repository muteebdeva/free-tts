# FreeTTS — Performance Benchmarks

**Date:** 2026-11-04 · **Method:** `scripts/verify-audio.mjs` (real headless-Chromium
run; evidence in `docs/evidence/freetts-verify.json`). All numbers below are
measured, not estimated. Do not cite them as representative of user hardware —
see the environment note.

## Environment (this machine)

- Linux VM, Intel Xeon CPU (shared), **no GPU**
- Chromium headless-shell 156 (Playwright), SwiftShader software GL
- Inference device selected by the app: **`wasm`** (no WebGPU adapter present)
- Model: Kokoro-82M **q8** (`model_quantized.onnx`, 92,361,116 bytes) + voice
  `af_heart` (522,240 bytes), served from a same-origin test mirror
- Network for model bytes: localhost (production would be HuggingFace CDN)

## Measured results

| Metric | Value |
|---|---|
| Model load (download + init + voice), cold | **12.3 s** (localhost mirror; production CDN will be slower) |
| Synthesis (dev build): 135 chars → 9.17 s audio | **63.8 s** → RTF 6.96 (≈ 0.14×) |
| Synthesis (prod build): 68 chars → 4.24 s audio | **20.2 s** → RTF 4.77 (≈ 0.21×) |

(Both runs are CPU-only WASM. The prod webpack bundle synthesizes faster than
the dev/Turbopack bundle; the runs also differ in text length.)
| Time to first audio | not measured separately (single 9.17 s chunk; streaming not used in v1) |
| Peak memory | not measured (no reliable headless API; see below) |
| WAV encode (220,131 samples → 16-bit PCM) | < 100 ms (in-page, negligible) |
| MP3 encode (lamejs, 128 kbps) | unit-tested only; browser timing not measured |

## What this means (honest reading)

- On a **CPU-only** device, Kokoro/q8/WASM synthesizes ~7× slower than real
  time. A 60-second narration takes ~7 minutes. This matches the published
  expectation that WASM-only Kokoro is sub-realtime (Verso measured 0.7× on a
  laptop CPU with GPU-less fallback; this VM's shared Xeon is slower still).
- The app therefore **tells CPU-only users the truth**: the Studio shows
  "slower than real time — long texts take a while" and offers instant system
  voices as an alternative. No fake progress, no silent stalls.

## KittenTTS Nano (2026-11-04) — REMOVED

> **Removed at the user's request on 2026-11-04** ("Remove kitten I don't
> want this model"). The engine, its UI tab, worker registry entries, tests,
> and verify scripts were removed from the codebase. The numbers below are
> the historical measured results, kept for the record. Evidence files stay
> in `docs/evidence/` (kitten-verify.{wav,json}).

**Method:** `scripts/verify-kitten.mjs` (REMOVED with the engine; real
headless-Chromium run; evidence `docs/evidence/kitten-verify.json`). Same VM
as above.

| Metric | Value |
|---|---|
| Model load (24.4 MB ONNX + 3.3 MB voices.npz + session, localhost) | **5.9–7.5 s** |
| Phonemization (espeak-ng, in-page) | **1.2–1.3 s** per sentence |
| Synthesis: 121 chars → 13.07 s audio | **27.8 s** → RTF 2.13 (≈ 0.47×) |

Honest comparison on this VM: KittenTTS Nano int8 (RTF 2.13) synthesizes
**~2.2–3.3× faster than Kokoro-82M q8** (RTF 4.77–6.96) while downloading
~3.4× fewer bytes (27 MB vs 92 MB). It is still ~2.1× slower than real time
here — the "~3× real-time" claim in secondary sources did not reproduce.
Quality is below Kokoro-82M (15M vs 82M parameters); the trade is size and
speed for the mobile ladder rung. Phone CPUs unmeasured.
- On **WebGPU hardware**, third-party measurements (Verso, Sept 2026) report
  **4.3× real-time** with 1.2 s to first audio for Kokoro fp32. We have not
  reproduced this here (no GPU on this VM) — it is cited, not claimed.

## How to reproduce

```bash
node scripts/verify-audio.mjs
# → /tmp/freetts-verify.json (timings) + /tmp/freetts-verify.wav (audio)
```

Vary `--text` / `--voice` for other inputs. For a WebGPU measurement, run the
same script on a machine with a GPU and Chromium WebGPU enabled; record the
device string reported in the JSON (`"device": "webgpu"`).

## Streaming (protocol v2) — measured 2026-11-04

**Method:** `node scripts/verify-pages.mjs --stream` (real headless-Chromium
run against the with-verify Pages artifact; evidence in
`docs/evidence/freetts-verify-pages.json`). Profile: **compatibility**
(200-char chunks, 1 ORT thread, same-origin-intent WASM policy), voice
`af_heart`, 474-char / 5-sentence text → 3 chunks. Environment: same VM as
above (no GPU, wasm EP).

| Metric | Run 1 | Run 2 |
|---|---|---|
| Time to first chunk (time-to-first-audio) | **62.0 s** | **46.9 s** |
| Full profile-chunked stream (3 chunks, 27.1 s audio) | **158.1 s** → RTF 5.83 (≈ 0.17×) | **110.3 s** → RTF 4.07 (≈ 0.25×) |
| First-chunk / full-stream ratio | 0.39 | 0.43 |
| Streamed PCM vs batch PCM (identical 400-char chunking) | **byte-identical** | **byte-identical** |
| ORT binary fetched | `ort-wasm-simd-threaded.jsep.wasm` | same |
| Non-JSEP `ort-wasm-simd-threaded.wasm` fetched | **no** | **no** |
| Model load with 1-thread policy | 14.1 s | 12.3 s |

(The vendored ORT 1.22.0 wasm backend always requests the jsep-named file,
even on the pure-WASM path; the non-JSEP pair is shipped under `public/ort/`
for forward-compat and the gate asserts it is *not* requested. Run-to-run
variance is the shared VM's CPU contention.)

**Honest reading:** on this CPU-only VM, streaming cuts perceived wait from
"full ~110–158 s before any sound" to "~47–62 s to first audio" — the rest
generates while the user is already listening. RTF is unchanged by streaming
(same inference); the win is entirely time-to-first-audio plus bounded
memory (no batch PCM accumulation). The 1-thread compatibility policy costs
~12% throughput here (0.333 vs 0.297 s/char against the multi-thread
baseline) — the intended trade on iOS, where WASM threads serialize in
practice.

iOS rows remain ESTIMATED until device testing exists (no iPhone runs).

## Not yet measured

- Peak JS heap / WASM memory during inference (needs `performance.measureUserAgentSpecificMemory`
  or DevTools on real hardware).
- Long-text multi-chunk throughput and cancellation latency.
- MP3 encode time in-browser.
- Battery impact on mobile (untested — no mobile runs).
- First-load page weight (JS bundle size — see build output).
- Inter-chunk playback gap duration with sequential `<audio>` (documented
  as acceptable; not yet timed).
