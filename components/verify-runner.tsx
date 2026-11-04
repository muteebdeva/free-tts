"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getEngineManager } from "@/lib/engine-manager";
import {
  encodeWav,
  nonSilentFraction,
  parseWavHeader,
  peakAmplitude,
} from "@/audio/wav-encoder";
import { concatChunks } from "@/audio/concat";
import { getProfile, type DeviceProfileName } from "@/lib/device-profile";

declare global {
  interface Window {
    __ftts_verify?: unknown;
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  // Chunked to avoid call-stack limits on large arrays.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export default function VerifyRunner() {
  const params = useSearchParams();
  const [status, setStatus] = useState("starting…");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const text =
        params.get("text") ||
        "Hello. This is a verification test of the FreeTTS speech engine.";
      const voice = params.get("voice") || "af_heart";
      const speed = parseFloat(params.get("speed") || "1") || 1;
      // ?assets=1 → use the same-origin verification mirror (see
      // app/api/verify-assets). Production never sets this.
      const assetBase = params.get("assets") === "1" ? "/api/verify-assets" : undefined;
      // ?stream=1 → exercise the streaming protocol (synthesizeStream) and
      // the streamed-vs-batch byte-match regression. ?profile=… selects the
      // device profile's chunk/thread policy for the run.
      const streamMode = params.get("stream") === "1";
      const profileName = (params.get("profile") || "balanced") as DeviceProfileName;
      const profile = getProfile(profileName) ?? getProfile("balanced");
      const ortOpts = {
        numThreads: profile.ortThreads > 0 ? profile.ortThreads : undefined,
        // In the harness the mirror always wins (sandbox blocks the CDN);
        // sameOriginWasm only applies to real production loads.
        sameOriginWasm: false,
      };
      const t0 = performance.now();
      try {
        const mgr = getEngineManager();
        setStatus("loading model…");
        const device = await mgr.loadModel((f) => {
          if (!cancelled) setStatus(`loading model… ${Math.round(f * 100)}%`);
        }, assetBase ? { assetBase, ...ortOpts } : ortOpts);
        const t1 = performance.now();
        if (!cancelled) setStatus(streamMode ? "streaming…" : "synthesizing…");

        let samples: Float32Array;
        let sampleRate: number;
        let chunkCount: number;
        let firstChunkMs: number | null = null;
        let pcmByteMatch: boolean | null = null;
        let streamMs = 0;

        if (streamMode) {
          // (a) Profile-chunked streaming run: time-to-first-chunk. Every
          // chunk is acked immediately (no playback in the harness).
          const parts: Float32Array[] = [];
          const tS = performance.now();
          const sp = mgr.synthesizeStream(
            text,
            voice,
            speed,
            {
              onChunk: (c) => {
                if (firstChunkMs === null) firstChunkMs = performance.now() - tS;
                parts[c.index] = c.samples;
                sp.ack();
                if (!cancelled) setStatus(`streaming… chunk ${c.index + 1}/${c.total}`);
              },
              onProgress: (d, t) => {
                if (!cancelled) setStatus(`streaming… chunk ${d}/${t}`);
              },
            },
            { chunkChars: profile.chunkChars, highWater: profile.streamHighWater },
          );
          const sres = await sp;
          streamMs = performance.now() - tS;
          sampleRate = sres.sampleRate;
          chunkCount = sres.chunkCount;
          samples = concatChunks(parts, { sampleRate });
          // (b) Byte-match control: stream and batch with IDENTICAL chunking
          // (400 chars, the batch default) — regression: the streaming
          // transport (transfers, ordering, concat) must not change audio.
          if (!cancelled) setStatus("streaming… byte-match control");
          const parts400: Float32Array[] = [];
          const sp2 = mgr.synthesizeStream(
            text,
            voice,
            speed,
            {
              onChunk: (c) => {
                parts400[c.index] = c.samples;
                sp2.ack();
              },
            },
            { chunkChars: 400, highWater: 4 },
          );
          await sp2;
          const batch = await mgr.synthesize(text, voice, speed);
          const streamed400 = concatChunks(parts400, { sampleRate });
          pcmByteMatch =
            batch.samples.length === streamed400.length &&
            batch.sampleRate === sampleRate &&
            batch.samples.every((v, i) => v === streamed400[i]);
        } else {
          const result = await mgr.synthesize(text, voice, speed, {
            onProgress: (d, t) => {
              if (!cancelled) setStatus(`synthesizing… chunk ${d}/${t}`);
            },
          });
          const t2 = performance.now();
          samples = result.samples;
          sampleRate = result.sampleRate;
          chunkCount = result.chunkCount;
          streamMs = Math.round(t2 - t1);
        }
        const t2 = performance.now();
        // Byte-level proof: encode a real WAV in-page and re-parse its header.
        const wav = encodeWav(samples, { sampleRate });
        const wavHeader = parseWavHeader(wav);
        window.__ftts_verify = {
          ok: true,
          device,
          voice,
          textLength: text.length,
          sampleRate,
          numSamples: samples.length,
          durationSec: sampleRate > 0 ? samples.length / sampleRate : 0,
          peak: peakAmplitude(samples),
          nonSilentFraction: nonSilentFraction(samples),
          chunkCount,
          loadMs: Math.round(t1 - t0),
          synthMs: Math.round(t2 - t1),
          wavBytes: wav.length,
          wavHeader,
          streamMode,
          profile: profile.name,
          firstChunkMs: firstChunkMs === null ? null : Math.round(firstChunkMs),
          streamMs: Math.round(streamMs),
          pcmByteMatch,
          // base64 for independent Node-side validation + evidence file
          wavBase64: uint8ToBase64(wav),
        };
        if (!cancelled) setStatus("done ✓");
      } catch (e) {
        const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        // A cancelled (superseded) run must never publish its result —
        // otherwise it races the run that replaced it.
        if (!cancelled) {
          window.__ftts_verify = { ok: false, error: message };
          setStatus(`error: ${message}`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params]);

  return (
    <main style={{ fontFamily: "monospace", padding: 24 }}>
      <h1>FreeTTS engine verification</h1>
      <p data-testid="verify-status">{status}</p>
      <p>Not part of the app UI — dev harness only.</p>
    </main>
  );
}
