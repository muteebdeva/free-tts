/**
 * FreeTTS service worker — minimal app-shell offline support.
 *
 * Deliberately hand-rolled (no next-pwa / Serwist). Rationale, recorded in
 * docs/DEPLOYMENT.md:
 *  - next-pwa is webpack-only and hooks config.webpack, which Turbopack never
 *    calls — on Next 16 it would silently produce no service worker unless we
 *    also pinned every build to --webpack.
 *  - The heavy assets (model .onnx / voice .bin / ORT WASM) are already
 *    managed by transformers.js in Cache API / IndexedDB; the SW only needs
 *    to keep the app shell working offline, not to precache 92 MB.
 *  - Zero changes to next.config.ts and zero new dependencies.
 *
 * Strategy:
 *  - GET /api/verify-assets/**  -> network only (dev/test mirror, never cached)
 *  - Navigations               -> network first, fall back to cached "/" offline
 *  - /_next/static/** + same-origin assets -> stale-while-revalidate
 *  - Everything else            -> network first, cache fallback on failure
 *  - activate                  -> evict only old "freets-shell-*" caches; the
 *    model/voice caches (transformers-cache, kokoro-voices) are preserved
 */
const CACHE = "freets-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon.svg"];

/**
 * Model/voice caches must NEVER be evicted here. Deleting them would silently
 * force a full multi-minute model re-download on every SW update — previously
 * the activate handler wiped every cache except the shell cache, which was
 * the real cache-wipe bug. Source of truth for these names:
 * lib/model-store.ts (MODEL_CACHES).
 */
const PRESERVED_CACHES = ["transformers-cache", "kokoro-voices"];
/** Only old versions of this worker's own shell cache are evicted on activate. */
const SHELL_PREFIX = "freets-shell-";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) =>
                k.startsWith(SHELL_PREFIX) &&
                k !== CACHE &&
                !PRESERVED_CACHES.includes(k),
            )
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Dev/test model mirror: never cache, never serve stale.
  if (url.pathname.startsWith("/api/verify-assets")) return;

  // Navigations: fresh HTML when online, cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  // Versioned static assets + same-origin files: stale-while-revalidate.
  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") ||
      url.pathname.startsWith("/icons/"))
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fresh = fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        });
        return cached ?? fresh;
      }),
    );
    return;
  }

  // Default: network first, cache fallback.
  event.respondWith(
    fetch(request).catch(() => caches.match(request)),
  );
});
