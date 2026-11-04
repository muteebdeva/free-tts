# Piper TTS — Research Report for FreeTTS (Nov 4, 2026)

Research track: Piper TTS (rhasspy/piper → OHF-Voice/piper1-gpl) and lightweight ONNX neural TTS voices for a free, local-first, in-browser TTS web app.

---

## 1. Model description

- **What it is:** Piper is a fast, local neural text-to-speech engine. Each voice is a **VITS** (Variational Inference with adversarial learning for end-to-end Text-to-Speech) model: text → phonemes → waveform in a single network, no separate vocoder.
  Sources: https://www.promptquorum.com/power-local-llm/piper-tts-review, https://www.cekura.ai/discover/piper-tts
- **Runtime format:** trained PyTorch checkpoints are exported to **ONNX** and run on **ONNX Runtime**, CPU-only (optional CUDA build exists). No GPU required.
- **Phonemization:** input text is first converted to phonemes with **espeak-ng** (rule-based), not learned end-to-end. Each voice ships as two files: `{voice}.onnx` + `{voice}.onnx.json` (config).
- **Sizes:** single-speaker **medium** ONNX files cluster around **~63 MB**; **high** ~**114–121 MB** (measured `en_US-lessac-medium`: 63,201,294 bytes; per-voice `size_bytes` recorded in `voices.json`).
  Source: https://github.com/vcostin/proactive-agent/blob/HEAD/.scratch/tts-voice-options/research-piper-voice-catalog.md
- **Quality tiers** (train-time settings mapping to sample rate + model size): **x_low, low, medium, high**. Rough per-tier sizes from community docs: x_low ~10 MB, low ~20 MB, medium ~40–63 MB, high ~60–120 MB (note: real measured medium files are ~63 MB, so the older ~40 MB figure is optimistic).
  Source: https://github.com/hopkdj/openswap-guide/blob/HEAD/content/posts/coqui-tts-vs-piper-vs-openvoice-self-hosted-tts-engines-guide-2026.md
- **Sample rates:** medium/high voices are **22,050 Hz**; x_low/low are typically **16,000 Hz** (e.g. `en_US-kathleen-low` 16 kHz; loudness.ai measured Nepali x_low at 16,000 Hz, all medium/high at 22,050 Hz).
  Sources: vcostin doc above; https://www.pyinns.com/python/llm-and-generative-ai/text-to-speech-python-piper-tts-2026 (measured 22050 Hz output); https://loudness.ai/research/piper-tts-voices-ranked/
- **Multi-speaker voices:** several voices pack many speakers in one file — `en_US-libritts_r-medium` exposes **904 speaker IDs** (CC BY 4.0); LibriTTS high has hundreds; Clean 100 (community) has 245 speakers.
- **Current project state:** original `rhasspy/piper` repo archived (read-only) Oct 6, 2025 under MIT; active development moved to **OHF-Voice/piper1-gpl** (Open Home Foundation) under **GPL-3.0-or-later**. Latest release **v1.8.0** (Sep 4, 2026); PyPI `piper-tts` 1.8.0. Note: README currently says "Looking for Maintainers".
  Sources: https://github.com/OHF-Voice/piper1-gpl (repo metadata, GPL-3.0, 6,154 stars), https://www.promptquorum.com/power-local-llm/piper-tts-review, https://primcast.com/workloads/self-hosted-text-to-speech

## 2. Naturalness / quality

Piper quality is "clearly synthetic but not painful" — audibly neural, roughly 2021-era assistant quality, well below 2026 flagship models but strong for its size.

Best evidence — **Loudness.ai technical report LA-RB-2026-003 (15 Oct 2026)**: tested 1,683 speakers (75 official files + 3 community models), each reading 3 sentences, scored with UTMOS22 (predicted naturalness, trained on human ratings) + Whisper large-v3 clarity. Caveat from the authors: compare scores **within** a language only.
- Best voices are English: all 793 voices scoring ≥90/100 are English. Community model **Clean 100** matched the best official voice (96.4 vs 96.2).
- Non-English bests: Italian Serena (high) 89.6 · Urdu Aegis Female 85.2 · Spanish (Mexico) Claude 85.0 · German Karlsson 81.8 · Chinese Huayan 79.6 · French Gilles 76.8 · Spanish (Spain) MLS 9972 75.8 · Portuguese (Brazil) Edresson 74.1 · Polish MLS 68.8.
- **Speaker choice matters more than model:** within one model, speakers differ by up to 46.3 points; speaker 0 (the default) is rarely the best.
- Source: https://loudness.ai/research/piper-tts-voices-ranked/ and PDF https://loudness.ai/assets/research/piper-voices-v1/LA-RB-2026-003-en.pdf

