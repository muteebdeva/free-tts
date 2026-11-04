# FreeTTS — Third-Party Notices

FreeTTS is licensed under **GPL-3.0-or-later** (see `LICENSE`). This document
records the licenses of the third-party components it uses or downloads, and
why the project carries a copyleft license. (Not legal advice.)

## Why GPL-3.0-or-later?

The speech pipeline depends on `kokoro-js`, which depends on the `phonemizer`
npm package. `phonemizer` declares Apache-2.0 in its own package.json, but its
`dist/` bundle contains **eSpeak-NG compiled to WebAssembly/JavaScript**
(verified by inspecting `node_modules/phonemizer/dist/phonemizer.js`, 2026-11-04:
full Emscripten eSpeak-NG build, English language data only). eSpeak-NG upstream
is **GPL-3.0**. Serving that code to browsers counts as distribution under the
GPL, so the combined work is licensed GPL-3.0-or-later.

Two independent 2026 projects flagged the same issue (Verso, script-glow — see
`MODEL-RESEARCH.md` §1.9).

**Future option:** replacing eSpeak-NG phonemization with a clean-room /
permissively-licensed English G2P (e.g. a Misaki port, as script-glow did) would
allow relicensing the app permissively. Tracked in the roadmap; not implemented.

## Components

| Component | Version | License | Role |
|---|---|---|---|
| Kokoro-82M model weights | v1.0 (hexgrad) | **Apache-2.0** | neural TTS model (downloaded at runtime from HuggingFace) |
| Kokoro voice embeddings | v1.0 | **Apache-2.0** (bundled with model) | 28 preset voices (downloaded per voice) |
| kokoro-js | 1.2.1 | **Apache-2.0** | browser inference wrapper (npm) |
| @huggingface/transformers | 3.8.1 | **Apache-2.0** | model runtime (via kokoro-js) |
| onnxruntime-web | 1.22.0-dev | **MIT** | inference execution providers (via transformers.js) |
| phonemizer | 1.2.1 | declares Apache-2.0; **bundles eSpeak-NG (GPL-3.0)** | text → phonemes (via kokoro-js) |
| eSpeak-NG (inside phonemizer) | bundled build | **GPL-3.0** | phonemization engine — the reason this app is GPL-3.0-or-later |
| lamejs | (MP3 export) | **BSD** (LGPL-licensed MP3 tech; lamejs is a JS port) | MP3 encoding in-browser |
| Next.js / React / TypeScript | see package.json | MIT / Apache-2.0 | app framework |
| Tailwind CSS / shadcn-ui / Lucide | see package.json | MIT / ISC | styling, components, icons |

## Source availability

As required by the GPL, the complete corresponding source of FreeTTS is the
public repository itself. Build instructions are in `README.md`. No part of the
application collects user data; see `ARCHITECTURE.md` §8 and the in-app Privacy
page.

## Model weights redistribution

Kokoro-82M weights and voice embeddings are Apache-2.0 and may be downloaded and
redistributed with attribution. FreeTTS downloads them at runtime from
`huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX`; it does not bundle them.
