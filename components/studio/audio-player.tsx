"use client";

import { useEffect, useRef, useState } from "react";
import {
  Download,
  Loader2,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTTS } from "@/components/tts-provider";

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Audio player for generated speech.
 * Plays the WAV blob via a native <audio> element (correct sample rate comes
 * from the file itself). Seek, volume, playback speed, WAV + MP3 download.
 * MP3 encoding runs locally via lamejs — no server involved.
 */
export function AudioPlayer() {
  const { audioUrl, audioSampleRate, getAudioData } = useTTS();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [mp3Busy, setMp3Busy] = useState(false);
  const [mp3Error, setMp3Error] = useState<string | null>(null);

  useEffect(() => {
    setPlaying(false);
    setCurrent(0);
    setDuration(0);
  }, [audioUrl]);

  if (!audioUrl) return null;

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  const downloadWav = () => {
    const a = document.createElement("a");
    a.href = audioUrl;
    a.download = `freetts-${Date.now()}.wav`;
    a.click();
  };

  const downloadMp3 = async () => {
    setMp3Error(null);
    const data = getAudioData();
    if (!data) {
      setMp3Error("MP3 export needs the generated audio data.");
      return;
    }
    setMp3Busy(true);
    try {
      // Dynamic import: the encoder module is provided by audio/mp3-export.
      const mod = await import("@/audio/mp3-export");
      const bytes = mod.encodeMp3(data.samples, data.sampleRate, 128);
      const url = URL.createObjectURL(
        new Blob([bytes as unknown as BlobPart], { type: "audio/mpeg" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `freetts-${Date.now()}.mp3`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setMp3Error(
        e instanceof Error
          ? `MP3 export failed: ${e.message}`
          : "MP3 export failed.",
      );
    } finally {
      setMp3Busy(false);
    }
  };

  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <audio
        ref={audioRef}
        src={audioUrl}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        preload="metadata"
      />
      <div className="flex items-center gap-3">
        <Button size="icon" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
          {fmt(current)}
        </span>
        <Slider
          value={[current]}
          max={duration || 1}
          step={0.1}
          onValueChange={(val) => {
            const v = Array.isArray(val) ? val[0] : val;
            const el = audioRef.current;
            if (el) el.currentTime = v;
            setCurrent(v);
          }}
          className="flex-1"
          aria-label="Seek"
        />
        <span className="w-12 text-xs tabular-nums text-muted-foreground">
          {fmt(duration)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              const el = audioRef.current;
              const next = !muted;
              setMuted(next);
              if (el) el.muted = next;
            }}
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted || volume === 0 ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </Button>
          <Slider
            value={[muted ? 0 : volume]}
            max={1}
            step={0.05}
            onValueChange={(val) => {
              const v = Array.isArray(val) ? val[0] : val;
              setVolume(v);
              setMuted(false);
              const el = audioRef.current;
              if (el) {
                el.volume = v;
                el.muted = false;
              }
            }}
            className="w-24"
            aria-label="Volume"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Speed</span>
          <Select
            value={String(rate)}
            onValueChange={(v) => {
              const r = parseFloat(v ?? "1");
              if (!Number.isFinite(r)) return;
              setRate(r);
              const el = audioRef.current;
              if (el) el.playbackRate = r;
            }}
          >
            <SelectTrigger className="w-20" aria-label="Playback speed">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                <SelectItem key={r} value={String(r)}>
                  {r}×
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {audioSampleRate && (
            <span className="text-xs text-muted-foreground">
              {(audioSampleRate / 1000).toFixed(1)} kHz WAV
            </span>
          )}
          <Button variant="outline" size="sm" onClick={downloadWav}>
            <Download className="mr-1 h-3.5 w-3.5" /> WAV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={downloadMp3}
            disabled={mp3Busy}
          >
            {mp3Busy ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-1 h-3.5 w-3.5" />
            )}
            MP3
          </Button>
        </div>
      </div>
      {mp3Error && <p className="mt-2 text-sm text-destructive">{mp3Error}</p>}
    </div>
  );
}
