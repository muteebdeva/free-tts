# FreeTTS — free, local-first AI text-to-speech in the browser

Type any text, pick a voice, and hear real AI speech synthesized **entirely on
your device**. No accounts, no API keys, no per-request fees, no text ever sent
to a TTS server.

- **Engine:** Kokoro-82M (Apache-2.0 weights) running 100% in-browser via
  `kokoro-js` + ONNX Runtime Web — WebGPU when available, WebAssembly fallback.
- **Fallback:** your device's built-in voices (Web Speech API, on-device voices
  only) — zero download, always available.
- **Exports:** WAV (16-bit PCM) and MP3, generated locally.
- **Privacy:** text never leaves your device. The only network traffic is
  one-time model/voice downloads from public CDNs. No analytics, no tracking.
- **License:** GPL-3.0-or-later (see `THIRD-PARTY-NOTICES.md` for why).

> **Honest scope (v1):** English only — 28 verified voices. The underlying model
> supports more languages, but the browser pipeline currently ships English
> phonemization only. The UI will not offer languages the engine cannot speak.
> See `MODEL-RESEARCH.md` and the roadmap below.

## Quick start

```bash
# 1. Install
npm install

# 2. Run (development)
npm run dev
# → http://localhost:3000

# 3. Production build
npm run build && npm start

# 4. Tests
npm test                # unit tests (vitest)
node scripts/verify-audio.mjs   # REAL-AUDIO GATE: headless Chromium,
                                # loads Kokoro in a worker, synthesizes speech,
                                # validates WAV bytes. Must pass before release.
```

On first Generate, the app downloads the speech model (~92 MB quantized for
CPU, ~326 MB full precision for WebGPU) and the selected voice (~0.5 MB),
then caches them in the browser. Everything after that works offline.

## Documentation

| Doc | What |
|---|---|
| `MODEL-RESEARCH.md` | per-model investigation (quality, languages, size, speed, license, browser proofs) + engine decision |
| `ARCHITECTURE.md` | system design, threading, audio pipeline, privacy architecture, decisions |
| `THIRD-PARTY-NOTICES.md` | licenses of every component; why the app is GPL-3.0-or-later |
| `docs/BENCHMARKS.md` | measured performance numbers (this machine + methodology) |
| `docs/COMPATIBILITY.md` | tested / partially tested / untested environments — honest ledger |
| `docs/TEST-REPORT.md` | unit + integration + gate results |
| `docs/DEPLOYMENT.md` | hosting the static frontend (Vercel / Cloudflare Pages) — no backend needed |

## Project layout

```
free-tts/
├── app/                  # Next.js routes (studio, voices, settings, privacy)
├── components/           # UI components
├── engines/              # TTSEngine implementations
│   ├── engine-interface.ts
│   ├── kokoro/           # Kokoro-82M (primary)
│   └── system/           # Web Speech API fallback
├── workers/              # tts.worker.ts — inference off the main thread
├── audio/                # wav-encoder, mp3-export, concat/de-click, utils
├── lib/                  # engine-manager, text-chunk, device detection
├── tests/                # vitest unit tests
├── scripts/              # verify-audio.mjs (real-audio gate)
└── docs/                 # research archive, benchmarks, compatibility
```

## Roadmap

1. **Multilingual Kokoro** — custom G2P glue (`generate_from_ids` + full-language
   eSpeak-NG WASM, cf. slicc PR #1170) to unlock the model's ES/FR/HI/IT/PT voices
   in-browser. Requires per-language pronunciation verification before any UI claims.
2. **Piper engine** — universal WASM fallback (Safari, no-WebGPU devices).
3. **Clean-room English G2P** — replace eSpeak-NG to allow permissive relicensing.
4. **Chatterbox "clone mode"** — opt-in zero-shot cloning (1.5 GB, WebGPU-only).
5. **Phonon evaluation** — pending independent benchmarks.

## Known limitations (v1)

- English only; 28 voices (see `engines/kokoro/voices.ts`).
- CPU-only devices synthesize slower than real time — the UI says so and offers
  system voices instead of pretending.
- Long-form output concatenates independently synthesized sentences; tiny
  prosodic seams are possible (no "seamless" claims).
- Browsers may evict cached models under storage pressure; the app discloses this.
- Voice cloning is not supported.

## Contributing

Issues and PRs welcome. If you add an engine, implement `TTSEngine`, declare
honest `capabilities`, add it to the worker, and extend the verification gate —
no mock audio, ever.
