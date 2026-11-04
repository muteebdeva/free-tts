/**
 * TTS Web Worker: runs the Kokoro engine off the main thread.
 *
 * Responsibilities:
 *  - load the model once (progress reported to the UI),
 *  - split long text into sentence-aware chunks (lib/text-chunk.ts),
 *  - synthesize chunks sequentially with per-chunk progress + cooperative
 *    cancellation,
 *  - concatenate chunk waveforms with de-clicking (audio/concat.ts),
 *  - transfer the final Float32Array back to the main thread (zero-copy).
 *
 * The main thread never touches the model. WAV/MP3 encoding and playback
 * stay on the main thread (Web Audio API lives there).
 */
import { KokoroEngine } from "../engines/kokoro/kokoro-engine";
import { concatChunks } from "../audio/concat";
import { chunkText } from "../lib/text-chunk";
import { env as kokoroEnv } from "kokoro-js";

type InMessage =
  | { type: "load"; requestId: number; assetBase?: string }
  | { type: "voices"; requestId: number }
  | { type: "synthesize"; requestId: number; text: string; voiceId: string; speed: number }
  | { type: "cancel"; requestId: number }
  | { type: "unload"; requestId: number }
  | { type: "device"; requestId: number };

const engine = new KokoroEngine();
let currentAbort: AbortController | null = null;
let currentRequestId: number | null = null;
let fetchWrapped = false;

/**
 * Point all external asset downloads at a local mirror (same origin).
 * Used ONLY by the verification harness (scripts/verify-audio.mjs), where the
 * sandbox proxy blocks the browser's direct CDN access. Rewrites:
 *  - https://huggingface.co/... (model, tokenizer, voices — kokoro-js
 *    hardcodes voice URLs, so env config alone cannot redirect them)
 *  - https://cdn.jsdelivr.net/... (fallback)
 * and pins the ONNX Runtime WASM binaries to the mirror via env.wasmPaths.
 */
function useAssetMirror(assetBase: string): void {
  kokoroEnv.wasmPaths = `${assetBase}/ort/`;
  if (fetchWrapped) return;
  fetchWrapped = true;
  const originalFetch = globalThis.fetch.bind(globalThis);
  const rewrites: Array<[string, string]> = [
    ["https://huggingface.co/", `${assetBase}/mirror/huggingface.co/`],
    ["https://cdn.jsdelivr.net/", `${assetBase}/mirror/cdn.jsdelivr.net/`],
  ];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    let url: string | null = null;
    if (typeof input === "string") url = input;
    else if (input instanceof URL) url = input.href;
    else if (typeof (input as Request).url === "string") url = (input as Request).url;
    if (url) {
      for (const [from, to] of rewrites) {
        if (url.startsWith(from)) {
          const rewritten = to + url.slice(from.length);
          input = (typeof input === "string" || input instanceof URL
            ? rewritten
            : new Request(rewritten, input as Request)) as RequestInfo;
          break;
        }
      }
    }
    return originalFetch(input as RequestInfo, init);
  }) as typeof fetch;
}

function post(msg: unknown, transfer?: Transferable[]) {
  (self as unknown as Worker).postMessage(msg, transfer ?? []);
}

self.onmessage = async (event: MessageEvent<InMessage>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case "device": {
        post({ type: "device", requestId: msg.requestId, device: engine.activeDevice });
        break;
      }
      case "load": {
        if (msg.assetBase) useAssetMirror(msg.assetBase);
        await engine.load((fraction) =>
          post({ type: "load-progress", requestId: msg.requestId, fraction }),
        );
        post({ type: "loaded", requestId: msg.requestId, device: engine.activeDevice });
        break;
      }
      case "voices": {
        if (!engine.isLoaded()) await engine.load();
        post({ type: "voices", requestId: msg.requestId, voices: await engine.getVoices() });
        break;
      }
      case "synthesize": {
        // One synthesis at a time: abort any in-flight job first.
        currentAbort?.abort();
        const aborter = new AbortController();
        currentAbort = aborter;
        currentRequestId = msg.requestId;

        const chunks = chunkText(msg.text, { maxChars: 400, locale: "en" });
        const waves: Float32Array[] = [];
        let sampleRate = 24000;

        for (let i = 0; i < chunks.length; i++) {
          if (aborter.signal.aborted) throw new DOMException("Aborted", "AbortError");
          const result = await engine.synthesize(chunks[i], msg.voiceId, {
            speed: msg.speed,
            signal: aborter.signal,
          });
          sampleRate = result.sampleRate;
          waves.push(result.samples);
          post({ type: "synth-progress", requestId: msg.requestId, done: i + 1, total: chunks.length });
        }

        if (aborter.signal.aborted) throw new DOMException("Aborted", "AbortError");
        const combined = concatChunks(waves, { sampleRate });
        // Samples travel in the same message as the transfer: structured
        // clone moves the Float32Array zero-copy; the buffer is detached here.
        post(
          {
            type: "synth-done",
            requestId: msg.requestId,
            sampleRate,
            chunkCount: chunks.length,
            samples: combined,
          },
          [combined.buffer as Transferable],
        );
        break;
      }
      case "cancel": {
        if (msg.requestId === currentRequestId) currentAbort?.abort();
        break;
      }
      case "unload": {
        currentAbort?.abort();
        await engine.unload();
        post({ type: "unloaded", requestId: msg.requestId });
        break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const aborted =
      err instanceof DOMException && err.name === "AbortError";
    post({
      type: "error",
      requestId: (msg as { requestId?: number }).requestId ?? null,
      message,
      aborted,
    });
  } finally {
    if (msg.type === "synthesize" && currentRequestId === msg.requestId) {
      currentAbort = null;
      currentRequestId = null;
    }
  }
};
