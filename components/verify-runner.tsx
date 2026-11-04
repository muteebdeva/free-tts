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
      const t0 = performance.now();
      try {
        const mgr = getEngineManager();
        setStatus("loading model…");
        const device = await mgr.loadModel((f) => {
          if (!cancelled) setStatus(`loading model… ${Math.round(f * 100)}%`);
        });
        const t1 = performance.now();
        if (!cancelled) setStatus("synthesizing…");
        const result = await mgr.synthesize(text, voice, speed, {
          onProgress: (d, t) => {
            if (!cancelled) setStatus(`synthesizing… chunk ${d}/${t}`);
          },
        });
        const t2 = performance.now();
        const { samples, sampleRate, chunkCount } = result;
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
          // base64 for independent Node-side validation + evidence file
          wavBase64: uint8ToBase64(wav),
        };
        if (!cancelled) setStatus("done ✓");
      } catch (e) {
        const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        window.__ftts_verify = { ok: false, error: message };
        if (!cancelled) setStatus(`error: ${message}`);
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
