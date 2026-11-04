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

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
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
