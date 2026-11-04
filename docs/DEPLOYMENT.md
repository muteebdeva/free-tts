# FreeTTS — Deployment Guide

FreeTTS is a frontend-only app: 100% of synthesis happens in the visitor's
browser (Kokoro-82M via onnxruntime-web). **There is no backend to deploy.**
The only deployment requirements are: serve the static/Next.js app, and
preserve the two cross-origin headers that threaded WASM needs.

## 1. The non-negotiable headers

Threaded WebAssembly (`onnxruntime-web`, used by kokoro-js) requires
`SharedArrayBuffer`, which browsers only enable under cross-origin isolation.
**Every deployment must send these two headers on every page:**

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without them, model inference silently fails and the app is broken. They are
set in `next.config.ts` (`headers()`), mirrored in `vercel.json`, and must be
replicated on any other host (see the Cloudflare Pages section below).

> COEP note: under `require-corp`, any cross-origin asset loaded by the page
> (model weights, WASM, fonts) is blocked unless the *responding* server sends
> `Cross-Origin-Resource-Policy: cross-origin` (or `same-site`). This is one
> reason to self-host model files on the same origin (see §6).

## 2. Deploy on Vercel (recommended, zero config)

1. Push the repo to GitHub and import it in the Vercel dashboard
   ("Add New → Project"), or run `vercel` from this directory.
2. Accept the defaults (framework preset: Next.js). No build settings changes
   are needed.
3. Done. Headers come from `next.config.ts` + `vercel.json`; the `/_next/static/*`
   long-cache rule is in `vercel.json`.
4. Verify after deploy: open DevTools → Network, reload, confirm the response
   headers include `cross-origin-opener-policy: same-origin` and
   `cross-origin-embedder-policy: require-corp`. Then generate speech once —
   if inference starts, the headers are correct.

The `/api/verify-assets` route is a dev/test-only model mirror: it returns 404
unless `FREETTS_VERIFY_ASSETS=1` is set. **Never set that variable in
production.**

## 3. Deploy on Cloudflare Pages

This app is a standard Next.js App Router build. Two paths:

### Option A — Vercel-style via Cloudflare's Next.js support (recommended)

Cloudflare supports Next.js apps on Pages/Workers with the official adapter.
Follow the current Cloudflare docs for deploying a Next.js app
(developers.cloudflare.com/pages/framework-guides/nextjs). This path keeps
`next.config.ts` headers and the `/api/verify-assets` route working as in dev.

### Option B — pure static export

Add `output: "export"` to `next.config.ts` and deploy the `out/` directory as
a static Pages site. Caveats:

- The dev-only `/api/verify-assets` route must stay behind its env gate (it
  already 404s without `FREETTS_VERIFY_ASSETS=1`; do not set that variable in
  production).
- `next.config.ts` `headers()` are **not** applied to static exports, so the
  COOP/COEP headers must be set via a `_headers` file placed in `public/`
  (Pages copies `public/` into the output). Contents:
  ```
  /*
    Cross-Origin-Opener-Policy: same-origin
    Cross-Origin-Embedder-Policy: require-corp
  ```
- Long-caching for versioned assets:
  ```
  /_next/static/*
    Cache-Control: public, max-age=31536000, immutable
  ```

## 4. PWA: manifest, icons, service worker

- `public/manifest.webmanifest` — name/short_name "FreeTTS", `display:
  "standalone"`, dark-slate theme/background (`#0f172a`), start_url `/`.
- `public/icons/icon.svg` — original icon (mic capsule + soundwave bars).
- `public/sw.js` — hand-rolled service worker: network-first navigations,
  stale-while-revalidate for `/_next/static/*` and icons, network-only for
  `/api/verify-assets`, model downloads bypass it (transformers.js already
  caches weights in Cache API / IndexedDB).
- `app/layout.tsx` must add: the `<link rel="manifest">`, `theme-color`
  metadata, and the `navigator.serviceWorker.register("/sw.js")` call —
  exact snippet is owned by the coordinator (see the subagent handoff report).

**Icon gap (honest):** only the SVG icon exists. No rasterizer was available
on the build machine (`rsvg-convert`, `convert`, `magick` all absent), so the
192/512 PNG and maskable PNG entries are not generated. Android
installability prompts require a 144px+ PNG icon; before shipping, generate
PNGs from `public/icons/icon.svg` (e.g.
`rsvg-convert public/icons/icon.svg -w 512 -o public/icons/icon-512.png`)
and add to the manifest:
```json
{ "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
{ "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
{ "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
```

