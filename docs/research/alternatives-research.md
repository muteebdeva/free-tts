# FreeTTS Alternatives Track — Research Report
**Date:** 2026-11-04 | **Researcher:** subagent (alternatives track) | **Status:** web-verified, Nov 2026

> Scope: free, local-first TTS where inference runs entirely in the user's browser — no paid APIs, no accounts, zero budget. All licenses checked; speculation is explicitly marked **[spec]**.

---

## TL;DR — Ranked candidates

| Rank | Model | Size / download | License | Languages | Browser status (verified) | Verdict |
|---|---|---|---|---|---|---|
| 1 | **Kokoro-82M** (hexgrad) | 82M params; 86–326 MB (q8/fp32) | Apache 2.0 | 9 (EN×2, ES, FR, HI, IT, JA, PT-BR, ZH) | ✅ Mature: `kokoro-js` + Transformers.js, WebGPU + WASM | **Default engine.** Best quality-per-MB browser TTS in existence; permissive license; streaming built in |
| 2 | **Phonon 31m-en** (Gradium, rel. Oct 21 2026) | 31M; 64.5 MB q8 | Apache 2.0 | English only | ✅ Real: npm `phonon-tts`, Rust→WASM, 24 kHz | **Strongest NEW contender** for low-latency/small download. Caveat: 2 weeks old, no independent benchmarks yet |
| 3 | **Chatterbox** English (Resemble AI) | 0.5B; ~1.5 GB ONNX | MIT (code+weights) | English (ONNX); 23–25 in PyTorch Multilingual V3 | ✅ Real: Transformers.js v4 + official Resemble browser demo; ~5–10 s output cap per call; WebGPU required | **Premium/cloning tier.** Zero-shot voice cloning in-browser works; heavy download + output cap make it a "clone mode," not a default |
| 4 | **Web Speech API** `speechSynthesis` | 0 bytes | Built-in | OS/browser-dependent | ✅ Universal | **Legitimate instant fallback** (zero download). Must filter `localService===true` voices to stay offline/private |
| 5 | **Supertonic 3** (Supertone) | 66–99M | MIT code / OpenRAIL-M weights | 31 (v3, Apr 2026) | ✅ transformers.js pipeline, WebGPU+WASM, very fast | Niche: fast multilingual alt, but OpenRAIL-M weights carry use-restrictions and fixed voice |
| 6 | **Kitten TTS Nano** | 15M; ~24 MB | Apache 2.0 | English | ✅ transformers.js, WebGPU (FP32) + WASM | Lightest option; quality C+; good for low-end/mobile fallback |
| 7 | **Piper** (VITS) | ~25–60 MB/voice | **GPL-3.0 code since v1.3.0** (was MIT) | EN-focused, 30+ incl. multilingual | ✅ WASM-only (no WebGPU), works in Safari | Universal Safari fallback; mind the 2025 license change (copyleft runtime) |
| 8 | **Chatterbox Multilingual V3** | 0.5B | MIT | 21 + 4 dialects = 25 | ⚠️ Raw ONNX exists (`onnx-community/chatterbox-multilingual-ONNX`); **not confirmed loadable by Transformers.js** | Python/PyTorch-native is fine; browser status unverified — do not advertise as browser-ready |

**Excluded (licensing):** Coqui XTTS-v2 (CPML non-commercial), F5-TTS (CC-BY-NC-4.0 weights), Fish Audio / OpenAudio S1 (non-commercial weights), OuteTTS-0.2-500M (CC-BY-NC-4.0), Phonon 40M variants (CC BY-NC), VibeVoice (research-only framing, code pulled).
**Excluded (no browser port):** Sesame CSM-1B, Dia, Zonos, Orpheus 3B, CosyVoice 3, MeloTTS (no polished port), Bark (no transformers.js/ONNX port found), Qwen3-TTS (~0.6B, one community experiment only).

---

## 1. Chatterbox (Resemble AI)

