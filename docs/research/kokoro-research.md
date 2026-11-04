# Kokoro-82M Research Report — FreeTTS Track
**Research date:** 2026-11-04 · **Sources:** web search + direct fetches (npm registry, HF, GitHub), crawled 2026-11-04

---

## 1. Model description

- **Kokoro-82M** by **hexgrad** (`https://huggingface.co/hexgrad/Kokoro-82M`), v1.0 released **2025-01-27**; still the current/default version as of **2026-11-02** (verified by localaimaster.com review updated Nov 2026). v0.19 weights released 2024-12-25.
- **Architecture:** StyleTTS2-derived, **decoder-only** ("no diffusion, no encoder release" per model card). **Vocoder: ISTFTNet** (iSTFT decoder; n_fft=20, hop=5). Single fast forward pass, no iterative sampling.
- **Parameters:** 82M. **Output:** 24 kHz mono PCM. Phoneme input space: 178-symbol IPA vocab.
- Sources: model card; https://github.com/calesthio/generative-media-skills/blob/HEAD/skills/providers/text-to-speech/kokoro-tts/SKILL.md; https://localaimaster.com/blog/kokoro-tts-local-setup

## 2. Naturalness / pronunciation quality

No peer-reviewed MOS study found. What exists:
- **#1 on the TTS Spaces Arena leaderboard at launch (v0.19)** — blind human-voted; beat models 10–100× its size (XTTS 467M, MetaVoice 1.2B reported by multiple sources).
- **2026 arena standing (as reported by NeoVand/voicebook, Jul 2026):** TTS Arena V2 ~32nd overall, Elo **1056.2**, 54.4% win rate over 5,368 appearances; Artificial Analysis Speech Arena Elo ~1060, below server-only leaders (ElevenLabs v3 ~1178, Fish Audio S2 Pro ~1110). Community consensus: top *browser-native* option, best quality-per-MB for English narration.
- **TextToLab (Oct 2026, blog):** claims MOS **4.2/5** "in its weight class" and "96× real-time on GPU, 210× on optimized setups" — **blog-sourced, unverified**; do not cite as fact.
- Community caveats (multiple 2026 sources): flat emotional range, **no voice cloning** (fixed preset voices only), weaker non-English quality than English; pronunciation control via inline phoneme override `[word](/phonemes/)` in misaki (Python stack).
- Sources: https://github.com/neovand/voicebook/blob/HEAD/references/TTS_models_Claude_Deep_Research.md; https://texttolab.com/blog/open-source-text-to-speech; https://www.spheron.network/ via automotos-academy doc

## 3. Language coverage (VERIFIED)

**8 languages / 9 language codes / 54 voices** (US+UK English count separately by code). Voice ID = `[lang][gender]_[name]` (e.g. `af_heart` = American Female "Heart"). Lang codes: `a` US-English, `b` UK-English, `e` Spanish, `f` French, `h` Hindi, `i` Italian, `j` Japanese, `p` Brazilian Portuguese, `z` Mandarin.

| Code | Language | Voices (verified from pet-talk VOICES.md, korvid, soniqo) |
|---|---|---|
| `af_*` | US English F (11) | heart, alloy, aoede, bella, jessica, kore, nicole, nova, river, sarah, sky |
| `am_*` | US English M (9) | adam, echo, eric, fenrir, liam, michael, onyx, puck, santa |
| `bf_*` | UK English F (4) | alice, emma, isabella, lily |
| `bm_*` | UK English M (4) | daniel, fable, george, lewis |
| `ef_*`/`em_*` | Spanish (3) | ef_dora; em_alex, em_santa |
| `ff_*` | French (1) | ff_siwis |
| `hf_*`/`hm_*` | Hindi (4) | hf_alpha, hf_beta; hm_omega, hm_psi |
| `if_*`/`im_*` | Italian (2) | if_sara; im_nicola |
| `jf_*`/`jm_*` | Japanese (5) | jf_alpha, jf_gongitsune, jf_nezumi, jf_tebukuro; jm_kumo |
| `pf_*`/`pm_*` | Brazilian Portuguese (3) | pf_dora; pm_alex, pm_santa |
| `zf_*`/`zm_*` | Mandarin (8) | zf_xiaobei, zf_xiaoni, zf_xiaoxiao, zf_xiaoyi; zm_yunjian, zm_yunxi, zm_yunxia, zm_yunyang |

