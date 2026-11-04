"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  AlertTriangle,
  Cpu,
  Info,
  Loader2,
  ShieldCheck,
  Square,
  Volume2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DEFAULT_VOICE_ID,
  MAX_CHARS,
  useTTS,
  type EngineChoice,
} from "@/components/tts-provider";
import { TextEditor } from "@/components/studio/text-editor";
import { VoicePicker } from "@/components/studio/voice-picker";
import { AudioPlayer } from "@/components/studio/audio-player";

export default function StudioPage() {
  const tts = useTTS();
  const {
    engineChoice, setEngineChoice,
    voices, kittenVoices, systemVoices,
    phase, synthProgress, loadProgress, kokoroLoading, kittenLoading, device,
    error, dismissError, ensureVoices, profile, wasInterrupted,
    audioBlocked, unblockAudio,
  } = tts;

  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE_ID);
  const [speed, setSpeed] = useState(1);
  const [showSentinel, setShowSentinel] = useState(false);

  useEffect(() => {
    void ensureVoices();
  }, [ensureVoices]);

  // Jetsam sentinel: a stale flag means the last tab died mid-generate
  // (on iOS, the signature of a memory kill) — one-time honest notice.
  useEffect(() => {
    if (wasInterrupted()) setShowSentinel(true);
  }, [wasInterrupted]);

  const voiceList =
    engineChoice === "kokoro" ? voices : engineChoice === "kitten" ? kittenVoices : systemVoices;

  // Keep the selected voice valid when the voice list (or engine) changes.
  useEffect(() => {
    if (voiceList.length === 0) return;
    if (!voiceList.some((v) => v.id === voiceId)) {
      const def =
        engineChoice === "kokoro"
          ? (voiceList.find((v) => v.id === DEFAULT_VOICE_ID) ?? voiceList[0])
          : voiceList[0];
      setVoiceId(def.id);
    }
  }, [voiceList, voiceId, engineChoice]);

  const busy =
    phase === "loading-model" ||
    phase === "synthesizing" ||
    phase === "streaming" ||
    kokoroLoading ||
    kittenLoading;
  const canGenerate = !busy && text.trim().length > 0 && text.length <= MAX_CHARS;

  const statusLine = useMemo(() => {
    if (phase === "loading-model")
      return loadProgress === null
        ? "Preparing voice model… (one-time download, cached after)"
        : `Downloading voice model… ${Math.round(loadProgress * 100)}% (one-time, cached after)`;
    if (phase === "synthesizing" && synthProgress)
      return `Speaking… sentence ${synthProgress.done} of ${synthProgress.total}`;
    if (phase === "synthesizing") return "Speaking…";
    if (phase === "streaming" && synthProgress)
      return synthProgress.done >= synthProgress.total
        ? `Playing… finishing up (${synthProgress.total} of ${synthProgress.total} sentences)`
        : `Playing — still generating (sentence ${synthProgress.done} of ${synthProgress.total})`;
    if (phase === "streaming") return "Playing…";
    if (phase === "ready-partial" && synthProgress)
      return `Stopped — partial audio kept (${synthProgress.done} of ${synthProgress.total} sentences). You can play or download it below.`;
    if (phase === "ready-partial") return "Stopped — partial audio kept.";
    return null;
  }, [phase, loadProgress, synthProgress]);

  const onEngineChange = (e: EngineChoice) => {
    setEngineChoice(e);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Studio</h1>
        <p className="text-muted-foreground">
          Real AI speech, synthesized on your device. Nothing you type is sent
          anywhere.
        </p>
      </div>

      {/* Jetsam sentinel notice (one-time) */}
      {showSentinel && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>
              The last session was interrupted — your device may be low on
              memory. System voices are the safest choice here.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSentinel(false)}
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Compatibility-path transparency (Track A ladder) */}
      {profile?.name === "compatibility" && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>{profile.blurb}</AlertDescription>
        </Alert>
      )}

      {/* Engine choice */}
      <Tabs
        value={engineChoice}
        onValueChange={(v) => v && onEngineChange(v as EngineChoice)}
      >
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="kokoro">Kokoro AI voices</TabsTrigger>
          <TabsTrigger value="kitten">KittenTTS Nano</TabsTrigger>
          <TabsTrigger value="system">System voices</TabsTrigger>
        </TabsList>
      </Tabs>

      {engineChoice === "kokoro" ? (
        <Card>
          <CardContent className="flex items-start gap-3 pt-6 text-sm">
            {device === "webgpu" ? (
              <Zap className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
            ) : (
              <Cpu className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            )}
            <div>
              <p>
                <strong>Kokoro-82M</strong> — high-quality neural voices, 28
                verified English voices.{" "}
                {device ? (
                  <Badge variant="outline" className="ml-1">
                    using {device === "webgpu" ? "WebGPU" : "CPU (WASM)"}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground">
                    The model (~92 MB) downloads once, on first use, then works
                    offline.
                  </span>
                )}
              </p>
              {device === "wasm" && (
                <p className="mt-1 text-muted-foreground">
                  This device has no WebGPU, so synthesis runs on the CPU and is
                  slower than real time — long texts take a while. System voices
                  are instant if you prefer.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      ) : engineChoice === "kitten" ? (
        <Card>
          <CardContent className="flex items-start gap-3 pt-6 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p>
                <strong>KittenTTS Nano</strong> — a tiny (~24&nbsp;MB) neural
                voice model that runs on your device. Much faster than Kokoro
                on phones and low-power devices, with 8 built-in voices.
                First use downloads the model once (cached after); quality is
                simpler than Kokoro&apos;s.
              </p>
              <p className="mt-1 text-muted-foreground">
                Recommended automatically on phones — it avoids the memory and
                speed problems the full-size model has on mobile.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex items-start gap-3 pt-6 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              <strong>System voices</strong> — your device&apos;s built-in voices.
              Instant, no download. Quality varies by device, and audio
              can&apos;t be downloaded — it plays only. Only on-device voices
              are used; nothing is sent to the cloud.
            </p>
          </CardContent>
        </Card>
      )}

      <TextEditor text={text} onChange={setText} disabled={busy} />

      <div className="grid gap-6 sm:grid-cols-2">
        <VoicePicker voiceId={voiceId} onChange={setVoiceId} disabled={busy} />
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Speaking speed</h2>
            <span className="text-xs tabular-nums text-muted-foreground">
              {speed.toFixed(2)}×
            </span>
          </div>
          <Slider
            value={[speed]}
            min={0.5}
            max={2}
            step={0.05}
            onValueChange={(val) => setSpeed(Array.isArray(val) ? val[0] : val)}
            disabled={busy}
            aria-label="Speaking speed"
          />
          <p className="text-xs text-muted-foreground">
            0.5× slower to 2× faster.
          </p>
        </div>
      </div>

      {/* Generate / stop / cancel.
          During streaming the button is Stop: generation halts but the
          partial audio is kept (playable + exportable). */}
      <div className="flex items-center gap-3">
        {busy ? (
          <Button
            variant={phase === "streaming" ? "secondary" : "destructive"}
            onClick={tts.cancel}
            className="flex-1 sm:flex-none sm:px-8"
            title={
              phase === "streaming"
                ? "Stop generating — keeps the audio generated so far"
                : "Cancel"
            }
          >
            <Square className="mr-2 h-4 w-4" />
            {phase === "streaming" ? "Stop" : "Cancel"}
          </Button>
        ) : (
          <Button
            onClick={() => tts.generate(text, voiceId, speed)}
            disabled={!canGenerate}
            className="flex-1 sm:flex-none sm:px-8"
            size="lg"
          >
            Generate speech
          </Button>
        )}
        {busy && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>
      {phase === "streaming" && (
        <p className="text-xs text-muted-foreground">
          Audio streams as it is generated — playback is continuous, with no
          gaps between sentences.
        </p>
      )}

      {/* Progress */}
      {phase === "loading-model" && (
        <div className="space-y-2">
          <Progress value={(loadProgress ?? 0) * 100} />
          {statusLine && (
            <p className="text-sm text-muted-foreground">{statusLine}</p>
          )}
        </div>
      )}
      {(phase === "synthesizing" || phase === "streaming") && (
        <div className="space-y-2">
          {synthProgress && synthProgress.total > 1 && (
            <Progress value={(synthProgress.done / synthProgress.total) * 100} />
          )}
          {statusLine && (
            <p className="text-sm text-muted-foreground">{statusLine}</p>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={dismissError}>
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Audio blocked — tap-to-retry (iOS may refuse audio outside a tap) */}
      {audioBlocked && !error && (
        <Alert>
          <Volume2 className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>
              Audio is blocked — your browser wouldn&apos;t start sound. Also
              check your silent switch: iPhones mute web audio when it&apos;s on.
            </span>
            <Button variant="default" size="sm" onClick={unblockAudio}>
              Tap to enable sound
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Result */}
      {engineChoice === "kokoro" &&
        (phase === "ready" || phase === "ready-partial") && <AudioPlayer />}
      {engineChoice === "system" && phase === "ready" && (
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertDescription>
            Spoken with your device&apos;s voice. System voices play only —
            they can&apos;t be downloaded as audio files.
          </AlertDescription>
        </Alert>
      )}

      {/* Privacy note */}
      <Card className="border-dashed">
        <CardContent className="flex items-start gap-3 pt-6 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <Tooltip>
              <TooltipTrigger className="font-medium text-foreground underline decoration-dotted underline-offset-4">
                Your text never leaves this device.
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                Synthesis runs in a Web Worker on your machine. The only network
                traffic is the one-time model download from a public CDN — never
                your text.
              </TooltipContent>
            </Tooltip>{" "}
            No accounts, no tracking, no analytics.{" "}
            <a href="/privacy" className="underline underline-offset-4">
              How privacy works
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