Other evaluations:
- A Dec 2025 arXiv phonemization study (Qharabagh et al.) used a Persian Piper voice as baseline: **16 native Persian speakers rated Piper 2.41/5 naturalness** vs 4.21 for a real human recording. Source: https://www.cekura.ai/discover/piper-tts (summarizing https://arxiv.org/html/2512.08006)
- quick-tts.com (May 2026, ships Piper+Kokoro+Web Speech): Piper medium voices sound "roughly like a 2021-era Google Assistant: clearly synthetic but not painful." Source: https://quick-tts.com/blog/web-speech-api-vs-piper-vs-kokoro.html
- voicebook deep-research (July 2026): Piper quality "Good (C+), clear but flatter"; Kokoro ranked best quality for the browser; `de_DE-thorsten-high` called "genuinely audiobook-grade among non-English voices." Source: https://github.com/neovand/voicebook/blob/HEAD/references/TTS_models_Claude_Deep_Research.md
- Various comparison tables assign Piper a **MOS of ~3.5** (e.g. https://github.com/bettercallzaal/ZAOOS/blob/main/research/music/329-open-source-tts-elevenlabs-alternatives/README.md, https://www.myshengong.com/neural-tts/index.html) — treat as community shorthand, not a lab-measured figure.

## 3. Language coverage

Official catalog (Oct 2026 revision): **177 voice files in 53 languages** (loudness.ai, revision c10ece1 of `rhasspy/piper-voices`); 175 voices / 56 language-locale combos per cekura.ai; Subtitld lists 177 voices in 59 languages incl. curated community voices for Tamil, Sinhala, Kannada, Kurmanji.

Status for the target languages (voice file exists? name, license note):

| Language | Voices (examples) | Usable? |
|---|---|---|
| English | `en_US-lessac-*`, `en_US-libritts_r-medium` (904 speakers, CC BY 4.0), `en_US-joe/kristin` (CC0/public domain), `en_GB-cori` (public domain), `en_GB-alba` (CC BY 4.0), `en_US-ljspeech` (public domain), community Clean 100 / Jenny / ManyVoice | ✅ best coverage |
| Hindi | `hi_IN-rohan-medium` (Lessac lineage, IndicTTS licence), `hi_IN-pratham-medium` / `hi_IN-priyamvada-medium` (**CC BY-NC-SA 4.0 — non-commercial**), community `hi_IN-coqui-medium` | ⚠️ exists, but licenses are NC/restrictive; fine for a free non-commercial app, not for commercial |
| Spanish | `es_ES-sharvard` (Lessac lineage), `es_MX-claude` (85.0, incl. in study), `es_ES-mls` speakers (75.8, MLS = CC BY 4.0), `es_ES-davefx` (CC0, Lessac lineage) | ✅ |
| French | `fr_FR-siwis` (CC-BY 4.0), `fr_FR-upmc`, `fr_FR-mls` speakers — best "Gilles" 76.8 | ✅ |
| German | `de_DE-thorsten` (CC0 stated, Lessac lineage), `de_DE-karlsson` (81.8, M-AILABS BSD-style license — commercial-OK with copyright notice), `de_DE-mls` (CC-BY 4.0), `de_DE-eva_k/ramona` (M-AILABS) | ✅ |
| Italian | `it_IT-riccardo-x_low`, `it_IT-paola-medium` (Lessac lineage), `it_IT-serena-high` (89.6, included in study) | ✅ |
| Portuguese | `pt_BR-faber-medium` (CC0, "Dave" on some listings), `pt_BR-edresson` (74.1, included) | ✅ |
| Japanese | `ja_JP-kokoro-medium`, `ja_JP-hi_fi_captain-medium`, `ja_JP-haruka-medium` — **community voices only; no official upstream Japanese model** (Voxxwire paper, March 2026: "Japanese output defaults to subtitles-only"). Licenses need per-voice check | ⚠️ community-only, verify license per voice |
| Chinese (Simplified) | `zh_CN-huayan-medium` (79.6, included in study) | ✅ |
| Urdu | `ur_PK-aegis` ("Aegis Female", 85.2, included), `ur_PK-fasih` | ✅ |
| Arabic | `ar_JO-kareem-*` (Lessac lineage — excluded from commercial-safe list; card says "See source"), community `ar_SA-kareem` | ⚠️ official one has muddy license; community Saudi variant exists |

License-relevant findings (loudness.ai, all cards read): 102 of 177 official files are NOT safe for commercial use — 76 fine-tuned from the Lessac voice (Blizzard 2013 research-only recordings; legal position of fine-tune lineage "unsettled") and 26 with own NC/research-only licenses. **For FreeTTS (free, non-commercial, open-source), NC voices are acceptable** (NC only blocks commercial use), but Lessac research-licensed voices remain a gray area — prefer CC0/CC-BY/public-domain voices where they exist. The Hindi voices are the worst case: all three are NC or Lessac-lineage.

Sources: https://loudness.ai/research/piper-tts-voices-ranked/ · https://tts.ai/voices/piper/ (51-voice listing incl. Urdu/Arabic/Chinese, no Hindi/Japanese in that older subset) · https://subtitld.org/addons/piper-tts · https://jxiv.jst.go.jp/index.php/jxiv/preprint/download/3482/8240/7661 (Voxxwire, Japanese gap) · https://github.com/smart-village-solutions/smart-speech-flow/blob/HEAD/services/tts/README.md (per-language voice map incl. `hi_IN-priyamvada-medium`, `zh_CN-huayan-medium`)

## 4. Browser compatibility

**Yes — the full pipeline (espeak-ng phonemization + ONNX VITS inference) already runs in browsers via WASM.** Proven by multiple production projects:

- **espeak-ng compiles to WASM.** `piper_phonemize.wasm` (+ ~18 MB `piper_phonemize.data` of espeak-ng language data, Emscripten file-packaging, ~80 languages) is the standard browser phonemizer. Per-language data splitting exists to cut downloads (kgergooo/piper-tts-web-phonemizer splits the 18 MB blob per language; readtune repacked to English-only ~0.94 MB). Sources: https://deepwiki.com/diffusionstudio/vits-web/4.3-audio-processing · https://github.com/engineer9118brov2/readtune/blob/HEAD/docs/PIPER.md · https://github.com/kgergooo/piper-tts-web-phonemizer/blob/HEAD/readme.md
- **ONNX inference in browser:** via **onnxruntime-web** WASM (SIMD build ~10 MB); runs single-threaded in a Web Worker to avoid main-thread stalls. No WebGPU needed for Piper (VITS is WASM-only in existing builds), so **it works in every modern browser incl. Safari** (Chrome 57+, Firefox 52+, Safari 11+, Edge 16+).
  Source: https://dev.to/linmingren/building-a-browser-based-text-to-speech-system-with-piper-tts-ljh
- Known gotchas from shipped projects: run inference in a Web Worker (VITS CPU inference can stall the UI hundreds of ms per chunk); first-visit cold start = voice download (30–75 MB) + ORT WASM (~10 MB) + espeak data (~18 MB full / ~1 MB trimmed); needs `script-src 'wasm-unsafe-eval'` CSP; espeak-ng-data (~19 MB) is fetched at runtime into Emscripten MEMFS.
  Sources: https://quick-tts.com/blog/web-speech-api-vs-piper-vs-kokoro.html · https://github.com/khursani8/avatar-chrome/blob/HEAD/AGENTS.md · https://github.com/engineer9118brov2/readtune/blob/HEAD/docs/PIPER.md

## 5. CPU speed (real reported RTF numbers only)

| Source | Setup | Voice | RTF (lower = faster) |
|---|---|---|---|
| loudness.ai (Oct 2026), 2 intra-op threads | Apple M4 laptop | en_US libritts_r **high** | **0.568** |
| loudness.ai | Apple M4 laptop | medium voices (de/fr/nl MLS, Clean 100, ManyVoice, Jenny) | **0.083–0.095** |
| loudness.ai | 12-core AMD EPYC virtual server | medium / libritts high | 0.17–0.19 / 0.834 |
| arXiv 2512.08006 (Dec 2025) | 12th Gen Intel i7-1255U, CPU-only | Persian Piper | **0.153** (~6.5× real-time) |
| pyinns.com (2026), real script output | laptop CPU, piper-tts 1.8.0 | medium | **0.025** (6.68 s audio in 0.16 s; "an hour of speech in ~1.5 min") |
| tinkerer.in (2026) | Raspberry Pi 4 (Cortex-A72, no dotprod/i8mm) | en_US-lessac-medium | **~0.4** (kept as TTS node; Kokoro dropped at RTF ~8) |
| copyprogramming.com | Raspberry Pi 5 | high-quality voices | 0.3–0.5 |
| quick-tts.com (May 2026) | modern laptop, WASM in browser | en_US-libritts_r-medium | single sentence "well under real-time"; cold ~6 s incl. download |

Speculative/secondary (community blog, unverified methodology, likely using RTF = 1/x convention — cited for completeness, **do not rely**): neural_tts_evolution.md claims RTF 1409–7603× (i.e. 1/RTF ~0.0007–0.0001); ZAOOS/myshengong tables claim RTF 0.008.

**Browser-specific:** no published RTF measured inside WASM specifically was found; browser inference is expected to be slower than native ONNX Runtime but quick-tts reports a single sentence renders "well under real-time on any modern laptop" through the WASM path. Marked as: **no isolated WASM RTF figure found**.

## 6. Quantization / model variants

- **Official quality tiers** x_low/low/medium/high are train-time variants (different widths), not post-training quantization — that's the primary "smaller model" mechanism.
- **Post-training quantization exists via the sherpa-onnx ecosystem:** the sherpa-onnx tts-models release ships Piper voices in **fp32 / fp16 / int8** builds ("Most piper voices ship all three"), addressable as e.g. `vits-piper-en_US-amy-low-int8`. Source: https://github.com/aactools/sherpa-onnx-tts-models/commit/8bc17e89cdd6c1e5757f96a35e8b1dbaa469cc31
- Measured example: a 61 MB FP32 medium VITS → **19 MB INT8** (dynamic INT8 via ONNX Runtime `quantize_dynamic`, 3.2× compression, "minimal quality loss"); RTF stayed ~0.07. Source: https://abhisarmehta.com/assets/tts-training-report.pdf
- In-browser angle: kokoro-js uses `dtype: "q8"` WASM fallback; nothing found showing int8 Piper voices specifically benchmarked in-browser, but onnxruntime-web supports quantized models, so int8 Piper voices should run there (unverified — speculation).

## 7. License — IMPORTANT CORRECTIONS

**The task's premise is wrong: piper1-gpl *voices* are NOT GPL-licensed.** Two separate layers:

**a) Engine code — GPL-3.0-or-later (since 2025).** `OHF-Voice/piper1-gpl` is GPL-3.0 (confirmed in repo metadata). The archived `rhasspy/piper` was MIT. For a web app, *serving* GPL'd JS/WASM to browsers counts as distribution/conveyance, so FreeTTS itself would need to be GPL-compatible (fine for an open-source project; fatal only for closed-source plans). Sources: https://github.com/OHF-Voice/piper1-gpl · https://www.promptquorum.com/power-local-llm/piper-tts-review

