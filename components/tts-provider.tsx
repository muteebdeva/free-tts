"use client";

/**
 * TTSProvider: shared client state for the whole app.
 *
 * Owns the EngineManager singleton (Kokoro worker), the SystemEngine fallback,
 * voice lists, generation lifecycle, and preview-audio caching. Pages and
 * components consume this context — nobody talks to engines directly.
 *
 * Streaming: neural generation runs through `synthesizeStream`. Each chunk's
 * PCM is retained (for WAV/MP3 export via concat on demand) and played
 * gaplessly: a Web Audio GaplessPlayer schedules each chunk's AudioBuffer
 * back-to-back with precise start times (8 ms equal-power crossfade at the
 * joints, mirroring the download stitcher), so sentences flow with zero
 * inserted silence. The AudioContext is created/resumed synchronously in
 * the Generate tap gesture (iOS unlock); if Web Audio is unavailable the
 * legacy ping-pong <audio> path is used instead (gaps, but audible — never
 * silence). Each played chunk is acked back to the worker (backpressure).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getEngineManager, type StreamChunk, type StreamPromise } from "@/lib/engine-manager";
import { SystemEngine } from "@/engines/system/system-engine";
import type { Voice } from "@/engines/engine-interface";
import { validateTextInput } from "@/lib/text-chunk";
import { encodeWav } from "@/audio/wav-encoder";
import { concatChunks } from "@/audio/concat";
import { GaplessPlayer } from "@/audio/gapless-player";
import { StreamQueue } from "@/lib/stream-queue";
import { createThrottledProgress } from "@/lib/throttle";
import {
  classifyDevice,
  defaultEngineFor,
  type DeviceProfile,
} from "@/lib/device-profile";
import {
  clearGenerateFlag,
  consumeStaleGenerateFlag,
  markGenerateStart,
} from "@/lib/jetsam-sentinel";
import { DEFAULT_VOICE_ID } from "@/engines/kokoro/voices";

/**
 * EngineChoice mirrors Track A's EngineId ("kokoro" | "system" | "kitten").
 * "kitten" is accepted at the type level per the device-profile contract,
 * but engines/kitten is not wired into this provider yet (Track A owns
 * that) — see the TEMPORARY coercion in the mount effect below.
 */
export type EngineChoice = "kokoro" | "system" | "kitten";
export type Phase =
  | "idle"
  | "loading-model"
  | "synthesizing"
  | "streaming"
  | "ready"
  | "ready-partial"
  | "error";

export const MAX_CHARS = 5000;
const PREVIEW_TEXT = (name: string) => `Hello, I'm ${name}. This is how I sound.`;

interface QueuedChunk {
  index: number;
  url: string;
  samples: Float32Array;
}

interface StreamState {
  stream: StreamPromise;
  queue: StreamQueue<QueuedChunk>;
  pcmParts: Float32Array[];
  sampleRate: number;
  els: [HTMLAudioElement, HTMLAudioElement];
  activeEl: 0 | 1;
  playing: boolean;
  synthDone: boolean;
  currentChunk: QueuedChunk | null;
  userStopped: boolean;
  /**
   * Gapless Web Audio playback. Non-null when the AudioContext unlock
   * succeeded in the Generate tap gesture; null => the legacy ping-pong
   * <audio> path (queue/els/currentChunk) is used instead.
   */
  gapless: GaplessPlayer | null;
  /** Chunks whose playback ended (gapless path drives finishStreamReady). */
  endedChunks: number;
  /** Total chunks for this stream (known at synth-done). */
  totalChunks: number | null;
}

interface TTSContextValue {
  engineChoice: EngineChoice;
  setEngineChoice: (e: EngineChoice) => void;
  /** Device profile (Track A ladder) — null until classified. */
  profile: DeviceProfile | null;

  // Kokoro engine state
  kokoroLoaded: boolean;
  kokoroLoading: boolean;
  // KittenTTS Nano engine state (light neural opt-up for mobile)
  kittenLoaded: boolean;
  kittenLoading: boolean;
  kittenVoices: Voice[];
  /** 0..1, or null when no real progress event has arrived yet ("Preparing…"). */
  loadProgress: number | null;
  device: string | null; // "webgpu" | "wasm"
  voices: Voice[];
  voicesLoading: boolean;

