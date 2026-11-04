# FreeTTS — Model Research

**Date:** 2026-11-04 · **Status:** decision made (see §8) · **Method:** web research across
three parallel tracks (Kokoro, Piper, alternatives), all sources accessed 2026-11-04.
Full per-track reports are archived in the repo under `docs/research/`.

**Project constraints framing every verdict below:** 100% in-browser inference
(no paid APIs, no accounts), zero budget, privacy-first (no text leaves the device),
must run on consumer hardware, open-source weights with redistributable licenses.
Benchmarks and capabilities are cited with sources; where no measurement exists,
that is stated explicitly. Nothing in this document is invented.

---

## 1. Kokoro-82M (hexgrad) — ✅ CHOSEN as primary engine

### 1.1 Model description
- **Kokoro-82M v1.0** by hexgrad, released 2025-01-27; still current as of Nov 2026
  (https://huggingface.co/hexgrad/Kokoro-82M).
- Architecture: StyleTTS2-derived, decoder-only (no diffusion, no encoder), **ISTFTNet
  vocoder** inside the same ONNX graph. 82M parameters. Output: **24 kHz mono PCM**.
  Phoneme input space: 178-symbol IPA vocabulary.
- Sources: model card; https://localaimaster.com/blog/kokoro-tts-local-setup

### 1.2 Naturalness / pronunciation quality
- No peer-reviewed MOS study exists. Public evidence:
  - **#1 on the TTS Spaces Arena leaderboard at launch (v0.19)** — blind human votes,
    beating models 10–100× its size (XTTS 467M, MetaVoice 1.2B reported).
  - **2026 arena standing:** TTS Arena V2 ~32nd overall, Elo **1056.2**, 54.4% win rate
    over 5,368 appearances (NeoVand/voicebook, Jul 2026); Artificial Analysis Speech
    Arena Elo ~1060 — below server-only leaders (ElevenLabs v3 ~1178, Fish Audio S2
    Pro ~1110). Community consensus: top *browser-native* option, best
    quality-per-MB for English narration.
  - Community caveats (multiple 2026 sources): flat emotional range, **no voice
    cloning** (fixed preset voices only), weaker non-English quality than English.
- Sources: https://github.com/neovand/voicebook/blob/HEAD/references/TTS_models_Claude_Deep_Research.md

### 1.3 Language coverage (verified)
Upstream Kokoro supports **8 languages / 54 voices**. Voice ID = `[lang][gender]_[name]`
(e.g. `af_heart` = American Female "Heart"). Language codes: `a` US-English,
`b` UK-English, `e` Spanish, `f` French, `h` Hindi, `i` Italian, `j` Japanese,
`p` Brazilian Portuguese, `z` Mandarin. Upstream voice grades (VOICES.md):
af_heart **A**, af_bella **A-**, bf_emma **B-** are the best English voices; most
others C/D.

**Critical browser caveat:** `kokoro-js` 1.2.1 (the browser package) is effectively
**English-only** — it hardcodes a 28-voice English `VOICES` map (`_validate_voice`
throws on others) and its `phonemize()` hardcodes espeak to `en-us`/`en`. The
bundled eSpeak-NG WASM ships **English language data only** (open PR
hexgrad/kokoro#262 to recompile with all languages is unmerged; sokuji issue #134,
Mar 2026). Multilingual browser use requires custom G2P glue via
`generate_from_ids` (pattern demonstrated by ai-ecoverse/slicc PR #1170, June 2026:
es/fr/it/hi/pt via own espeak-ng WASM). Japanese/Chinese have no JS G2P port at all
(upstream uses jieba+pinyin/openjtalk in Python).

**FreeTTS consequence:** the shipped app is honestly **English-only** until the
multilingual G2P spike (roadmap §9) is implemented and verified. The UI and docs
must not advertise other languages.

### 1.4 Model size (measured from HuggingFace, 2026-11-04)
Hosted at `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX`:

| File | Type | Size (bytes, via HEAD) |
|---|---|---|
| `onnx/model.onnx` | fp32 | 325,532,232 (~310 MiB) |
| `onnx/model_fp16.onnx` | fp16 | ~163 MB (repo README table) |
| `onnx/model_quantized.onnx` | int8 | ~92.4 MB (repo README table) |
| `onnx/model_q8f16.onnx` | int8/fp16 mixed | 86,033,585 (~82 MiB) |
| `onnx/model_uint8.onnx` | uint8 | 177,464,632 (~169 MiB) |
| `onnx/model_uint8f16.onnx` | uint8/fp16 | ~114 MB (repo README table) |
| `onnx/model_q4f16.onnx` | 4-bit matmul + fp16 | ~154 MB (repo README table) |
| `onnx/model_q4.onnx` | 4-bit | 305,215,966 (~291 MiB) — note: name is misleading; this is NOT the smallest file |

Voice embeddings: each voice is a 510×256 fp32 style tensor, **522,240 bytes**
(measured `voices/af_heart.bin`, 2026-11-04). Full 54-voice pack `voices-v1.0.bin`
~25–28 MB (third-party mirror listing).

### 1.5 Memory requirements
No published in-browser memory measurement exists — marked **unknown, must be
benchmarked** (see `docs/BENCHMARKS.md`). Indirect data: fp32 weights 326 MB on
disk; a server GPU instance (Kokoro-FastAPI, PyTorch+CUDA) measured 2.37–3.98 GB
resident VRAM per instance *including* PyTorch/CUDA context (https://nexgpu.net/en/models/kokoro/).
kokoro-js package itself ~30 MB unpacked (includes ORT WASM binaries).

### 1.6 Browser compatibility — VERIFIED YES (full pipeline runs client-side)
**kokoro-js** (npm, https://github.com/hexgrad/kokoro/tree/main/kokoro.js) runs the
complete pipeline in-browser: text → JS `normalize_text` → **espeak-ng WASM
phonemization** (`phonemizer` npm package) → phoneme IDs → **ONNX acoustic model via
onnxruntime-web** → 24 kHz PCM. Execution providers: `"wasm"` | `"webgpu"` (web),
`"cpu"` (Node). Built on `@huggingface/transformers` + onnxruntime-web.
- WebGPU confirmed working (runonweb.ai tests with Transformers.js 4.2; Verso
  measured 4.3× realtime — see §1.7).
- WASM fallback confirmed but slow (Verso: 0.7× realtime; streaming stutters).
  WASM threaded build needs COOP/COEP headers (SharedArrayBuffer).

### 1.7 CPU/GPU inference speed (real reported numbers only)
| Source | Setup | Result |
|---|---|---|
| Verso (measured Sept 2026) | browser, WebGPU fp32 | **4.3× realtime, 1.2 s to first audio** |
| Verso (same) | browser, WASM q8 fallback (GPU-less) | **0.7× realtime** — streaming stutters/stops |
| korvid research doc (2026-08-20) | M1 CPU, ONNX | fp32 ~1.2 s/utterance, fp16 ~1.0 s, q8 ~0.8 s |
| script-glow (2026-09-19) | onnxruntime-node, fp32 incl. G2P | 0.46 s/line |
| pet-talk (2026-09-12) | Python kokoro-local, MacBook under load | RTF 0.065–0.183 |

### 1.8 Quantization
Variants published: fp16, int8 (`model_quantized`), q8f16, uint8, uint8f16, q4, q4f16.
No quantitative quality comparison between quants was found; community claim is
"resilient to quantization" (unverified — do not cite as fact). kokoro-js README:
**fp32 recommended with WebGPU**; q8/q4 to shrink download and speed WASM. Known
issue: **fp16 produced silent audio on CPU** in one 2026 spike (script-glow) —
verify before using fp16.

### 1.9 License — ⚠️ READ CAREFULLY
| Component | License | Evidence |
|---|---|---|
| Kokoro-82M weights + code | **Apache 2.0** | hexgrad/kokoro LICENSE; model card |
| kokoro-js npm package | **Apache 2.0** | npm registry (fetched 2026-11-04) |
| Voice embeddings | **Apache 2.0** (bundled with model) | model card |
| `phonemizer` npm package (kokoro-js dependency) | declares Apache-2.0 **BUT bundles eSpeak-NG compiled to WASM; eSpeak-NG upstream is GPL-3.0** | npm registry; flagged independently by Verso and script-glow (2026) |

**Decision:** shipping `phonemizer` (eSpeak-NG WASM) to browsers is *distribution*
of GPL-3.0 code, so **FreeTTS is licensed GPL-3.0-or-later** (see LICENSE and
THIRD-PARTY-NOTICES.md). This is compatible with the project's free/open-source
goals; Apache-2.0 components (Kokoro weights, kokoro-js) are GPLv3-compatible.
Future work: a clean-room English G2P (Misaki-port pattern) would allow
relicensing the app permissively — tracked in the roadmap, not implemented.

### 1.10 Redistribution
Apache-2.0 explicitly permits downloading, redistributing, and commercial use of
the weights (standard attribution obligations apply). Practical caveats:
(a) kokoro-js hardcodes voice-file fetches to HuggingFace URLs (hexgrad/kokoro
issue #133) — self-hosting voices needs config/patching; (b) no
anti-redistribution clause found in the model card.

### 1.11 Existing browser implementations (all real, verified 2026-11-04)
- **kokoro-js** (official lib) — https://github.com/hexgrad/kokoro/tree/main/kokoro.js
- **HF Space kokoro-webgpu** (official demo) — https://huggingface.co/spaces/webml-community/kokoro-webgpu
- **runonweb.ai** (midudev, MIT code) — https://github.com/midudev/runonweb.ai — WebGPU (~326 MB) / WASM (~92 MB)
- **Verso** (local-first reading app) — https://github.com/rolfvonrolf/verso — measured 4.3× realtime WebGPU
- **Booklet** (reader app, WASM/WebGPU) — https://github.com/jguapp/booklet
- **slicc** multilingual patch (es/fr/it/hi/pt via custom espeak-ng WASM + `generate_from_ids`) — https://github.com/ai-ecoverse/slicc/pull/1170
- **quick-tts.com** — ships Kokoro (WebGPU) + Piper (WASM) + Web Speech API in one app
- **sandbook.app/kokoro-tts-online** (verified Oct 10 2026, 41 voices)

### 1.12 Chunking / pipeline limits
**510 phoneme tokens per forward pass** (512 with boundary tokens). kokoro-js ships
`TextSplitterStream`, which splits on punctuation and streams `{text, phonemes,
audio}` chunks — the standard long-text solution, which FreeTTS uses inside its
own sentence-aware chunker (`lib/text-chunk.ts`).

---

## 2. Piper TTS (VITS) — evaluated, NOT chosen as primary

### 2.1 Model description
Piper is a fast local neural TTS engine; each voice is a **VITS** model (text →
phonemes → waveform in one network, no separate vocoder), exported to **ONNX**,
run on ONNX Runtime (CPU). Input text is phonemized with **espeak-ng**. Each voice
ships as `{voice}.onnx` + `{voice}.onnx.json`. Original `rhasspy/piper` repo
archived Oct 2025 (was MIT); active development moved to **OHF-Voice/piper1-gpl**.
Latest release v1.8.0 (Sep 2026); README currently says "Looking for Maintainers".

### 2.2 Quality
"Clearly synthetic but not painful" — roughly 2021-era assistant quality, well below
2026 flagships. Best evidence: **Loudness.ai technical report LA-RB-2026-003
(15 Oct 2026)** — 1,683 speakers tested, scored with UTMOS22 + Whisper large-v3
(https://loudness.ai/research/piper-voices-v1/LA-RB-2026-003-en.pdf). All 793
voices scoring ≥90/100 are English. A Dec 2025 arXiv study (Qharabagh et al.,
https://arxiv.org/html/2512.08006): 16 native Persian speakers rated a Piper voice
**2.41/5 naturalness** vs 4.21 for human recording. Community MOS shorthand ~3.5
(not lab-measured — do not cite as fact).

### 2.3 Language coverage
Official catalog (Oct 2026): **177 voice files in 53 languages**. Target-language
status: English ✅ (best coverage, incl. 904-speaker `en_US-libritts_r-medium`
CC BY 4.0); Spanish ✅; French ✅; German ✅; Italian ✅; Portuguese ✅;
Chinese (Simplified) ✅ (`zh_CN-huayan-medium`); Urdu ✅ (`ur_PK-aegis`);
Arabic ⚠️ (official voice has muddy license); Hindi ⚠️ (all three voices carry
NC or restrictive licenses); Japanese ⚠️ (community voices only, no official model).

### 2.4 Size / speed
Single-speaker **medium** ONNX ~63 MB (measured `en_US-lessac-medium`: 63,201,294
bytes); **high** ~114–121 MB; x_low ~10 MB, low ~20 MB. Sample rates: 22,050 Hz
(medium/high), 16,000 Hz (x_low/low). Speed (real numbers): Apple M4 — medium
voices **RTF 0.083–0.095** (loudness.ai); 12th-gen Intel i7-1255U — RTF 0.153
(arXiv 2512.08006); laptop CPU — 6.68 s audio in 0.16 s (pyinns.com, 2026);
Raspberry Pi 4 — ~0.4 (tinkerer.in). **Browser WASM:** no isolated published RTF;
quick-tts.com reports single sentences "well under real-time" via WASM on a modern
laptop. Post-training quantization via sherpa-onnx: 61 MB FP32 → 19 MB INT8
(~3.2×, "minimal quality loss" — abhisarmehta.com training report).

### 2.5 Browser compatibility — YES (proven)
Full pipeline (espeak-ng WASM phonemizer + onnxruntime-web VITS) runs client-side
in production: **@realtimex/piper-tts-web** (maintained fork of Mintplex-Labs port,
ONNX Runtime 1.22), `piper-wasm` (diffusionstudio/vits-web), **offlinetts.com/app/piper**
(live demo, 904-speaker LibriTTS), **readtune** (Chrome extension), **The-Word**.
WASM-only — **works in Safari** (no WebGPU needed). Known gotchas: run inference
in a Web Worker; cold start = voice (30–75 MB) + ORT WASM (~10 MB) + espeak data
(~18 MB full / ~1 MB trimmed); needs `script-src 'wasm-unsafe-eval'` CSP.

### 2.6 License — why it lost
- **Engine code is GPL-3.0-or-later** (since 2025; was MIT). Serving GPL'd JS/WASM
  to browsers counts as distribution.
- **espeak-ng is GPL-3.0-or-later** and is inside the browser phonemizer WASM.
- **Voice weights are per-voice dataset licenses, NOT GPL** — a patchwork: 48 CC0,
  ~25 CC-BY, 8 public domain, 19 non-commercial, 1 AGPLv3, 24 "See URL"
  (libratory audit, Aug 2026); 76 voices fine-tuned from Lessac (Blizzard 2013
  research-only recordings — legal position of fine-tune lineage "unsettled").
- Clean-voice shortlist exists (EN `en_US-ljspeech-medium` public domain /
  `en_US-joe-medium` CC0; DE `de_DE-karlsson-medium` M-AILABS BSD-style), but Hindi
  (a target language) has no clean voice.

### 2.7 Verdict
**Strong technology, rejected as primary for v1** because (a) quality ceiling is
C+/"2021-era assistant" while the brief makes voice quality a major priority, and
(b) the GPL-3.0 engine code adds copyleft obligations without a quality payoff
over Kokoro (which is Apache-2.0 at the weights/code level). **Kept as the
documented fallback engine** for Safari/no-WebGPU devices if the Web Speech API
fallback proves insufficient — the engine abstraction (`engines/engine-interface.ts`)
is designed to accommodate it.

---

## 3. Web Speech API (`speechSynthesis`) — ✅ CHOSEN as tier-0 fallback engine

- **What it is:** built-in browser TTS; zero bytes, zero cost, works in every
  current major browser (Chrome 33+, Edge 14+, Firefox 49+, Safari 16+).
  Sources: https://micdrop.dev/blog/text-to-speech-javascript (Oct 2026);
  https://textintoaudio.com/browser-support (Oct 2026); MDN SpeechSynthesis.
- **Verified properties:** thin wrapper around OS/browser voices — voice
  names/URIs are **not consistent across devices**; list arrives asynchronously
  (`voiceschanged`); spec permits an empty list.
- **Privacy catch (verified):** desktop Chrome injects Google **network** voices
  (`localService === false`) — text is sent to Google's servers. Edge does the
  same with Microsoft "Online (Natural)" voices. **FreeTTS filters to
  `localService === true` only**, keeping synthesis on-device. Firefox shows
  local voices only.
- **Limits:** quality varies wildly by OS; language coverage = installed OS
  voices; Chrome network voices silently truncate ~15 s (irrelevant once filtered
  to local); `speak()` needs user activation (fine for a play button); word
  boundaries unreliable (no karaoke highlighting); still a Draft Community Group
  Report, not a W3C standard — expect browser drift.
- **Role in FreeTTS:** tier-0 fallback — instant speech with no download, a working
  voice on devices where the neural engine can't load, and multilingual-ish
  coverage depending on the device. Clearly labeled in the UI as "System voices
  (device-dependent, quality varies)". It is NOT the primary engine (inconsistent
  quality/identity; some devices have no local voices, e.g. bare Linux).

---

## 4. Other candidates — verdicts

| Model | Verdict | Why |
|---|---|---|
| **Chatterbox** (Resemble AI, 0.5B, MIT code+weights) | ❌ not a default | Browser-verified (Transformers.js v4, official Resemble demo, voxshot `ChatterboxEngine`) with real zero-shot cloning — but **~1.5 GB download**, **max_new_tokens 256 caps output to ~5–10 s/call**, WebGPU effectively required (CPU ~5.8× slower than realtime per voxshot), every output PerTh-watermarked. Multilingual ONNX exists but is **not confirmed loadable by Transformers.js**. Possible future "clone mode", not v1. |
| **Phonon 31m-en** (Gradium, Oct 21 2026, Apache 2.0, 64.5 MB, npm `phonon-tts`, Rust→WASM) | ❌ not yet | Strongest newcomer (30–100 ms first audio claimed), but **2 weeks old with zero independent benchmarks** — vendor claims only. Monitor. |
| **Supertonic 3** (Supertone, 66–99M, 31 languages) | ❌ | Browser-feasible via transformers.js, but **weights are OpenRAIL-M** (use restrictions) — fails the clean-license bar. |
| **Kitten TTS Nano** (15M, ~24 MB, Apache 2.0, English) | 🔶 possible low-end tier | Browser-feasible (transformers.js), smallest serious option; quality C+. Was implemented as the mobile engine, then **removed at the user's request on 2026-11-04** — see docs/KITTEN-SPIKE.md. |
| **Parler-TTS** (Apache 2.0, transformers.js ONNX) | ❌ | Mini is ~880M params — impractical for tab download/inference. |
| **Coqui XTTS-v2** | ❌ | CPML non-commercial license; no browser port. |
| **F5-TTS** | ❌ | Weights CC-BY-NC-4.0 (non-commercial); ~700 MB. |
| **Fish Speech / OpenAudio** | ❌ | Current weights non-commercial/research-only; no browser port. |
| **Sesame CSM-1B, Dia, Zonos, Bark** | ❌ | No browser/ONNX port found (Bark: community bark.cpp only). |
| **StyleTTS 2** | ❌ | Weights carry custom synthesis-disclosure condition; no browser port; Kokoro already packages its architecture in Apache-2.0. |
| **OuteTTS-0.2-500M** | ❌ | CC-BY-NC-4.0. |
| **Qwen3-TTS** (Alibaba, Apache 2.0, ~0.6B) | 🔶 monitor | One community browser experiment (voxshot). Unproven. |
| **MeloTTS** (MIT, VITS) | ❌ | No polished browser demo found. |
| **CosyVoice 3** (Apache 2.0, 9 langs) | ❌ | Server PyTorch only, no browser port. |
| **Google AI Edge / on-device TTS** | ❌ n/a | **Google offers no public on-device TTS model or web TTS API** (verified Nov 2026). Google AI Edge = inference runtimes (LiteRT), not speech models. Chrome's built-in AI (Prompt API/Gemini Nano) is text-in/text-out only — no TTS API exists even as an origin trial. OS-level TTS (Android/iOS) is reachable from the web only via the Web Speech API (§3). |

---

## 5. Inference technology notes

- **ONNX Runtime Web** — the common denominator: kokoro-js uses it via
  `@huggingface/transformers`; Piper browser ports use it directly. Execution
  providers: WebGPU (needs a GPU / SwiftShader), WASM (universal, SIMD+threads
  with COOP/COEP headers for `SharedArrayBuilder`).
- **Transformers.js** — what kokoro-js is built on; v4 added Chatterbox support
  with a rewritten WebGPU runtime co-built with the ONNX Runtime team.
- **Web Workers** — mandatory for inference (both engines); keeps the UI
  responsive during multi-second synthesis.
- **MP3 export** — via `lamejs` (browser-compatible MP3 encoder, BSD-licensed);
  verified working in the test suite (see `docs/TEST-REPORT.md`).

---

## 6. Decision matrix (scored against project constraints)

| Criterion | Kokoro-82M | Piper | Web Speech API | Chatterbox |
|---|---|---|---|---|
| Speech quality (verified evidence) | ★★★★ (arena #1 at launch) | ★★☆ (C+, 2.41/5 FA) | ★☆–★★★ (OS-dependent) | ★★★★ (server-class) |
| Proven 100% in-browser pipeline | ✅ yes | ✅ yes | ✅ yes | ✅ yes (constrained) |
| License cleanliness | Apache-2.0 weights/code; ⚠️ GPL via espeak-ng WASM dep | ⚠️ GPL-3.0 code + espeak-ng; per-voice patchwork | built-in | MIT |
| Works without WebGPU | ⚠️ WASM 0.7× RT (poor) | ✅ yes | ✅ yes | ❌ no |
| Works in Safari | ⚠️ untested, WASM path exists | ✅ yes | ✅ yes | ❌ no |
| Download size (smallest viable) | 86 MB (q8f16) | ~63 MB/voice + ~28 MB shared | 0 | ~1.5 GB |
| Multilingual (verified in browser) | ❌ English-only via kokoro-js | ✅ 53 langs (quality varies) | ✅ device-dependent | ❌ EN only verified |
| Voice count (verified) | 28 (EN, browser) | 177 files / 53 langs | device-dependent | fixed presets |

---

## 7. Risks & mitigations

1. **No-WebGPU devices degrade (Kokoro WASM 0.7× realtime, Verso).** Mitigation:
   device capability detection at startup; Web Speech API fallback always
   available; honest messaging ("high-quality voices need WebGPU").
2. **No published in-browser memory figures.** Mitigation: benchmark on this VM
   during verification; document honestly; lazy-load models (never at startup).
3. **eSpeak-NG GPL exposure.** Mitigation: app licensed GPL-3.0-or-later;
   THIRD-PARTY-NOTICES.md; clean-room G2P tracked as future work.
4. **English-only at launch.** Mitigation: UI/docs say so explicitly; engine
   interface carries per-language registries for future engines; multilingual G2P
   spike (slicc pattern) is roadmap item #1.
5. **Model download size (86–326 MB).** Mitigation: smallest viable variant
   default (q8f16), lazy download per voice selection, progress UI, IndexedDB
   caching, user-deletable models, honest storage-limit notes.

---

## 8. Final engine choice

**Primary engine: Kokoro-82M via `kokoro-js`** (Apache-2.0 weights/code;
WebGPU-first with WASM fallback; English-only voice set at launch — 28 verified
voices).

**Tier-0 fallback: Web Speech API `speechSynthesis`** (local voices only,
`localService === true` filter; labeled "System voices").

**Documented future engines:** Piper (Safari/universal WASM fallback), Chatterbox
(clone mode), Phonon (pending independent benchmarks), multilingual Kokoro via
custom G2P.

**Rationale:** Kokoro is the only candidate combining (a) genuinely high,
human-verified speech quality, (b) a mature, proven 100%-in-browser pipeline,
(c) a permissive license on weights and code, and (d) a download size a free
product can realistically serve. Piper wins on universality and language breadth
but loses decisively on quality (the brief's major priority) while carrying
heavier copyleft. The Web Speech API guarantees the app always speaks something
with zero bytes. Every rejected candidate is rejected for a sourced reason above,
not on assumption.

**App license consequence:** GPL-3.0-or-later (eSpeak-NG WASM inside the
kokoro-js dependency chain). See LICENSE and THIRD-PARTY-NOTICES.md.