Counts: 20+8+3+1+4+2+5+8+3 = **54**. Grades from upstream VOICES.md: af_heart **A**, af_bella **A-**, bf_emma **B-** are the best English voices; most others C/D. (Sources: korvid research doc; pet-talk/docs/VOICES.md verified against HF cache 2026-09-12; soniqo.audio/guides/kokoro; kokoro.js README voice table fetched 2026-11-04.)

## 4. Model size — ONNX variants (from official HF README table)

Hosted at **`https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX`** (8 `.onnx` files + `voices/` embeddings). Sizes (from repo README + per-file HF pages, SHA-verified):

| File | Type | Size |
|---|---|---|
| `model.onnx` | fp32 | **326 MB** |
| `model_fp16.onnx` | fp16 | **163 MB** |
| `model_quantized.onnx` | int8 | **92.4 MB** |
| `model_q8f16.onnx` | int8/fp16 mixed | **86 MB** |
| `model_uint8.onnx` | uint8 | **177 MB** |
| `model_uint8f16.onnx` | uint8/fp16 | **114 MB** |
| `model_q4f16.onnx` | 4-bit matmul + fp16 | **154 MB** |
| `model_q4.onnx` | 4-bit | size not in table (~45 MB claimed by one third-party doc — **unverified**) |

Voice embeddings: one pack `voices-v1.0.bin` **~25–28 MB** for all 54 voices; each voice is a 510×256 fp32 style tensor (~523 KB). Source: onnx.bimant.com mirror listing; HF file pages; https://github.com/kadirnar/voice-agent-next/blob/HEAD/docs/providers/kokoro.md

## 5. Memory requirements at inference

- **Not directly measured in a browser in any source found.** What exists: fp32 weights 326 MB on disk; a server GPU instance (Kokoro-FastAPI, PyTorch+CUDA) measured **2.37–3.98 GB resident VRAM** per instance (includes PyTorch/CUDA context, not model alone) — https://nexgpu.net/en/models/kokoro/. On-device inference memory in onnxruntime-web (WASM/WebGPU) is **not published** — mark as unknown; needs a benchmark run.
- kokoro-js package itself ~30 MB unpacked (includes ort WASM binaries). (George-RD/hologlyph research doc)

## 6. Browser compatibility — VERIFIED YES (full pipeline runs client-side)

