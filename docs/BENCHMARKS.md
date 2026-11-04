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

## Not yet measured

- Peak JS heap / WASM memory during inference (needs `performance.measureUserAgentSpecificMemory`
  or DevTools on real hardware).
- Long-text multi-chunk throughput and cancellation latency.
- MP3 encode time in-browser.
- Battery impact on mobile (untested — no mobile runs).
- First-load page weight (JS bundle size — see build output).