**b) espeak-ng — GPL-3.0-or-later, and it IS in the browser pipeline.** `piper_phonemize.wasm` embeds espeak-ng. Real projects handle this explicitly: readtune ships `espeak-ng.LICENSE.txt` with the full GPLv3 text + written source offer + a statement of how it's combined, and plans to replace espeak-ng with a permissively-licensed g2p long-term; ttspro deliberately removed bundled espeak-ng WASM and loads it from a CDN at runtime instead. For FreeTTS (free/open-source), bundling espeak-ng WASM is GPL-compliant as long as FreeTTS is GPL and ships the license notice + source offer. Source: https://github.com/engineer9118brov2/readtune/blob/HEAD/docs/PIPER.md · https://github.com/llicklair/ttspro/blob/HEAD/THIRD_PARTY.md

**c) Voice weights — per-voice dataset licenses, NOT a blanket license.** Each voice carries the license of the recordings it was trained on, stated in its `MODEL_CARD` on Hugging Face. The catalog is a patchwork (libratory's 2026-08-22 audit: 48 CC0, ~25 CC-BY, 8 public domain, 4 Apache, **19 non-commercial**, 1 AGPLv3, 24 "See URL"; loudness.ai Oct 2026: 51 no-conditions, 1,613 credit-required, 2 copyleft (GPL-2.0/AGPL-3.0), 17 unclear).
- **Non-GPL voices definitely exist:** `de_DE-thorsten` (CC0), `en_GB-cori` / `en_US-ljspeech` / `en_US-kristin` (public domain), `en_US-joe` / `en_US-kathleen` (CC0), `en_US-libritts_r` (CC BY 4.0), `de_DE-mls` (CC BY 4.0), many OHF-Voice dataset voices (CC0), `ru_RU-irina` (GPL-3.0 — one of the rare copyleft voices), `en_US-ryan` (CC BY-NC-SA 4.0).
- Sources: https://www.vocaread.com/en/licenses.html · https://github.com/subev/libratory/blob/HEAD/tasks/piper-voices.md · https://loudness.ai/research/piper-tts-voices-ranked/ · https://github.com/stelnetxcis-create/cielvox2/blob/HEAD/hf_readmes/piper-voices-GGUF.md

**Copyleft implications for FreeTTS:** (not legal advice)
1. Bundling piper1-gpl-derived code or espeak-ng WASM in the app → FreeTTS should be licensed **GPL-3.0-or-later** and ship license texts + source offer. This is compatible with a free open-source project.
2. Voice *weights* are data under their own licenses: CC0/public-domain voices need nothing; CC-BY needs attribution (credit line in the app); CC BY-SA additionally requires sharing adaptations of the voice under the same terms; **NC voices are fine for a free non-commercial app but poison any future commercialization**; Lessac research-license voices are a gray area outside research use — avoid as defaults.
3. The pragmatic clean-voice shortlist for defaults: English `en_US-ljspeech-medium` (public domain) / `en_US-joe-medium` (CC0) / `en_GB-cori-medium` (public domain); German `de_DE-karlsson-medium` (M-AILABS BSD-style) — this is exactly what readtune shipped.

## 8. Redistribution

- Voices are hosted on **Hugging Face: `rhasspy/piper-voices`** (still the canonical repo; tagged `v1.0.0`; loudness.ai pinned revision c10ece1). Direct file URLs: `https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/{lang_family}/{lang_code}/{dataset}/{quality}/{lang_code}-{dataset}-{quality}.onnx` (+ `.onnx.json`). Source: https://github.com/vcostin/proactive-agent/blob/HEAD/.scratch/tts-voice-options/research-piper-voice-catalog.md
- **Hotlinking works and is common practice:** projects fetch voices at runtime from HF (readtune requests an optional `huggingface.co` permission and downloads ~60 MB per voice on demand; avatar-chrome fetches Malay voices at runtime; ttspro-style docs reference jsDelivr for the espeak WASM). Caveat: HF rate-limits heavy hotlinking; for production scale, self-host or mirror the voice files on your own CDN — they are static files, no auth needed.
- **Serving weights to browsers is exactly what every browser Piper demo does** (offlinetts.com, quick-tts.com, The-Word); the weights are plain static assets fetched once and cached (IndexedDB/Cache API recommended).
- Machine-readable index: `voices.json` in the repo root lists every voice with `size_bytes`, md5s, and both file paths — use it to build the voice picker programmatically.
- Redistribution legality = per-voice license (see §7c): CC0/PD/CC-BY voices are redistributable; NC voices redistributable only for non-commercial purposes; Lessac-licensed voices — redistribution terms unclear.

## 9. Existing browser implementations

| Project | URL | Engine details |
|---|---|---|
| **Mintplex-Labs/piper-tts-web** (original WASM port) | https://github.com/Mintplex-Labs/piper-tts-web (npm `@mintplex-labs/piper-tts-web`) | Piper → WASM via Emscripten; `piper_phonemize.wasm` (espeak-ng) + onnxruntime-web |
| **therealtimex/piper-tts-web** (maintained fork) | https://github.com/therealtimex/piper-tts-web (npm `@realtimex/piper-tts-web`) | Fork of Mintplex; upgraded to ONNX Runtime 1.22.0, offline support, local WASM path config |
| **diffusionstudio/vits-web** | npm `piper-wasm`; WASM base `https://cdn.jsdelivr.net/npm/piper-wasm@1.0.0/dist/piper_phonemize` | Piper phonemizer WASM + ORT; docs at https://deepwiki.com/diffusionstudio/vits-web/4.3-audio-processing |
| **kgergooo/piper-tts-web-phonemizer** | https://github.com/kgergooo/piper-tts-web-phonemizer | Per-language splits of the 18 MB espeak-ng data blob for the Mintplex build |
| **piper-phonemize** (npm) | used by khursani8/avatar-chrome | espeak-ng WASM phonemizer packaged for browser `<script>`-tag loading |
| **offlinetts.com Piper demo** | https://offlinetts.com/app/piper/ | Live browser demo, 904-speaker LibriTTS model (~75 MB), CPU WASM, 22.05 kHz |
| **quick-tts.com** | https://quick-tts.com (blog: https://quick-tts.com/blog/web-speech-api-vs-piper-vs-kokoro.html) | Ships Piper (WASM) + Kokoro (WebGPU) + Web Speech API + Supertonic in one app; Web-Worker Piper |
| **The-Word** (Scripture reader) | https://amosroger91.github.io/The-Word/ | In-browser Piper WASM narration, dedicated worker, regression-tested |
| **avatar-chrome** | https://github.com/khursani8/avatar-chrome | No-backend avatar app; espeak-ng WASM → ONNX Runtime Web → PCM |
| **readtune** (Chrome extension) | https://github.com/engineer9118brov2/readtune | Vendored piper-tts-web + trimmed English-only espeak data (~0.94 MB); full GPL compliance docs |
| **sherpa-onnx WASM** | https://github.com/k2-fsa/sherpa-onnx | C++ runtime with WASM builds; runs Piper VITS voices; ships int8/fp16 variants; one documented Piper→browser pipeline at https://abhisarmehta.com/assets/tts-training-report.pdf |
| **sanoTTS** | https://github.com/ampixa/sanotts (npm `sanotts-web`) | Browser-native TTS reusing espeak-ng WASM phonemizer; related pipeline, not Piper voices |

---

## Verdict for FreeTTS

**STRONG** — Piper is the best-fit engine for FreeTTS's constraints, with caveats:

**Why STRONG:**
1. **Proven browser-native:** the entire pipeline (espeak-ng WASM phonemizer + onnxruntime-web VITS) already runs fully client-side in production projects — no new R&D needed; `@realtimex/piper-tts-web` or `vits-web`/`piper-wasm` are drop-in starting points.
2. **Universal compatibility:** WASM-only (no WebGPU dependency) works in every modern browser including Safari and mobile — Kokoro-class alternatives need WebGPU and fail on Safari.
3. **Free & local:** zero APIs, zero accounts, zero cost; models are static files that can be hotlinked from Hugging Face or self-hosted.
4. **Speed is a non-issue:** medium voices run at RTF 0.08–0.15 on laptop CPUs (~7–12× real-time); even Pi 4 hits RTF ~0.4. Browser WASM overhead is unmeasured but demos report single sentences "well under real-time."
5. **Language breadth:** 53 languages incl. usable voices for English, Spanish, French, German, Italian, Portuguese, Chinese, Urdu, Arabic, Hindi — with clean (CC0/PD/CC-BY) licenses available for most.

**Caveats / reasons it's not a slam-dunk:**
1. **License posture:** engine code is now **GPL-3.0** and espeak-ng (in the phonemizer WASM) is GPL-3.0 — FreeTTS must be open-source GPL-compatible with license notices + source offer (acceptable for this project, but it rules out any closed-source future). Voice weights are NOT GPL — each has its own dataset license; avoid Lessac-lineage voices as defaults and read each MODEL_CARD.
2. **Quality ceiling:** C+ / "2021-era assistant" quality; clearly synthetic on long passages. For a free accessibility/utility app this is fine; it will not match ElevenLabs/Kokoro.
3. **Weak spots in target languages:** Hindi voices all carry NC/restrictive licenses; Japanese has community voices only (no official model); Arabic's official voice has a muddy license. Non-English voices beyond the big European languages are thin (1–3 usable voices each).
4. **First-load weight:** ~30–75 MB per voice + ~10 MB ORT WASM + ~1–18 MB espeak data; needs caching strategy (IndexedDB/Cache API) and a Web Worker — solved problems, but real engineering work.
5. **Project maintenance risk:** OHF-Voice is "Looking for Maintainers" for Piper; the archived MIT `rhasspy/piper` is frozen. The voice catalog is stable regardless (static files on HF).

**Recommendation:** adopt Piper as the FreeTTS engine, default to clean-licensed voices (EN: `en_US-ljspeech-medium` or `en_US-joe-medium`; DE: `de_DE-karlsson-medium`; FR: `fr_FR-siwis-medium` or MLS; ES: MLS; IT: `it_IT-serena-high`; PT: `pt_BR-edresson-*`; ZH: `zh_CN-huayan-medium`; UR: `ur_PK-aegis-*`), ship the app itself as GPL-3.0-or-later with espeak-ng/GPL notices, lazy-load voices from self-hosted mirrors, and consider adding Kokoro later as an opt-in higher-quality WebGPU engine where supported.
