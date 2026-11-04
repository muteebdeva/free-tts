import { Suspense } from "react";
import VerifyRunner from "@/components/verify-runner";

/**
 * Dev-only verification harness (NOT linked in the app UI).
 * Drives the real Kokoro engine inside the TTS Web Worker and exposes a
 * machine-readable result on window.__ftts_verify for Playwright assertions.
 *
 * Query params: ?text=...&voice=af_heart&speed=1
 */
export default function VerifyPage() {
  return (
    <Suspense fallback={<main><p>starting…</p></main>}>
      <VerifyRunner />
    </Suspense>
  );
}
