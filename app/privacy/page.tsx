import { ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <ShieldCheck className="h-7 w-7" /> Privacy
        </h1>
        <p className="text-muted-foreground">
          What FreeTTS sends over the network — and, more importantly, what it
          never sends.
        </p>
      </div>

      <Card className="border-green-600/30">
        <CardHeader>
          <CardTitle className="text-base text-green-700 dark:text-green-400">
            Your text never leaves your device
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Speech is synthesized inside a Web Worker on your own machine, using
            a neural model running in your browser. The text you type is
            processed locally as tensors — it is never uploaded, logged, or sent
            to any TTS API, analytics service, or third party.
          </p>
          <p>
            There is <strong>no account system</strong>, <strong>no analytics</strong>,
            and <strong>no tracking</strong> in this app. Generated audio lives
            in memory; it touches your disk only when <em>you</em> press
            Download.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            The one thing that <em>is</em> downloaded: model files
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            To synthesize speech, your browser needs the AI model itself. On
            first use, the app downloads:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              The Kokoro-82M speech model (~92 MB quantized for CPU, ~326 MB
              full-precision for WebGPU) from HuggingFace — a public model
              repository.
            </li>
            <li>
              The voice file you select (~0.5 MB each) from the same place.
            </li>
            <li>
              The WebAssembly inference runtime (~30 MB) from a public CDN.
            </li>
          </ul>
          <p>
            These are <strong>identical files for every user</strong> — they
            contain no personal data and reveal nothing about you or your text.
            They are cached in your browser afterwards, so the app works offline.
            You can inspect and delete them anytime in{" "}
            <a href="/settings" className="underline underline-offset-4">
              Settings → Downloaded models
            </a>
            .
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">System voices fallback</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            The optional &ldquo;System voices&rdquo; engine uses your
            device&apos;s built-in speech synthesizer. FreeTTS deliberately uses
            only <strong>on-device voices</strong> — it filters out browser
            &ldquo;network&rdquo; voices (such as Chrome&apos;s Google voices),
            which would send your text to the vendor&apos;s servers. If your
            device has no local voices, this engine simply has nothing to offer.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Honest limits</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Browsers may evict cached model files under storage pressure. The
              app will re-download them when needed — an inconvenience, not a
              privacy event.
            </li>
            <li>
              Downloading a model necessarily reveals your IP address to the
              file host (HuggingFace / CDN), exactly like downloading any file.
              It reveals nothing about what you later synthesize.
            </li>
            <li>
              This page describes the app as built. If you deploy or modify it,
              audit your own changes — adding analytics or a backend would break
              these guarantees.
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