  // System fallback state
  systemAvailable: boolean;
  systemVoices: Voice[];

  // Generation state
  phase: Phase;
  synthProgress: { done: number; total: number } | null;
  audioUrl: string | null; // WAV blob URL (kokoro only)
  audioSampleRate: number | null;
  error: string | null;

  // Actions
  generate: (text: string, voiceId: string, speed: number) => Promise<void>;
  cancel: () => void;
  previewVoice: (voice: Voice, engine: EngineChoice) => Promise<void>;
  previewingId: string | null;
  dismissError: () => void;
  /** Raw PCM of the last generation (for MP3 export). Null for system voices. */
  getAudioData: () => { samples: Float32Array; sampleRate: number } | null;
  /** Load the voice list (static metadata — does NOT download the model). */
  ensureVoices: () => Promise<void>;
  /** Unload the model from memory and delete all cached model files. */
  unloadModel: () => Promise<void>;
  /** True when a previous tab died mid-generate (one-time; consumed on read). */
  wasInterrupted: () => boolean;
}

const TTSContext = createContext<TTSContextValue | null>(null);

export function useTTS(): TTSContextValue {
  const ctx = useContext(TTSContext);
  if (!ctx) throw new Error("useTTS must be used inside TTSProvider");
  return ctx;
}

export function TTSProvider({ children }: { children: ReactNode }) {
  const [engineChoice, setEngineChoiceState] = useState<EngineChoice>("kokoro");
  const [profile, setProfile] = useState<DeviceProfile | null>(null);
  const [kokoroLoaded, setKokoroLoaded] = useState(false);
  const [kokoroLoading, setKokoroLoading] = useState(false);
  const [kittenLoaded, setKittenLoaded] = useState(false);
  const [kittenLoading, setKittenLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState<number | null>(null);
  const [device, setDevice] = useState<string | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [systemVoices, setSystemVoices] = useState<Voice[]>([]);
  const [systemAvailable, setSystemAvailable] = useState(false);
  const [kittenVoices, setKittenVoices] = useState<Voice[]>([]);

  const [phase, setPhase] = useState<Phase>("idle");
  const [synthProgress, setSynthProgress] = useState<{ done: number; total: number } | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioSampleRate, setAudioSampleRate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  const systemEngineRef = useRef<SystemEngine | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewCacheRef = useRef(new Map<string, string>());
  const audioDataRef = useRef<{ samples: Float32Array; sampleRate: number } | null>(null);
  const engineChoiceRef = useRef<EngineChoice>("kokoro");
  engineChoiceRef.current = engineChoice;
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;
  const kokoroLoadedRef = useRef(false);
  const kittenLoadedRef = useRef(false);
  const voicesRef = useRef<Voice[]>([]);
  voicesRef.current = voices;
  const kittenVoicesRef = useRef<Voice[]>([]);
  kittenVoicesRef.current = kittenVoices;
  const profileRef = useRef<DeviceProfile | null>(null);
  const engineTouchedRef = useRef(false);
  const streamRef = useRef<StreamState | null>(null);

  const fail = useCallback((message: string) => {
    setError(message);
    setPhase("error");
    setKokoroLoading(false);
    setKittenLoading(false);
    setSynthProgress(null);
  }, []);

  const dismissError = useCallback(() => {
    setError(null);
    setPhase((p) => (p === "error" ? "idle" : p));
  }, []);

  // ---- voice loading ------------------------------------------------------

  const ensureKokoroVoices = useCallback(async () => {
    if (voicesRef.current.length > 0 || voicesLoading) return;
    setVoicesLoading(true);
    try {
      // Static registry — no model download.
      const mgr = getEngineManager();
      setVoices(await mgr.getVoices());
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    } finally {
      setVoicesLoading(false);
    }
  }, [voicesLoading, fail]);

  const ensureKittenVoices = useCallback(async () => {
    if (kittenVoicesRef.current.length > 0 || voicesLoading) return;
    setVoicesLoading(true);
    try {
      // Static registry — no model download.
      const mgr = getEngineManager();
      setKittenVoices(await mgr.getVoices("kitten"));
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    } finally {
      setVoicesLoading(false);
    }
  }, [voicesLoading, fail]);

  const ensureSystemVoices = useCallback(async () => {
    if (!systemEngineRef.current) systemEngineRef.current = new SystemEngine();
    try {
      await systemEngineRef.current.load();
      setSystemVoices(await systemEngineRef.current.getVoices());
      setSystemAvailable(true);
    } catch {
      setSystemAvailable(false);
      setSystemVoices([]);
    }
  }, []);

  // ---- device profile → default engine (Track A ladder) --------------------

  const applyEngineChoice = useCallback(
    (e: EngineChoice, userInitiated: boolean) => {
      if (userInitiated) engineTouchedRef.current = true;
      // Tear down any streaming playback when switching engines.
      const s = streamRef.current;
      streamRef.current = null;
      if (s) {
        if (s.gapless) {
          s.gapless.stop();
          s.gapless.dispose();
          s.gapless = null;
        }
        for (const el of s.els) {
          try { el.pause(); } catch { /* ignore */ }
          el.onended = null;
          el.onerror = null;
          el.removeAttribute("src");
        }
        if (s.currentChunk) URL.revokeObjectURL(s.currentChunk.url);
        for (const c of s.queue.clear()) URL.revokeObjectURL(c.url);
      }
      getEngineManager().cancel();
      systemEngineRef.current?.unload().catch(() => undefined);
      clearGenerateFlag();
      setEngineChoiceState(e);
      engineChoiceRef.current = e;
      setPhase("idle");
      setError(null);
      setSynthProgress(null);
      if (e === "kokoro") void ensureKokoroVoices();
      if (e === "kitten") void ensureKittenVoices();
      if (e === "system") void ensureSystemVoices();
    },
    [ensureKokoroVoices, ensureKittenVoices, ensureSystemVoices],
  );

  // Classify once on mount; the ladder sets the DEFAULT engine only — a
  // manual user choice is never overridden.
  useEffect(() => {
    let cancelled = false;
    void classifyDevice().then((p) => {
      if (cancelled) return;
      profileRef.current = p;
      setProfile(p);
      if (!engineTouchedRef.current) {
        const ladderDefault = defaultEngineFor(p);
        applyEngineChoice(ladderDefault, false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [applyEngineChoice]);

  const setEngineChoice = useCallback(
    (e: EngineChoice) => applyEngineChoice(e, true),
    [applyEngineChoice],
  );

  // ---- streaming plumbing --------------------------------------------------

  /** Build the combined WAV blob URL from retained chunk PCM (export/replay). */
  const buildStreamAudioUrl = useCallback((s: StreamState) => {
    const combined = concatChunks(s.pcmParts, { sampleRate: s.sampleRate });
    audioDataRef.current = { samples: combined, sampleRate: s.sampleRate };
    const wav = encodeWav(combined, { sampleRate: s.sampleRate });
    const blob = new Blob([wav as unknown as BlobPart], { type: "audio/wav" });
    setAudioUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(blob);
    });
    setAudioSampleRate(s.sampleRate);
  }, []);

  /** All chunks received AND the queue drained: generation is fully done. */
  const finishStreamReady = useCallback((s: StreamState) => {
    if (streamRef.current !== s) return;
    streamRef.current = null;
    if (s.gapless) {
      // Playback finished: release the AudioContext.
      s.gapless.dispose();
      s.gapless = null;
    }
    setPhase("ready");
    setSynthProgress(null);
    clearGenerateFlag();
  }, []);

  /**
   * Stop: halt generation, silence playback, revoke queued chunk URLs
   * (acking each), but KEEP the retained PCM — the partial audio is
   * playable and exportable (phase `ready-partial`).
   */
  const finishStreamPartial = useCallback(
    (s: StreamState) => {
      if (streamRef.current === s) streamRef.current = null;
      if (s.gapless) {
        // Silence gapless playback; ack each scheduled-but-unplayed chunk
        // (backpressure accounting — safe no-ops once the job is aborted).
        for (const _ of s.gapless.stop()) s.stream.ack();
        s.gapless.dispose();
        s.gapless = null;
      }
      for (const el of s.els) {
        try { el.pause(); } catch { /* ignore */ }
        el.onended = null;
        el.onerror = null;
        el.removeAttribute("src");
        el.load();
      }
      if (s.currentChunk) {
        URL.revokeObjectURL(s.currentChunk.url);
        s.stream.ack();
        s.currentChunk = null;
      }
      for (const c of s.queue.clear()) {
        URL.revokeObjectURL(c.url);
        s.stream.ack();
      }
      s.playing = false;
      if (s.pcmParts.length > 0) {
        buildStreamAudioUrl(s);
        // Keep N-of-M so the UI can say "Stopped — partial audio (N of M)".
        setPhase("ready-partial");
      } else {
        setSynthProgress(null);
        setPhase("idle");
      }
      clearGenerateFlag();
    },
    [buildStreamAudioUrl],
  );

  /** Drop stream state without keeping audio (superseded / engine switch). */
  const teardownStream = useCallback(() => {
    const s = streamRef.current;
    streamRef.current = null;
    if (!s) return;
    if (s.gapless) {
      s.gapless.stop();
      s.gapless.dispose();
      s.gapless = null;
    }
    for (const el of s.els) {
      try { el.pause(); } catch { /* ignore */ }
      el.onended = null;
      el.onerror = null;
      el.removeAttribute("src");
    }
    if (s.currentChunk) URL.revokeObjectURL(s.currentChunk.url);
    for (const c of s.queue.clear()) URL.revokeObjectURL(c.url);
    // No acks: the job is dead; the worker ignores chunk-ack for dead jobs.
  }, []);

  /** Advance sequential chunk playback (ping-pong <audio> elements). */
  const pumpStream = useCallback(() => {
    const s = streamRef.current;
    // Gapless path needs no pumping: chunks are scheduled with precise
    // start times the moment they arrive (see handleStreamChunk).
    if (!s || s.playing || s.userStopped || s.gapless) return;
    const next = s.queue.shift();
    if (!next) {
      if (s.synthDone) finishStreamReady(s);
      return;
    }
    s.playing = true;
    s.currentChunk = next;
    const el = s.els[s.activeEl];
    el.onended = null;
    el.onerror = null;
    el.src = next.url;
    el.preload = "auto";
    // Preload the following chunk on the idle element while this one plays.
    const upcoming = s.queue.peek();
    const idle = s.els[1 - s.activeEl];
    if (upcoming) {
      idle.src = upcoming.url;
      idle.preload = "auto";
      idle.load();
    } else {
      idle.removeAttribute("src");
    }
    const consume = () => {
      URL.revokeObjectURL(next.url);
      s.stream.ack();
      s.playing = false;
      s.currentChunk = null;
      s.activeEl = (1 - s.activeEl) as 0 | 1;
      pumpStream();
    };
    el.onended = consume;
    el.onerror = consume; // a bad chunk must not stall the queue
    el.play().catch(() => {
      // Playback blocked (autoplay policy): keep the partial audio instead
      // of losing it — the user can press Play on what was generated.
      s.userStopped = true;
      finishStreamPartial(s);
    });
  }, [finishStreamReady, finishStreamPartial]);

  const handleStreamChunk = useCallback(
    (s: StreamState, chunk: StreamChunk) => {
      // Retain PCM for export even if we never play this chunk.
      s.pcmParts.push(chunk.samples);
      s.sampleRate = chunk.sampleRate;
      if (s.userStopped || streamRef.current !== s) {
        // Late chunk after Stop/teardown: keep PCM, ack immediately.
        s.stream.ack();
        return;
      }
      if (s.gapless) {
        // Gapless Web Audio path: schedule back-to-back with precise start
        // times. The player's onChunkEnded fires the ack per played chunk.
        s.gapless.playChunk(chunk.samples, chunk.sampleRate);
        if (phaseRef.current === "synthesizing") {
          // First audio is here: time-to-first-audio = time-to-first-chunk.
          setPhase("streaming");
        }
        return;
      }
      const wav = encodeWav(chunk.samples, { sampleRate: chunk.sampleRate });
      const url = URL.createObjectURL(
        new Blob([wav as unknown as BlobPart], { type: "audio/wav" }),
      );
      const rec: QueuedChunk = { index: chunk.index, url, samples: chunk.samples };
      if (!s.queue.push(rec)) {
        // Unreachable in practice: the worker pauses at the high-water mark.
        // If it ever happens, drop backpressure (ack now) rather than grow
        // memory without bound.
        URL.revokeObjectURL(url);
        s.stream.ack();
        return;
      }
      if (phaseRef.current === "synthesizing") {
        // First audio is here: time-to-first-audio = time-to-first-chunk.
        setPhase("streaming");
      }
      pumpStream();
    },
    [pumpStream],
  );

  // ---- generation ----------------------------------------------------------

  // ---- neural engines (kokoro | kitten): shared streaming generation --------

  const generateNeural = useCallback(
    async (
      engineId: "kokoro" | "kitten",
      text: string,
      voiceId: string,
      speed: number,
      gapless: GaplessPlayer | null,
    ) => {
      // Per-engine state slots — one neural engine is active at a time.
      const slot =
        engineId === "kokoro"
          ? {
              loadedRef: kokoroLoadedRef,
              setLoaded: setKokoroLoaded,
              setLoading: setKokoroLoading,
              voicesRef,
              setVoices,
            }
          : {
              loadedRef: kittenLoadedRef,
              setLoaded: setKittenLoaded,
              setLoading: setKittenLoading,
              voicesRef: kittenVoicesRef,
              setVoices: setKittenVoices,
            };
      // Neural-engine path (worker, streaming). Shared by Kokoro and KittenTTS Nano.
      const mgr = getEngineManager();
      const profile =
        profileRef.current ?? (await classifyDevice().catch(() => null));
      if (profile) {
        profileRef.current = profile;
        setProfile(profile);
      }
      const p = profileRef.current;
      const chunkChars = p?.chunkChars ?? 400;
      const highWater = p?.streamHighWater ?? 3;
      // Throttle load-progress state: ~250ms / >=1% — ends the render storm
      // during the model download. Real percentages only; loadProgress stays
      // null ("Preparing…") until the first real event — no fake seed.
      const throttledLoad = createThrottledProgress((f) => setLoadProgress(f));

      try {
        if (!slot.loadedRef.current) {
          setPhase("loading-model");
          slot.setLoading(true);
          setLoadProgress(null);
          const dev = await mgr.loadModel(throttledLoad, {
            engineId,
            numThreads:
              p && p.ortThreads > 0 ? p.ortThreads : undefined,
            sameOriginWasm: p?.ortWasmBase === "same-origin",
          });
          setDevice(dev);
          slot.setLoaded(true);
          slot.loadedRef.current = true;
          slot.setLoading(false);
          if (slot.voicesRef.current.length === 0)
            slot.setVoices(await mgr.getVoices(engineId));
        }
        // No fake {done: 0, total: 1} seed — real synth-progress fills it.
        setPhase("synthesizing");
        setSynthProgress(null);

        const s: StreamState = {
          stream: null as unknown as StreamPromise,
          queue: new StreamQueue<QueuedChunk>(highWater),
          pcmParts: [],
          sampleRate: 24000,
          els: [new Audio(), new Audio()],
          activeEl: 0,
          playing: false,
          synthDone: false,
          currentChunk: null,
          userStopped: false,
          gapless,
          endedChunks: 0,
          totalChunks: null,
        };
        if (gapless) {
          // Ack each chunk as it finishes playing (backpressure), and end
          // the stream once the last scheduled chunk has played out. The
          // closure reads s.stream once the stream exists below.
          gapless.setEvents({
            onChunkEnded: () => {
              s.stream.ack();
              s.endedChunks++;
              if (
                s.synthDone &&
                s.totalChunks !== null &&
                s.endedChunks >= s.totalChunks
              ) {
                finishStreamReady(s);
              }
            },
          });
        }
        const stream = mgr.synthesizeStream(
          text,
          voiceId,
          speed,
          {
            onChunk: (chunk) => handleStreamChunk(s, chunk),
            onProgress: (done, total) => setSynthProgress({ done, total }),
          },
          { engineId, chunkChars, highWater },
        );
        s.stream = stream;
        streamRef.current = s;

        const result = await stream;
        // All chunks received. The queue drains naturally (phase stays
        // "streaming" with "Playing… finishing up"); the combined WAV is
        // built now so replay/download are ready the moment it drains.
        s.synthDone = true;
        s.sampleRate = result.sampleRate;
        s.totalChunks = result.chunkCount;
        buildStreamAudioUrl(s);
        if (s.gapless) {
          // Gapless path has no queue to drain: finish when the last
          // scheduled chunk ends (the onChunkEnded handler counts up to
          // totalChunks; it may already have been reached).
          if (s.endedChunks >= s.totalChunks) finishStreamReady(s);
        } else {
          pumpStream();
        }
      } catch (e) {
        const s = streamRef.current;
        if (e instanceof DOMException && e.name === "AbortError") {
          if (s?.userStopped) {
            // Stop during streaming: keep the partial audio.
            finishStreamPartial(s);
          } else {
            teardownStream();
            setPhase("idle");
            slot.setLoading(false);
            setSynthProgress(null);
          }
        } else {
          teardownStream();
          fail(
            e instanceof Error
              ? `Speech generation failed: ${e.message}`
              : "Speech generation failed.",
          );
        }
        clearGenerateFlag();
      }
    },
    [
      fail,
      dismissError,
      teardownStream,
      handleStreamChunk,
      pumpStream,
      buildStreamAudioUrl,
      finishStreamPartial,
    ],
  );

  const generate = useCallback(
    async (text: string, voiceId: string, speed: number) => {
      const validation = validateTextInput(text, MAX_CHARS);
      if (validation) {
        fail(validation);
        return;
      }
      dismissError();
      markGenerateStart();
      teardownStream();

      // Gapless playback needs the AudioContext created AND resumed
      // synchronously inside this tap gesture — iOS Safari will not unlock
      // it if creation is deferred past the click handler. unlock() false
      // => the legacy <audio> ping-pong path (gaps, but audible).
      let gapless: GaplessPlayer | null = null;
      if (engineChoiceRef.current !== "system") {
        const candidate = new GaplessPlayer();
        if (candidate.unlock()) gapless = candidate;
        else candidate.dispose();
      }

      if (engineChoiceRef.current === "system") {
        // Tier-0 fallback: speak directly, no downloadable audio.
        if (!systemEngineRef.current) systemEngineRef.current = new SystemEngine();
        setPhase("synthesizing");
        try {
          await systemEngineRef.current.synthesize(text, voiceId, { speed });
          setPhase("ready");
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") setPhase("idle");
          else fail(e instanceof Error ? e.message : String(e));
        } finally {
          clearGenerateFlag();
        }
        return;
      }

            // Neural engines (kokoro | kitten) via the worker, streaming.
      // The gapless player is disposed by the stream lifecycle
      // (teardownStream / finishStreamPartial / finishStreamReady paths);
      // if generateNeural throws before the stream starts, dispose here.
      try {
        return await generateNeural(
          engineChoiceRef.current === "kitten" ? "kitten" : "kokoro",
          text,
          voiceId,
          speed,
          gapless,
        );
      } catch (e) {
        gapless?.dispose();
        throw e;
      }
    },
    [
      fail,
      dismissError,
      generateNeural,
    ],
  );

  const cancel = useCallback(() => {
    const s = streamRef.current;
    if (s && phaseRef.current === "streaming") {
      // Stop (not Cancel): halt generation, keep the partial audio.
      // Playback silences now; the AbortError handler finalizes to
      // ready-partial with everything generated so far.
      s.userStopped = true;
      for (const el of s.els) {
        try { el.pause(); } catch { /* ignore */ }
      }
      s.stream.cancel();
      return;
    }
    getEngineManager().cancel();
    teardownStream();
    systemEngineRef.current?.unload().catch(() => undefined);
    clearGenerateFlag();
    setPhase("idle");
    setSynthProgress(null);
    setKokoroLoading(false);
    setKittenLoading(false);
  }, [teardownStream]);

  const getAudioData = useCallback(() => {
    if (audioDataRef.current) return audioDataRef.current;
    // Partial (or unfinalized) stream: concat retained chunks on demand.
    const s = streamRef.current;
    if (s && s.pcmParts.length > 0) {
      const combined = concatChunks(s.pcmParts, { sampleRate: s.sampleRate });
      return { samples: combined, sampleRate: s.sampleRate };
    }
    return null;
  }, []);

  const unloadModel = useCallback(async () => {
    getEngineManager().cancel();
    teardownStream();
    // Worker terminate+recreate is the memory reset: the ORT WASM heap is
    // process-global and engine.unload() cannot free it.
    await getEngineManager().unloadModel().catch(() => undefined);
    const { deleteModelCaches } = await import("@/lib/model-store");
    await deleteModelCaches();
    audioDataRef.current = null;
    setAudioUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setAudioSampleRate(null);
    setKokoroLoaded(false);
    kokoroLoadedRef.current = false;
    setKittenLoaded(false);
    kittenLoadedRef.current = false;
    setDevice(null);
    setLoadProgress(null);
    setPhase("idle");
    clearGenerateFlag();
    previewCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
    previewCacheRef.current.clear();
  }, [teardownStream]);

  // ---- voice preview (real short synthesis, cached) -------------------------

  const previewVoice = useCallback(
    async (voice: Voice, engine: EngineChoice) => {
      const cacheKey = `${engine}:${voice.id}`;
      // Cached preview: just play it.
      const cached = previewCacheRef.current.get(cacheKey);
      if (cached) {
        setPreviewingId(voice.id);
        const el = (previewAudioRef.current ??= new Audio());
        el.src = cached;
        el.onended = () => setPreviewingId(null);
        await el.play().catch(() => setPreviewingId(null));
        return;
      }
      setPreviewingId(voice.id);
      try {
        if (engine === "system") {
          if (!systemEngineRef.current) systemEngineRef.current = new SystemEngine();
          await systemEngineRef.current.synthesize(
            PREVIEW_TEXT(voice.name),
            voice.id,
            {},
          );
        } else {
          // Neural engines (kokoro | kitten) via the worker.
          const nid = engine === "kitten" ? "kitten" : "kokoro";
          const slot =
            nid === "kokoro"
              ? { loadedRef: kokoroLoadedRef, setLoaded: setKokoroLoaded }
              : { loadedRef: kittenLoadedRef, setLoaded: setKittenLoaded };
          const mgr = getEngineManager();
          const p = profileRef.current;
          const throttledLoad = createThrottledProgress((f) => setLoadProgress(f));
          if (!slot.loadedRef.current) {
            const dev = await mgr.loadModel(throttledLoad, {
              engineId: nid,
              numThreads: p && p.ortThreads > 0 ? p.ortThreads : undefined,
              sameOriginWasm: p?.ortWasmBase === "same-origin",
            });
            setDevice(dev);
            slot.setLoaded(true);
            slot.loadedRef.current = true;
          }
          const result = await mgr.synthesize(PREVIEW_TEXT(voice.name), voice.id, 1, {}, nid);
          const wav = encodeWav(result.samples, { sampleRate: result.sampleRate });
          const url = URL.createObjectURL(
            new Blob([wav as unknown as BlobPart], { type: "audio/wav" }),
          );
          previewCacheRef.current.set(cacheKey, url);
          const el = (previewAudioRef.current ??= new Audio());
          el.src = url;
          el.onended = () => setPreviewingId(null);
          await el.play().catch(() => setPreviewingId(null));
        }
      } catch {
        setPreviewingId(null);
      }
    },
    [],
  );

  const wasInterrupted = useCallback(() => consumeStaleGenerateFlag(), []);

  const value = useMemo<TTSContextValue>(
    () => ({
      engineChoice,
      setEngineChoice,
      profile,
      kokoroLoaded,
      kokoroLoading,
      kittenLoaded,
      kittenLoading,
      kittenVoices,
      loadProgress,
      device,
      voices,
      voicesLoading,
      systemAvailable,
      systemVoices,
      phase,
      synthProgress,
      audioUrl,
      audioSampleRate,
      error,
      generate,
      cancel,
      previewVoice,
      previewingId,
      dismissError,
      getAudioData,
      ensureVoices: ensureKokoroVoices,
      unloadModel,
      wasInterrupted,
    }),
    [
      engineChoice, setEngineChoice, profile, kokoroLoaded, kokoroLoading,
      kittenLoaded, kittenLoading, kittenVoices,
      loadProgress, device, voices, voicesLoading, systemAvailable,
      systemVoices, phase, synthProgress, audioUrl, audioSampleRate, error,
      generate, cancel, previewVoice, previewingId, dismissError,
      getAudioData, ensureKokoroVoices, unloadModel, wasInterrupted,
    ],
  );

  return <TTSContext.Provider value={value}>{children}</TTSContext.Provider>;
}

export { DEFAULT_VOICE_ID };