### Facts (verified)
- **Multilingual V3** released **June 10, 2026** — flagship: 0.5B-parameter Llama backbone, **25 languages total (21 base + 4 dialects: BR/PT-PT Portuguese, LatAm/ES Spanish)**; trained on 36.7k hours of multilingual data (up from 25.6k in v2). ([localaimaster.com/blog/chatterbox-multilingual-v3](https://localaimaster.com/blog/chatterbox-multilingual-v3), crawled 2026-11-03; HF model card revision 5bb1f6ee58e5, first published 2025-04-24, last updated 2026-06-10)
- **License: MIT — both code and weights** (checked against repo LICENSE + model card Oct 2026). Permits commercial use, modification, redistribution. ([femaleswitch.com](https://www.femaleswitch.com/directories/tpost/open-source-voice-cloning-tools), Oct 2026)
- **Zero-shot voice cloning** from 5–10 s reference clip; cross-language cloning in the multilingual variant; emotion-exaggeration control (`exaggeration` param), CFG tuning; Turbo variant (350M, English-only, Dec 2025) adds paralinguistic tags `[laugh]`/`[cough]`; Nano variant (110M, English) claimed by Resemble to run ~3× real-time on an 8-core CPU. ([voice-agent-next research doc, 2026-09-24](https://github.com/kadirnar/voice-agent-next/blob/HEAD/docs/research/03-stt-tts-llm-landscape.md))
- **Every output carries Resemble's PerTh imperceptible watermark by default** (detectable with an open script). Not a license restriction, but disclose it — users' cloned outputs are identifiable. (Model card; localaimaster)
- Note: Resemble AI has reportedly pivoted the *business* to deepfake detection; the open models remain MIT-licensed. (femaleswitch, Oct 2026)

### Browser feasibility — VERIFIED: real, but constrained
- **Transformers.js v4 (2026, npm `@huggingface/transformers`) added Chatterbox as a supported architecture** (rewritten C++ WebGPU runtime built with the ONNX Runtime team). ([github.com/NeoVand/voicebook research, Jul 2026](https://github.com/neovand/voicebook/blob/HEAD/references/TTS_models_Claude_Deep_Research.md))
- **`onnx-community/chatterbox-ONNX` (English)** is the browser-ready checkpoint; there is an **official Resemble AI browser demo** `resemble-ai/transformersjs-chatterbox-demo` (a 100%-in-browser Chatterbox demo was also publicized Feb 16 2026 via [livetok](https://livetok.substack.com/p/weekly-updates-feb-16th-2026)). Real-world browser projects: `m96-chan/voxshot` ships a `ChatterboxEngine` on Transformers.js v4 with WebGPU + WASM fallback, reference-audio cloning, voice persistence. ([github.com/m96-chan/voxshot/commit/29248de](https://github.com/m96-chan/voxshot/commit/29248de75adbeb7eeb146a627969c5089a09fd9d), [voxshot CHANGELOG](https://github.com/m96-chan/voxshot/blob/HEAD/CHANGELOG.md))
- **Constraints (from the voxshot engineering notes, which are the most battle-tested source):**
  - ~1.5 GB download (4 ONNX sessions: `embed_tokens`, `speech_encoder`, `language_model` q4/q4f16, `conditional_decoder`); quantized variants keyed by device (`q4f16` WebGPU, `q4` WASM).
  - **`max_new_tokens: 256` caps output to ~5–10 s per call** — heavy sentence-chunking is mandatory; not a whole-paragraph narrator.
  - No paralinguistic tags in the ONNX port.
  - WebGPU-class hardware needed for usable speed; **voxshot measured ~5.8× slower than real time on CPU** — "not a degraded experience but a broken one."
  - First-run download UX is delicate (partial-cache stalls; needs cache pre-warming + Web Worker).
- **Multilingual in browser: NOT confirmed.** `onnx-community/chatterbox-multilingual-ONNX` exists (4 ONNX sessions, HF usage docs are Python `onnxruntime` scripts — verified by reading the HF page 2026-11-04). Voxshot (Jul 2026) reported the multilingual checkpoint "not loadable straight from the Hub (missing the configs Transformers.js needs)" and missing classifier-free-guidance support in Transformers.js. One third-party site ([voicechanger.live](https://voicechanger.live/text-to-speech/models/chatterbox-multilingual), crawled 2026-11-04) claims "official ONNX export in the transformers.js ecosystem" — **unresolved conflict; treat browser-readiness of the multilingual variant as unverified until someone runs it in a tab.**
- **Zero-shot cloning in-browser: feasible** — the speech-encoder session runs client-side on the reference clip; voxshot's `cloneVoice()` path does exactly this. Privacy story is excellent (reference audio never leaves the device).

### License + redistribution
- MIT for code AND weights → can be bundled, redistributed, used commercially. Redistribution requirement: keep the copyright/permission notice. The PerTh watermark rides along — technically neutral for the project's goals.

---

## 2. Google AI Edge / on-device TTS

### Headline: **Google offers no public on-device TTS model or web TTS API.** The ecosystem is inference *runtimes*, not speech models.

**What exists (verified):**
- **Google AI Edge** = LiteRT (ex-TensorFlow Lite, repo `google-ai-edge/LiteRT`), LiteRT-LM (on-device LLM runtime; Chrome has a flag `#on-device-model-litert-lm-backend` that is *disabled by default*), MediaPipe GenAI tasks. These are plumbing for *your* models, not a TTS offering. "TTS" appears in LiteRT-LM roadmaps only as LLM-for-speech pipelines (e.g. Gemma generating text for a voice demo — the Reachy Mini/Pi 5 demo used a TTS component, but it wasn't a Google-published TTS model). ([developers.googleblog.com, Aug 11 2026](https://developers.googleblog.com/mastering-edge-ai-on-raspberry-pi-with-litert-and-gemma/); [wally.network newsletter 2026-W30](https://www.wally.network/newsletter/2026-W30.html))
- **Chrome's built-in AI (as of Oct 2026):** Prompt API (`LanguageModel`, Gemini Nano, stable on web since Chrome 148 / May 2026), Summarizer, Translator, Language Detector (stable), Writer/Rewriter/Proofreader (in development). **All are text-in/text-out — there is no built-in TTS/audio-output API**, and Gemini Nano's text outputs are limited to English/Japanese/Spanish/German/French. ([dev.to, Oct 22 2026](https://dev.to/kenyalba/chromes-prompt-api-is-stable-on-device-ai-for-your-website-no-api-key-and-no-per-token-bill-555e); [adsm.dev, May 2026](https://adsm.dev/posts/prompt-api/)). Gemini Nano is also proprietary, not open-weight, and requires high-end desktop hardware (~4 GB download, 22 GB free disk) — useless as a FreeTTS engine even conceptually.
- **OS-level TTS ≠ web-usable:** Android `TextToSpeech` and iOS `AVSpeechSynthesizer` are native APIs for apps — a web page can only reach them through the Web Speech API layer (see §3). Android docs/guides route web developers to system voices, not to an on-device ML model. ([irurueta.com Android AI guide, 2026-09-30](https://www.irurueta.com/ai/hugging-face/android.html))
- **ML Kit GenAI APIs** (Android) cover summarization/proofreading/rewriting — no TTS. Gemini Nano on Android goes through AICore for *apps*, not web pages.

**Bottom line for FreeTTS:** there is no "just call Google's on-device TTS from my web app" path. The viable on-device paths are (a) Web Speech API system voices (§3), or (b) shipping an open model in the tab via onnxruntime-web/Transformers.js/WASM (§1, §4). **[spec]** Google could plausibly ship a built-in TTS model API later, but as of Nov 2026 none exists even as an origin trial.

---

## 3. Web Speech API (`speechSynthesis`)

### Real properties (verified Oct 2026)
- **Universally available, zero cost, zero download.** `speechSynthesis` works in every current major browser (Chrome 33+, Edge 14+, Firefox 49+, Safari 16+ for `voiceschanged`; mobile too). No keys, no accounts. ([textintoaudio.com browser support, updated 2026-10-04](https://textintoaudio.com/browser-support); [micdrop.dev, Oct 29 2026](https://micdrop.dev/blog/text-to-speech-javascript))
- **It is a thin wrapper around OS/browser voices — you cannot ship a voice.** `getVoices()` returns OS-installed voices **plus browser-vendor additions**; voice names/URIs are not consistent across devices, and the list arrives **asynchronously** (empty on first call in Chrome; listen for `voiceschanged`). The spec explicitly permits an empty list. ([lunchboxhands.com, Sep 2026](https://lunchboxhands.com/blog/browser-text-to-speech-voices/))
- **Privacy catch: Chrome's network voices.** Desktop Chrome injects Google "network" voices (`localService === false`) — **your text is sent to Google's servers for synthesis**, which breaks the project's offline/privacy story. Edge does the same with Microsoft "Online (Natural)" voices (Edge-only). Filter on `voice.localService === true` to keep synthesis on-device. Firefox shows local voices only. ([micdrop.dev, Oct 2026](https://micdrop.dev/blog/text-to-speech-javascript); [lunchboxhands.com](https://lunchboxhands.com/blog/browser-text-to-speech-voices/))
- **Chrome network voices silently truncate ~15 s of continuous speech** (decade-old Chromium bug, no error/`end` event) — long text must be chunked regardless of engine. ([textintoaudio.com](https://textintoaudio.com/browser-support))
- **Quality varies wildly** — Apple platforms have strong local voices; Windows/Linux quality is modest; language coverage = whatever the OS has installed. No voice identity across devices (a name on macOS ≠ a name on Android).
- **`speak()` requires user activation** (since Chrome M71, anti-abuse) — fine for a TTS app's play button.
- **Word-boundary events are unreliable** (Safari fires them per-sentence; Android Chrome not at all) — limits karaoke-style highlighting. ([slickG0ose/storybook spec, Aug 2026](https://github.com/slickg0ose/storybook/blob/HEAD/.code-captain/specs/read-aloud/spec.md))
- The Web Speech API is still a **Draft Community Group Report, not a W3C standard** — behavior drift between browsers is expected. ([micdrop.dev STT article](https://micdrop.dev/blog/web-speech-api))
- MDN reference: [SpeechSynthesis](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis) — documents `getVoices()`, `voiceschanged`, and that Chrome fetches voices asynchronously; the `localService` flag is defined in the spec.

### Verdict as fallback engine
**Legitimate and recommended as a tier-0 fallback:** instant, offline-capable (with local voices), multilingual-ish depending on the device, zero bytes. Ship it behind a voice picker that prefers `localService === true` voices matching the document language, and chunk utterances to dodge the 15-s truncation. It cannot be the *only* engine (inconsistent quality/identity, some devices have no local voices — e.g. bare Linux), but it guarantees "it always speaks something."

---

## 4. Other candidates — one-paragraph verdicts

- **Kokoro-82M (hexgrad)** — ✅ The browser gold standard: 82M params, Apache 2.0, 54 voices / 9 languages, `kokoro-js` + Transformers.js (WebGPU fp32 ~326 MB, WASM q8 ~92 MB), 24 kHz, 512-token context, `TextSplitterStream` for sentence streaming. Elo ~1060 (Speech Arena) — best-in-class quality-per-MB, though weaker on non-English and no voice cloning. ([voicebook research, Jul 2026](https://github.com/neovand/voicebook/blob/HEAD/references/TTS_models_Claude_Deep_Research.md); [sandbook.app, verified Oct 10 2026](https://sandbook.app/kokoro-tts-online))
- **Phonon 31m-en (Gradium, released Oct 21 2026)** — ✅ The newcomer to watch: 31M params (6-layer transformer), **64.5 MB q8 GGUF**, Apache 2.0, **npm `phonon-tts` runs fully in-browser via Rust→WASM** (WebGPU optional; CPU generation on 1–3 threads), 24 kHz, streams 80 ms chunks, 30–100 ms first audio (vendor, M2). English-only for the Apache-licensed weights; the 40M multilingual variants (FR/DE/ES/PT + multilingual) are **CC BY-NC (non-commercial)** and HF-gated. ([marktechpost, Oct 22 2026](https://www.marktechpost.com/2026/10/22/gradium-phonon-31m-on-device-tts/?amp=1); [alphasignal.ai, Oct 2026](https://alphasignal.ai/news/gradium-s-phonon-runs-text-to-speech-in-browsers-at-under-75-mb); [micdrop.dev, Oct 2026](https://micdrop.dev/blog/on-device-ai-voice-agent))
- **Supertonic 3 (Supertone)** — ✅ Browser-feasible: 66M (v2) / ~99M (v3), official transformers.js `text-to-speech` pipeline, WebGPU + WASM, vendor-claimed RTF ≈ 0.006 (~167× real-time), v3 (Apr 2026) covers **31 languages**, strong text normalization. Caveat: **sample code MIT but weights are OpenRAIL-M** (use-restrictions apply — read before shipping), fixed voice, quality B-tier vs Kokoro/Chatterbox. ([voicebook, Jul 2026](https://github.com/neovand/voicebook/blob/HEAD/references/TTS_models_Claude_Deep_Research.md); [sokuji integration doc](https://github.com/kizuna-ai-lab/sokuji/blob/HEAD/docs/SHERPA_ONNX_INTEGRATION.md))
- **Kitten TTS Nano (KittenML)** — ✅ Browser-feasible and the smallest serious option: 15M params, ~24 MB, **Apache 2.0**, English, transformers.js (use FP32 build for WebGPU; int8 "Mini" lacks WebGPU quantized ops). Quality C+ — good enough as a low-end/mobile tier, not a flagship. ([voicebook, Jul 2026](https://github.com/neovand/voicebook/blob/HEAD/references/TTS_models_Claude_Deep_Research.md))
- **Piper (VITS)** — ✅ The universal WASM fallback: ~25–60 MB per voice, runs 3–5× real-time on CPU, works in Safari (no WebGPU needed), ~904 LibriTTS voices, English-focused with multilingual voices available. ⚠️ **License changed: code is GPL-3.0-or-later since v1.3.0 (July 2025), no longer MIT** — copyleft; bundling the runtime triggers GPL obligations (weights via ONNX + your own runtime is a cleaner path). ([promptquorum, Jun 2026](https://www.promptquorum.com/power-local-llm/local-tts-voice-cloning-piper-coqui-xtts); [speakloop research, May 2026](https://github.com/ehsankolivand/speakloop/blob/HEAD/doc/research_tts.md))
- **Parler-TTS** — Apache 2.0 and officially supported in Transformers.js with ONNX exports (prompt-described voices, e.g. "a calm female voice"). Browser-feasible in principle, but Mini is **~880M params** — impractical for tab download/inference; Large is 2.2B. Verdict: skip for browser. ([voicebook, Jul 2026](https://github.com/neovand/voicebook/blob/HEAD/references/TTS_models_Claude_Deep_Research.md))
- **Coqui XTTS-v2** — ❌ CPML (Coqui Public Model License), **non-commercial**, no resolved ONNX export, no browser port. Also un-licensable commercially since Coqui Inc. shut down (Jan 2024). Skip. ([promptquorum, Jun 2026](https://www.promptquorum.com/power-local-llm/local-tts-voice-cloning-piper-coqui-xtts))
- **F5-TTS (SWivid)** — ⚠️ Code MIT, **weights CC-BY-NC-4.0 (non-commercial)**. Technically one browser demo exists ([nimasarang.com](https://nimasarang.com), DakeQQ ONNX export, Sept–Nov 2025) with zero-shot cloning, but ~700 MB, degrades past ~20 s, and the NC weights kill redistribution. Skip for a public tool. ([sourdaw research, 2026-Q1](https://github.com/jcosta33/sourdaw/blob/HEAD/.agents/specs/audio-generation-browser/research.md); [speakloop, May 2026](https://github.com/ehsankolivand/speakloop/blob/HEAD/doc/research_tts.md))
- **Fish Speech / OpenAudio (Fish Audio)** — ❌ Current weights are **CC-BY-NC-SA / research-only** (S2 Pro non-commercial); PyTorch/server-only, no browser port. Skip. ([voicebook, Jul 2026](https://github.com/neovand/voicebook/blob/HEAD/references/TTS_models_Claude_Deep_Research.md); [femaleswitch, Oct 2026](https://www.femaleswitch.com/directories/tpost/open-source-voice-cloning-tools))
- **Sesame CSM-1B** — Apache 2.0 (gated) but PyTorch/CUDA-only, no browser port; conversational model, ~1B. Skip for browser. ([voicebook, Jul 2026](https://github.com/neovand/voicebook/blob/HEAD/references/TTS_models_Claude_Deep_Research.md))
- **Bark (suno)** — MIT license, but **no transformers.js/ONNX browser port found** (community bark.cpp only), ~1 GB+, quality dated vs 2026 models. Skip. (Absence-of-evidence claim — worth one more check if Bark becomes relevant.)
- **StyleTTS 2** — Code MIT but **weights carry a custom synthesis-disclosure condition**; upstream research-stale since Aug 2024; no browser port; old dependency on a GPL phonemizer. Kokoro already packages the good parts (StyleTTS2 architecture) in Apache 2.0. Skip. ([femaleswitch, Oct 2026](https://www.femaleswitch.com/directories/tpost/open-source-voice-cloning-tools))
- **OuteTTS-0.2-500M** — Browser-feasible (Xenova's WebGPU demo) but **CC-BY-NC-4.0**. Skip. ([voicebook, Jul 2026](https://github.com/neovand/voicebook/blob/HEAD/references/TTS_models_Claude_Deep_Research.md))
- **Orpheus 3B (Canopy)** — Apache 2.0 code but weights under Llama 3.2 Community License; 3B, no ONNX/browser port. Skip. ([speakloop, May 2026](https://github.com/ehsankolivand/speakloop/blob/HEAD/doc/research_tts.md))
- **Qwen3-TTS (Alibaba)** — Apache 2.0, ~0.6B, multilingual, ~97 ms first-audio (vendor claim); exactly one community browser experiment (voxshot's `miotts` demo on WebGPU). Unproven; monitor. ([voice-agent-next, Sep 2026](https://github.com/kadirnar/voice-agent-next/blob/HEAD/docs/research/03-stt-tts-llm-landscape.md); [voxshot CHANGELOG](https://github.com/m96-chan/voxshot/blob/HEAD/CHANGELOG.md))
- **Kyutai Pocket TTS** — 100M, **CC-BY-4.0 (voices vary)**, EN/FR/DE/PT/IT/ES, has Rust/WASM ports, ~200 ms first chunk. Decent attribution-licensed alt; Phonon (built on Kyutai lineage) supersedes it for browser use. ([voice-agent-next, Sep 2026](https://github.com/kadirnar/voice-agent-next/blob/HEAD/docs/research/03-stt-tts-llm-landscape.md))
- **MeloTTS** — MIT, VITS, ONNX-convertible and runnable via onnxruntime-web/sherpa-onnx in principle, but no polished browser demo found. Skip as an engine choice. ([voicebook, Jul 2026](https://github.com/neovand/voicebook/blob/HEAD/references/TTS_models_Claude_Deep_Research.md))
- **CosyVoice 3 (Alibaba/FunAudioLLM)** — Apache 2.0, 9 languages, strong zero-shot cloning, but server-side PyTorch only, no browser port. Revisit only if an ONNX export appears. ([femaleswitch, Oct 2026](https://www.femaleswitch.com/directories/tpost/open-source-voice-cloning-tools))
- **VibeVoice (Microsoft)** — MIT weights but Microsoft framed it "research only" and pulled the TTS code over misuse concerns. Red flag; skip. ([voicebook, Jul 2026](https://github.com/neovand/voicebook/blob/HEAD/references/TTS_models_Claude_Deep_Research.md))

### The sherpa-onnx alternative stack (worth knowing)
`sherpa-onnx` (k2-fsa, Apache 2.0 toolkit) compiles to **WASM via Emscripten** and ships an offline TTS runtime covering VITS, Matcha, Kokoro, ZipVoice, PocketTTS, Supertonic, Kitten (v1.13.8, Oct 2026). ([deepwiki sherpa-onnx](https://deepwiki.com/k2-fsa/sherpa-onnx/4.1-build-configuration); [sokuji integration doc](https://github.com/kizuna-ai-lab/sokuji/blob/HEAD/docs/SHERPA_ONNX_INTEGRATION.md)). It is the most proven **WASM-CPU** path (Safari-safe), but it's heavier integration work than kokoro-js/phonon-tts and phonemizer/voice assets must be packed per model. Use if the app needs maximum Safari compatibility without WebGPU.

---

## 5. Deep dives: the two strongest alternatives

### A. Kokoro-82M — the default engine
- **Model size:** ~82M parameters. **Memory:** fp32 ≈ 326 MB download (~1.3 GB RAM working set is typical for ONNX Runtime Web **[spec — verify in-browser]**), q8 ≈ 92 MB, q8f16 ≈ 86 MB, q4 ≈ 154 MB. **Quantization:** fp32 / q8 / q8f16 / q4 ONNX builds published at `onnx-community/Kokoro-82M-v1.0-ONNX`.
- **Browser implementations:** `kokoro-js` npm (Xenova/HF, Apache 2.0) on `@huggingface/transformers`; live reference apps: [sandbook.app/kokoro-tts-online](https://sandbook.app/kokoro-tts-online) (verified Oct 10 2026, 41 voices), `rhulha/StreamingKokoroJS`, `Cabeda/audiobook-generator` (EPUB/PDF, MIT), `epubplayer.com`. WebGPU recommended with `dtype:"fp32"`; WASM fallback `dtype:"q8"`. Inference in a Web Worker, model cached in IndexedDB/Cache API, HTTPS required (COOP/COEP for WASM multithreading).
- **License + redistribution:** **Apache 2.0** (weights + code) — commercial-safe, redistributable; attribution required. Caveat: kokoro-js pulls eSpeak-NG (GPL-3.0) for non-English phonemization in some builds — sandbook ships it; keep the dependency boundary clean if that matters.
- **Limits:** 512-token context window (510 usable) → sentence-chunking required; 54 voices but fixed set (no user voice cloning); weaker non-English prosody vs native-language models; known quirk with isolated words.

### B. Chatterbox (English ONNX) — the cloning/premium tier
- **Model size:** 0.5B Llama backbone + S3 speech-token codec + conditional decoder; browser bundle **~1.5 GB** across 4 ONNX sessions (`embed_tokens`, `speech_encoder`, `language_model` q4f16-on-WebGPU / q4-on-WASM, `conditional_decoder`). **Memory:** needs WebGPU-class GPU + ~8 GB system RAM per third-party integration notes; CPU WASM is ~5.8× slower than real-time (unusable). **Quantization:** q4 / q4f16 language-model variants shipped by onnx-community.
- **Browser implementations:** official demo `resemble-ai/transformersjs-chatterbox-demo` (Transformers.js v4); community engine `m96-chan/voxshot` `ChatterboxEngine` (npm `zerovox`, zero-shot clone + voice persistence + worker offload); AssemblyAI publicized an in-browser Chatterbox demo (Feb 2026). **Multilingual ONNX exists** (`onnx-community/chatterbox-multilingual-ONNX`, verified 2026-11-04) but only as raw ONNX + Python scripts — **not confirmed working under Transformers.js** (missing configs per voxshot, Jul 2026).
- **License + redistribution:** **MIT (code and weights)** — the cleanest license of any cloning model; only requirement is preserving the copyright/permission notice. **Every output is PerTh-watermarked** — a product decision, not a blocker.
- **Limits:** `max_new_tokens: 256` → ~5–10 s per synthesis call (sentence chunking mandatory); ~1.5 GB first download; WebGPU effectively required; no paralinguistic tags in the ONNX port.

### Honourable mention: Phonon 31m-en
Included above because it is **the smallest Apache-2.0 model with a production browser package** (65 MB, npm `phonon-tts`, 30–100 ms first audio, streaming) — released Oct 21 2026, so independent quality benchmarks don't exist yet. If its quality holds up, it is arguably the best *mobile* tier for FreeTTS (WASM, works offline, tiny). Verify quality on real voices before committing.

---

## 6. Caveats & what still needs verification
1. Chatterbox-multilingual-ONNX browser status is the biggest open question (conflicting sources; needs a real tab test).
2. Phonon is 2 weeks old — no independent MOS/benchmark data; Gradium's 30–100 ms / quality claims are vendor claims.
3. In-browser RAM figures are estimates from community notes, marked **[spec]** where stated.
4. Voice-count claims for Phonon vary (37 vs 102 across Gradium materials and press) — omitted from verdicts.
5. Piper's GPL-3.0 change (v1.3.0, Jul 2025) and eSpeak-NG's GPL-3.0 in some kokoro-js builds need a lawyer's glance before bundling, not a blocker for linking-at-runtime architectures.

## Primary sources consulted (all accessed 2026-11-04)
- HF: `onnx-community/chatterbox-ONNX`, `onnx-community/chatterbox-multilingual-ONNX` (page read directly), ResembleAI/chatterbox model card (rev 5bb1f6ee58e5)
- localaimaster.com (Chatterbox Multilingual V3, Aug 2026; ElevenLabs alternatives, Aug 2026), femaleswitch.com (Oct 2026 license audit), voicebook TTS research (Jul 2026), micdrop.dev (Oct 2026, on-device AI + Web Speech + Phonon), sandbook.app (Oct 2026), marktechpost (Oct 22 2026), alphasignal.ai (Oct 2026), dev.to Prompt API status (Oct 22 2026), adsm.dev (May 2026), voice-agent-next (Sep 2026), voxshot/zerovox repo (Jul 2026), sherpa-onnx deepwiki (Oct 2026), speakloop (May 2026), promptquorum (Jun 2026), textintoaudio.com (Oct 2026), lunchboxhands.com (Sep 2026), developers.googleblog.com (Aug 2026)
