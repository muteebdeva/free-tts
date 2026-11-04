# KittenTTS Nano spike — verdict: SHIP

**Date:** 2026-11-04 · **Status:** all three ship-blockers PASS — integrated as `engines/kitten/`.

Time-boxed evaluation of KittenTTS Nano as the light neural opt-up for the
device ladder (PROPOSED-ARCHITECTURE.md §(a)). Every claim below was measured,
not quoted.

## Blocker (i) — real-audio gate: PASS

`scripts/verify-kitten.mjs` (self-bootstrapping: downloads model + voices.npz
from HuggingFace on first run, ORT WASM + phonemizer from node_modules, serves
all same-origin, synthesizes in headless Chromium, re-validates WAV bytes in
Node — no mocks anywhere).

- **PASS 2026-11-04**, headless Chromium, onnxruntime-web WASM EP (4 threads):
  13.07 s of 24 kHz mono 16-bit audio from a 121-char sentence; peak 0.545,
  non-silent fraction 0.48; per-second energy envelope varies like natural
  speech (pauses between sentences, bursts on content words).
- Robustness run **PASS**: `"Hello! Call 911 now — the price is $42.50
  (fifty percent off). Café naïve résumé… done?"` → espeak expanded
  911 → "nine hundred eleven", $42.50 → "dollar forty two point five zero",
  handled accented Latin chars; 14.82 s audio, no crash.
- Evidence: `docs/evidence/kitten-verify.wav`, `docs/evidence/kitten-verify.json`.

The in-page pipeline replicates the official KittenML v0.8 inference
(`kittentts_legacy/onnx_model.py`): espeak-ng phonemize (`en-us`, via the
`phonemizer` npm package) → `basic_english_tokenize` (`\w+|[^\w\s]`, unicode)
→ char-level TextCleaner vocab → `[0, …ids, 10, 0]` framing →
`style = voices[voice][min(len(text), 399)]` → ONNX session
(`input_ids` int64, `style` float32[1,256], `speed` float32[1]) →
output `waveform` trimmed by the official last-5000-samples cut.
The vocab is extracted programmatically from the official source
(`scripts/kitten-vocab.json`, provenance noted inside) — never hand-copied.
Deliberate deviation: the official 1384-line `TextPreprocessor`
(number/currency/roman expansion) is NOT ported — gate run 2 proves
espeak-ng's own text analysis already expands numbers and currency, so the
port would add weight for no verified gain.

## Blocker (ii) — license: PASS (verified against the exact distribution)

- Weights: `KittenML/kitten-tts-nano-0.8-int8` on HuggingFace is tagged
  `license:apache-2.0` (verified via the HF API on the exact repo downloaded;
  siblings: `kitten_tts_nano_v0_8.onnx`, `voices.npz`, `config.json`).
- Code: `KittenML/KittenTTS` on GitHub carries an Apache-2.0 LICENSE
  (verified from the repo). The v0.8 legacy ONNX path is what we use —
  **not** KittenTTS 2, whose weights are under the non-open-source
  "Stellon Labs Community License" (per the 2026-10-19 andrew.ooo review).
- espeak-ng (GPL-3.0): bundled inside `phonemizer@1.2.1` (xenova), which is
  **already** a dependency of this app via kokoro-js and already documented
  in `THIRD-PARTY-NOTICES.md`. No new license burden; the app is
  GPL-3.0-or-later, so GPL-3.0 bundling is compatible.
- The `phonemizer` npm package itself declares Apache-2.0.

## Blocker (iii) — size/speed re-measured: PASS (honest numbers)

| Asset | Measured | Claimed |
|---|---|---|
| `kitten_tts_nano_v0_8.onnx` (int8) | **24,369,971 B = 23.2 MiB** | ~25 MB ✓ |
| `voices.npz` (8 voices × 400×256 float32) | **3,278,902 B = 3.1 MiB** | not quoted |
| phonemizer bundle (espeak-ng WASM) | 1.3 MB (already in app via kokoro-js) | — |
| Load (model + session, this VM) | 5.9–7.5 s | — |
| Synthesis, 121 chars → 13.07 s audio | 27.8 s → **realtime factor 2.13×** (0.47× RT) | "~3× real-time" ✗ |

The "~3× real-time" claim circulating in secondary sources does **not**
reproduce here: on this CPU-only VM (4 WASM threads) KittenTTS Nano int8 is
about **2.1× slower than real time**. Still dramatically cheaper than
Kokoro-82M q8 (92 MB) for the mobile ladder rung, but the honest number is
recorded, not the marketing one. Phone CPUs will differ — unmeasured.

## Piper: license check only — NOT shipped

Per the task brief: Piper's license is conflicted across 2026 sources
(MIT claimed in some places, GPLv3 in others — see
`docs/research/piper-research.md`). Flagged, not resolved, not shipped.
No integration attempted.

## Integration

`engines/kitten/` implements `TTSEngine` on the gated pipeline above.
Voice embeddings are fetched as the official `voices.npz` (3.1 MB, cached)
and the selected voice's 400×256 rows are extracted in-worker with a minimal
STORED-entry zip reader (`engines/kitten/voices.ts`; the npz uses
ZIP64-style local headers, so sizes come from the central directory —
`scripts/kitten-npz.mjs` is the Node twin used by the gate).
Default voice: Bella (`expr-voice-2-f`).