## 5. Free-tier limits (verified via web search, Nov 4 2026)

Limits change — re-check the providers' own docs before launch.

### Vercel — Hobby (free)

- **Bandwidth:** first 100 GB/month "Fast Data Transfer" included
  (Vercel Hobby docs; summarized by Convika and Sofast, checked Oct 23 / Sep
  2026). Plus first 10 GB "Fast Origin Transfer" and first 1,000,000 CDN
  requests per month.
- **Overage behavior:** no billing on Hobby — the feature pauses until ~30
  days pass (Vercel Hobby plan docs, updated Sep 14 2026, via Convika).
- **Non-commercial use only** (fair-use guidelines). Costbench (checked Oct
  29 2026) lists the same 100 GB figure.
- What this means for FreeTTS: the app shell is tiny; the cost driver is
  model/voice downloads **if** self-hosted on the same origin (§6). The q8
  model is ~92 MB, so 100 GB ≈ ~1,080 full model downloads per month per
  visitor pool. Default setup loads models from HuggingFace's CDN, which
  does *not* count against Vercel bandwidth (see §6 for why self-hosting
  changes that math).

### Cloudflare Pages — Free

- **Bandwidth and static requests: unlimited** — not metered, never billed
  (Cloudflare Pages product page; summarized by DevToolReviews and
  QuickGainsHub, checked Oct 2026; Cloudflare Pages limits docs, updated
  Sep 5 2026).
- **Builds:** 500/month, 1 concurrent, 20-minute timeout
  (Cloudflare Pages limits docs, updated Sep 5 2026).
- **Files:** 20,000 files per site, 25 MiB per file; 100 projects per
  account; 100 custom domains per project (same sources).
- **Pages Functions:** share the Workers Free quota (100,000 req/day) —
  irrelevant here; FreeTTS has no serverless functions in production.
- What this means for FreeTTS: Pages is the cheaper host if models are
  self-hosted on the same origin, because unlimited bandwidth absorbs the
  ~92 MB downloads. The 25 MiB-per-file cap matters: the q8 model (~92 MB)
  would need chunking or a different host (e.g. R2) to live on Pages.

Sources (all figures summarized from provider docs by these guides):
- Vercel limits: https://convika.com/compare/vercel-hobby-limits/ (checked
  Oct 23 2026); https://www.sofast.host/blog/is-vercel-free/ (checked Sep
  2026); https://costbench.com/software/developer-tools/vercel/ (checked
  Oct 29 2026)
- Pages limits: https://www.devtoolreviews.com/reviews/cloudflare-pages-pricing-bandwidth-limits-2026
  (checked Oct 2026); https://quickgainshub.com/posts/cloudflare-pages-free-tier-limits
  (Oct 2026); https://www.sofast.host/blog/what-is-cloudflare-pages/
  (checked Oct 29 2026)

## 6. Self-hosting model files on the same origin

Default behavior: the Kokoro model (~92 MB q8 ONNX), voice files, and the
onnxruntime-web WASM are fetched from HuggingFace / jsDelivr CDNs at first
use and cached by transformers.js in the browser's Cache API / IndexedDB.
That works, but self-hosting the files on the same origin as the app is
worth doing because:

1. **COEP correctness.** Under `Cross-Origin-Embedder-Policy: require-corp`,
   cross-origin fetches without a `Cross-Origin-Resource-Policy:
   cross-origin` response header are *blocked*. Same-origin fetches never hit
   this. A CDN that changes or drops its CORP header silently breaks
   inference; same-origin can't.
2. **Reliability.** No dependency on a third-party CDN's availability, rate
   limits, or URL layout for the core feature. The app works as long as the
   app host is up.
3. **Cache control.** You can set `Cache-Control: public, max-age=31536000,
   immutable` on versioned model files (weights don't change) so repeat
   visitors never re-download; CDN defaults are out of your control.

Trade-off: model bytes then count against *your* bandwidth (see §5 —
~1,080 full downloads/month on Vercel Hobby; unlimited on Cloudflare Pages,
subject to the 25 MiB file cap). Keep the q8 quantized default (~92 MB)
as the first-download model.

How: place the model directory under `public/models/…` (or serve from the
same origin via a static host) and point the transformers.js
`env.localModelPath` / model URL at the same-origin path. Do this as a
separate change — it is not part of this PWA commit.
