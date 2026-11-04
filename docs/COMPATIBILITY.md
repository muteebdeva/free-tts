# FreeTTS — Browser Compatibility

**Date:** 2026-11-04 · **Rule:** an environment is "tested" only if the
real-audio gate (or an equivalent real synthesis run) passed there. Everything
else is honestly labeled.

## Device ladder (2026-11-04, `lib/device-profile.ts`)

The app classifies once per page load; the ladder sets the DEFAULT engine and
gates what is offered — the user can always override.

| Profile | Detected as | Default engine | Kokoro policy |
|---|---|---|---|
| Performance | desktop + working WebGPU adapter | Kokoro-82M fp32 | webgpu / fp32 |
| Balanced (desktop) | desktop CPU, no adapter | Kokoro-82M q8 | wasm / q8 |
| Balanced (mobile) | capable Android (not low-memory) | **KittenTTS Nano** | wasm / q8 (opt-in) |
| Compatibility | iOS any version, or deviceMemory ≤ 2 GB | system voices | wasm / q8 / 1-thread / same-origin WASM (opt-in) |

Notes:
- iOS (any version, **including iOS 26**) is always Compatibility: iOS 26
  Safari exposes WebGPU, but the onnxruntime WebGPU EP is broken there
  (microsoft/onnxruntime#26827), so WebGPU is force-disabled on iOS in both
  the classifier and `KokoroEngine`.
- "Capable Android" defaults to KittenTTS Nano (27 MB, measured ~2.1× slower
  than real-time on CPU) instead of Kokoro q8 (92 MB) — the gated mobile
  opt-up, graduated after the real-audio gate passed (`docs/KITTEN-SPIKE.md`).
- `deviceMemory` absence (iOS, Safari, Firefox) means "unknown", never
  "capable": only an explicit ≤ 2 GB reading forces Compatibility on memory
  grounds.
- Chunk budgets: 400 / 300 / 200 chars; stream high-water: 4 / 3 / 2.
- Settings → "This device" shows the profile name + the engine's actual
  active device path (no longer a `"gpu" in navigator` presence guess).

## Ledger

| Environment | Status | Evidence |
|---|---|---|
| Chromium headless-shell 156, Linux, CPU-only (WASM) | ✅ TESTED | `scripts/verify-audio.mjs` GATE PASSED 2026-11-04; evidence in `docs/evidence/` |
| Chromium headless, Linux, CPU-only — KittenTTS Nano (WASM) | ✅ TESTED | `scripts/verify-kitten.mjs` GATE PASSED 2026-11-04; evidence `docs/evidence/kitten-verify.{wav,json}` |
| Chrome desktop (real, WebGPU) | ❌ UNTESTED | No GPU on this VM; third-party reports (Verso) suggest 4.3× RT, not verified here |
| Edge desktop | ❌ UNTESTED | Chromium-based; expected to behave like Chrome — not verified |
| Firefox desktop | ❌ UNTESTED | No WebGPU guarantee; WASM path expected to work — not verified |
| Safari desktop | ❌ UNTESTED | WASM path *may* work; SharedArrayBuffer/COOP-COEP behavior unverified |
| Android Chrome | ❌ UNTESTED | No device available |
| iPhone / iPad Safari | ❌ UNTESTED | No device available; WebGPU force-disabled on iOS (onnxruntime#26827) — WASM fallback is the only path, unverified |
| Node.js (unit tests) | ✅ TESTED | `npx vitest run` — 38/38 pass |

## Capability matrix (by design, not by test)

| Capability | Chrome/Edge | Firefox | Safari |
|---|---|---|---|
| WebGPU inference (fast) | if GPU present | limited | not available |
| WASM inference (slow, works) | yes | expected yes | expected yes (unverified) |
| System-voices fallback | yes | yes | yes |
| PWA install | yes | limited | partial |

## Known environment constraints

1. **Threaded WASM requires COOP/COEP headers** (`same-origin` /
   `require-corp`). Served by `next.config.ts` in dev and by `vercel.json` for
   Vercel. Any other host must replicate them or inference fails — see
   `docs/DEPLOYMENT.md`.
2. **Sandbox proxy vs. Chromium:** this VM's egress proxy refuses Chromium's
   CONNECT tunnels, so the headless browser cannot reach HuggingFace/jsDelivr
   directly. Verification used a same-origin model mirror
   (`app/api/verify-assets`, dev-only). Production deployments are unaffected.
3. **SharedArrayBuffer** is unavailable without the headers above; the app does
   not attempt a single-threaded fallback (onnxruntime-web ships threaded
   builds for this model path).

## What "tested" will require per environment

For each new environment: run `node scripts/verify-audio.mjs` (it launches its
own Chromium; for other browsers, adapt the Playwright `chromium.launch` call),
confirm GATE PASSED, and record the device string + timings in
`docs/BENCHMARKS.md`. Mobile/Safari runs need a real device or a cloud device
lab — not available in this session.
