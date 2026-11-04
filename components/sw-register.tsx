"use client";

import { useEffect } from "react";

/**
 * Registers the FreeTTS service worker (app-shell offline support).
 * Production only — in dev we skip registration so hot reloads and the
 * /verify harness never fight a stale cache.
 */
export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline support is a progressive enhancement; failure is silent.
    });
  }, []);
  return null;
}