- **kokoro-js** (npm, `hexgrad/kokoro/kokoro.js`) runs the **complete pipeline in-browser**: text → JS `normalize_text` → **espeak-ng WASM phonemization** (`phonemizer` npm pkg) → phoneme IDs → **ONNX acoustic model via onnxruntime-web** (iSTFT vocoder inside the same graph) → 24 kHz PCM.
- Devices: `"wasm"` | `"webgpu"` (web), `"cpu"` (Node). Backed by `@huggingface/transformers` + onnxruntime-web.
- **WebGPU confirmed working** (runonweb.ai tests Transformers.js 4.2: "Kokoro TTS runs on WebGPU"; Verso measured, see §7). **WASM fallback confirmed but slow** (0.7× realtime — see §7). WASM threaded build needs COOP/COEP headers (SharedArrayBuffer); Vercel can be configured for this (javiertsalas.com writeup).
- NOTE: kokoro-js **1.2.1 is effectively English-only** (see §11): hardcoded 28-voice `VOICES` map (`_validate_voice` throws on others) and `phonemize()` hardcodes espeak to `en-us`/`en`. Multilingual browser use needs patching (see ai-ecoverse/slicc PR #1170 which did this via `generate_from_ids` + own espeak-ng WASM glue).

## 7. CPU inference speed (REAL reported numbers only)

| Source | Setup | Result |
|---|---|---|
| **Verso** (RolfVonRolf/Verso CLAUDE.md, measured Sept 2026) | browser, WebGPU fp32 | **4.3× realtime, 1.2 s to first audio** |
| **Verso** (same) | browser, WASM q8 fallback (GPU-less) | **0.7× realtime** — streaming stutters/stops; "any device without a WebGPU adapter cannot run this app usefully" |
| **korvid** research doc (2026-08-20) | M1 CPU, ONNX | fp32 ~1.2 s/utterance, fp16 ~1.0 s, q8 ~0.8 s |
| **script-glow** (2026-09-19 spike) | onnxruntime-node, fp32 incl. G2P | **0.46 s/line** |
| **pet-talk** (2026-09-12, measured) | Python `kokoro-local`, MacBook under load | **RTF 0.065–0.183** (bf_emma 0.065, am_adam 0.183) |
| TextToLab (blog, Oct 2026) | GPU/optimized server | "96× GPU, 210× optimized" — **unverified** |

Browser WASM RTF from a controlled source: **not found** beyond Verso's 0.7× figure.

## 8. Quantization

- Variants: fp16, int8 (`model_quantized`), q8f16, uint8, uint8f16, q4, q4f16 (see §4).
- Quality trade-off: repo README provides audio samples per quant but **no quantitative quality comparison found**; community claim: "model is resilient to quantization". kokoro-js README: **fp32 recommended with WebGPU**; q8/q4 to shrink download and speed WASM.
- Known issues: **fp16 gave silent audio on CPU** (script-glow 2026-09-19 spike); DirectML execution provider still has open errors (nexgpu).

## 9. License

| Component | License | Evidence |
|---|---|---|
| Kokoro-82M weights + code | **Apache 2.0** | hexgrad/kokoro `LICENSE`; model card `license: apache-2.0` with "Apache-licensed weights… can be deployed anywhere from production environments to personal projects" |
| kokoro-js npm package | **Apache 2.0** | registry.npmjs.org/kokoro-js (fetched 2026-11-04) |
| Voices (embeddings) | **Apache 2.0** (bundled with model) | model card; third-party audits (hologlyph, voicebook) |
| phonemizer npm package | package.json declares **Apache-2.0** — **BUT** it bundles an eSpeak-NG WASM build; **eSpeak-NG upstream is GPL-3.0** | registry.npmjs.org/phonemizer (fetched 2026-11-04); Verso CLAUDE.md: "`phonemizer` → eSpeak NG: GPL-3.0. This is the catch. Shipping it to the browser is *distribution*, which is what GPL cares about"; script-glow avoided kokoro-js for this exact reason (2026-09-19 design doc) |

⚠️ The GPL question on the phonemizer dependency is the **single biggest legal caveat** — flagged independently by two 2026 projects. Needs a proper license decision before shipping kokoro-js in FreeTTS (options: replace phonemization with a GPL-free port like script-glow's Misaki-port approach, or accept GPL on that component).

## 10. Redistribution

- Model card + Apache-2.0 explicitly permit download, redistribution, and commercial use (standard Apache-2.0 notice/attribution obligations apply).
- HuggingFace repos: weights downloadable; `onnx-community/Kokoro-82M-v1.0-ONNX` is the community export used by kokoro-js; voices dir ships embeddings.
- Practical caveats: (a) kokoro-js hardcodes **voice-file fetches to HF URLs** (hexgrad/kokoro issue #133) — self-hosting voices needs config/patching; (b) model card says weights "can be deployed anywhere" — no anti-redistribution clause found; (c) no statement on the voice-data provenance beyond Apache-2.0.

## 11. Existing browser implementations (REAL, verified)

| Implementation | URL | Engine |
|---|---|---|
| **kokoro-js** (official lib) | https://github.com/hexgrad/kokoro/tree/main/kokoro.js · npm `kokoro-js` 1.2.1 | transformers.js + onnxruntime-web, wasm/webgpu |
| **HF Space kokoro-webgpu** (official demo, linked from kokoro-js README) | https://huggingface.co/spaces/webml-community/kokoro-webgpu | WebGPU in-browser |
| **runonweb.ai** (midudev, Cloudflare Workers, MIT code) | https://github.com/midudev/runonweb.ai | WebGPU (~326 MB) / WASM (~92 MB) |
| **BrowserAI demo** | tts-demo.browserai.dev (via toolerific.ai listing) | browser-local Kokoro |
| **Verso** (local-first reading app, measured 4.3× RT WebGPU) | https://github.com/rolfvonrolf/verso | kokoro-js |
| **Booklet** (reader app, in-browser WASM/WebGPU) | https://github.com/jguapp/booklet/commit/9ff7bdebc7d325a524dda1f7b0ecb438d375d51f | kokoro-js q8 |
| **slicc** multilingual patch (June 2026, es/fr/it/hi/pt via custom espeak-ng WASM + `generate_from_ids`) | https://github.com/ai-ecoverse/slicc/pull/1170 | kokoro-js + own G2P glue |
| **javiertsalas.com** client-side TTS app (Vercel; COOP/COEP for WASM threads) | https://www.javiertsalas.com/blog/kokoro-tts.html | kokoro-js |
| aliveville (Cloudflare) — kokoro-js in dep list | https://github.com/sarthakagrawal927/aliveville | kokoro-js |
| Sandbook (iOS, CoreML on-device — native, not browser, for reference) | https://sandbook.app/voices | CoreML |

Also **demo app** ships in the kokoro repo (`kokoro.js/demo`, React+Vite).

## 12. Phonemization / text normalization / chunking (browser specifics)

- **kokoro-js 1.2.1 phonemization = `phonemizer` npm package** (eSpeak-NG compiled to WASM). **Ships English language data only** — non-English espeak voices rejected/absent (UdyogSaarthi voice-stack doc, 2026-09-11; sokuji issue #134). Open PR hexgrad/kokoro#262 ("re-compile eSpeak-NG WASM with all languages") is **still open/unmerged**.
- kokoro-js's own `phonemize()` hardcodes espeak voice to `en-us`/`en` for all voice prefixes and validates against a **28-voice English-only VOICES map** — passing e.g. `ef_dora` throws. Multilingual PRs to kokoro-js exist but **none merged** (sokuji #134, Mar 2026).
- **Text normalization:** kokoro-js does this in JS (`normalize_text` — quotes, brackets, whitespace, abbreviations, numbers, currency, possessives, hyphenated initials; SSML PR hexgrad/kokoro#302). Python stack instead uses **misaki** G2P (dictionary + spaCy + num2words, EspeakFallback for OOV) for English, espeak-ng for other languages; upstream zh/ja use jieba+pinyin/openjtalk (Python), **no JS port exists** — ja/zh are the hardest to bring to the browser.
- **Chunking limits:** **510 phoneme tokens per forward pass** (512 with boundary tokens). kokoro-js ships **`TextSplitterStream`** which splits on punctuation and streams `{text, phonemes, audio}` chunks — the standard long-text solution. Non-English chunking is "not fully implemented" — long non-English text can truncate unless pre-split at sentence boundaries (calesthio skill doc).
- Voice-blending is supported (average style embeddings) in the Python stack.

## 13. Verdict

**STRONG — for an English-first FreeTTS MVP.** Reasons: Apache-2.0 weights+code (best-in-class license), the only mature model with a **proven 100%-in-browser pipeline** (kokoro-js + onnxruntime-web, WebGPU 4.3× realtime measured), 86–326 MB downloads, 28 quality English voices, streaming chunking built in, real deployments (runonweb.ai, Verso, Booklet).

**Key risks to resolve before committing:**
1. **Multilingual gap:** kokoro-js today = English only (28 voices). Non-English (es/fr/it/hi/pt) needs custom G2P work (slicc PR #1170 pattern); ja/zh have no JS G2P at all. If FreeTTS needs Hindi on day one, Kokoro alone is insufficient via stock kokoro-js.
2. **GPL-3.0 contamination via `phonemizer`/eSpeak-NG:** two independent 2026 audits flagged it; one project dropped kokoro-js over it. Decide: replace G2P with a clean-room/Misaki-port (script-glow pattern) or accept GPL scope.
3. **No-WebGPU devices degrade:** WASM-only measured at 0.7× realtime (Verso) — streaming breaks; plan a hard WebGPU requirement or non-streaming UX for those devices. Mobile Chrome/Android: phonemizer import stall reported Sept 2026 (Verso) — untested, assume risky.
4. **No measured browser memory figures** — benchmark RAM on target devices before finalizing the "low-end device" story.

**Recommendation:** adopt Kokoro-82M via kokoro-js as the FreeTTS engine for the **English MVP**, on WebGPU-first with WASM fallback; open two work items — (a) license review of the phonemizer GPL exposure, (b) a multilingual G2P spike for Hindi/Spanish/French/Italian/Portuguese using the slicc `generate_from_ids` pattern — before promising non-English languages.
