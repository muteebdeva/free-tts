import type { NextConfig } from "next";
import path from "path";

// kokoro-js ships two builds: dist/kokoro.js (node-flavored, imports
// "path"/"fs/promises") and dist/kokoro.web.js (fully self-contained browser
// bundle: transformers.js + onnxruntime-web + eSpeak-NG inlined, no node
// builtins, no external imports). Alias the package to the web build so
// client/worker bundles never pull node core modules.
const kokoroWeb = path.resolve(
  __dirname,
  "node_modules/kokoro-js/dist/kokoro.web.js",
);

const isPagesExport = process.env.PAGES_EXPORT === "1";

const nextConfig: NextConfig = {
  /* config options here */
  // PPR (cacheComponents) cannot be enabled in export mode — the Pages
  // static export uses classic rendering; dev/Vercel builds keep the new
  // caching defaults.
  cacheComponents: !isPagesExport,
  partialPrefetching: !isPagesExport,
  // Cloudflare Pages deploys a static export (next-on-pages does not support
  // Next 16). PAGES_EXPORT=1 switches to `output: "export"`; the dev-only
  // app/api/verify-assets route must be moved aside for this build (it 404s
  // in production anyway). COOP/COEP headers then come from public/_headers.
  ...(isPagesExport ? { output: "export" as const } : {}),
  // Threaded WebAssembly (onnxruntime-web) requires SharedArrayBuffer, which
  // requires these two headers. Every deployment must preserve them —
  // see docs/DEPLOYMENT.md. (Without them, model inference cannot start.)
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
    resolveAlias: {
      "kokoro-js": kokoroWeb,
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "kokoro-js": kokoroWeb,
    };
    return config;
  },
};

export default nextConfig;
