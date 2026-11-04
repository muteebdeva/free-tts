import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Every claim on this page is provable from the source:
 * - Web Worker synthesis: lib/engine-manager.ts ("main-thread façade over
 *   the TTS Web Worker"), engines/kokoro/kokoro-engine.ts
 * - Model downloads: MODEL_ID "onnx-community/Kokoro-82M-v1.0-ONNX" in
 *   kokoro-engine.ts; ORT WASM base per device profile in
 *   lib/device-profile.ts ("default" → jsDelivr CDN, "same-origin" → /ort/)
 * - Cache Storage: lib/model-store.ts (caches "transformers-cache",
 *   "kokoro-voices"), deletable from Settings
 * - System voices: engines/system/system-engine.ts (localService filter)
 * - History/theme/draft: lib/history.ts, components/theme-provider.tsx
 *   (localStorage only, audio never persisted)
 * - Service worker: components/sw-register.tsx (production only) +
 *   public/sw.js (app-shell offline, network-first elsewhere)
 */
export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
          <ShieldCheck className="h-7 w-7" /> Privacy
        </h1>
        <p className="text-muted-foreground">
          What FreeTTS sends over the network — and, more importantly, what it
          never sends. Each statement below describes the app as built; the
          code is the proof.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Your text never leaves your device
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            With the Kokoro engine, speech is synthesized inside a{" "}
            <strong>Web Worker</strong> on your own machine, using the
            Kokoro-82M neural model running in your browser. The text you type
            is processed locally — it is never uploaded, logged, or sent to
            any TTS API, analytics service, or third party.
          </p>
          <p>
            There is <strong>no account system</strong>, <strong>no
            analytics</strong>, <strong>no tracking</strong>, and{" "}
            <strong>no cookies</strong> in this app — none of the code exists
            to make any of those possible.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            The only network traffic: a one-time model download
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            To synthesize speech, your browser needs the AI model itself. On
            first use, the Kokoro engine downloads:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              The Kokoro-82M speech model from <strong>Hugging Face</strong>{" "}
              (the public <code className="font-mono text-xs">onnx-community/Kokoro-82M-v1.0-ONNX</code>{" "}
              release) — about 92 MB quantized for CPU, about 326 MB
              full-precision for WebGPU.
            </li>
            <li>
              The voice file you select (~0.5 MB each) from the same source.
            </li>
            <li>
              The WebAssembly inference runtime (~30 MB) — from a public CDN
              (jsDelivr, the transformers.js default) on most devices; served
              with the app itself on the compatibility path.
            </li>
          </ul>
          <p>
            These are <strong>identical public files for every user</strong> —
            they contain no personal data and reveal nothing about you or your
            text. After download they are cached in your browser&apos;s Cache
            Storage (<code className="font-mono text-xs">transformers-cache</code>{" "}
            and <code className="font-mono text-xs">kokoro-voices</code>), and
            you can inspect and delete them anytime in{" "}
            <Link href="/settings" className="underline underline-offset-4">
              Settings → Downloaded models
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            System voices: on-device only
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            The optional &ldquo;System voices&rdquo; engine uses your
            device&apos;s built-in speech synthesizer. FreeTTS deliberately
            uses only <strong>on-device voices</strong> — it filters out
            browser &ldquo;network&rdquo; voices (such as Chrome&apos;s Google
            voices), which would send your text to the vendor&apos;s servers.
            If your device has no local voices, this engine simply has nothing
            to offer.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            What is stored on your device
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Generation history</strong>: the full text and settings
              (voice, engine, speed, date) of your generations — up to 50
              entries, newest first. Generated <strong>audio is never
              saved</strong>; only what is needed to regenerate it. View it on
              the{" "}
              <Link href="/history" className="underline underline-offset-4">
                History
              </Link>{" "}
              page and delete entries there, or clear everything from the{" "}
              <Link href="/settings" className="underline underline-offset-4">
                Settings
              </Link>{" "}
              page.
            </li>
            <li>
              <strong>Your theme choice</strong> (light or dark).
            </li>
            <li>
              <strong>Your Studio draft text</strong>, so it survives
              navigation — it is overwritten as you type.
            </li>
          </ul>
          <p>
            All of this lives in your browser&apos;s localStorage, on your
            device only. Nothing is synced anywhere.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Offline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            In the production build, a service worker caches the app shell, so
            the app loads without a connection. Once the model is downloaded
            and cached, synthesis needs no network at all.
          </p>
          <p className="text-muted-foreground">
            Honest limits: browsers may evict cached files under storage
            pressure — the app will simply re-download them when needed, which
            is an inconvenience, not a privacy event. Downloading a file
            necessarily reveals your IP address to the file host, exactly like
            downloading any file from the internet. And this page describes
            the app as built: if you deploy or modify it, audit your own
            changes — adding analytics or a backend would break these
            guarantees.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
