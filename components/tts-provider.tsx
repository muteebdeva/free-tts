"use client";

/**
 * TTSProvider: shared client state for the whole app.
 *
 * Owns the EngineManager singleton (Kokoro worker), the SystemEngine fallback,
 * voice lists, generation lifecycle, and preview-audio caching. Pages and
 * components consume this context — nobody talks to engines directly.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getEngineManager } from "@/lib/engine-manager";
import { SystemEngine } from "@/engines/system/system-engine";
import type { Voice } from "@/engines/engine-interface";
import { validateTextInput } from "@/lib/text-chunk";
import { encodeWav } from "@/audio/wav-encoder";
import { DEFAULT_VOICE_ID } from "@/engines/kokoro/voices";

export type EngineChoice = "kokoro" | "system";
export type Phase = "idle" | "loading-model" | "synthesizing" | "ready" | "error";

export const MAX_CHARS = 5000;
const PREVIEW_TEXT = (name: string) => `Hello, I'm ${name}. This is how I sound.`;

interface TTSContextValue {
  engineChoice: EngineChoice;
  setEngineChoice: (e: EngineChoice) => void;

  // Kokoro engine state
  kokoroLoaded: boolean;
  kokoroLoading: boolean;
  loadProgress: number; // 0..1
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
}

const TTSContext = createContext<TTSContextValue | null>(null);

export function useTTS(): TTSContextValue {
  const ctx = useContext(TTSContext);
  if (!ctx) throw new Error("useTTS must be used inside TTSProvider");
  return ctx;
}

export function TTSProvider({ children }: { children: ReactNode }) {
  const [engineChoice, setEngineChoiceState] = useState<EngineChoice>("kokoro");
  const [kokoroLoaded, setKokoroLoaded] = useState(false);
  const [kokoroLoading, setKokoroLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [device, setDevice] = useState<string | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [systemVoices, setSystemVoices] = useState<Voice[]>([]);
  const [systemAvailable, setSystemAvailable] = useState(false);

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

  const fail = useCallback((message: string) => {
    setError(message);
    setPhase("error");
    setKokoroLoading(false);
    setSynthProgress(null);
  }, []);

  const dismissError = useCallback(() => {
    setError(null);
    setPhase((p) => (p === "error" ? "idle" : p));
  }, []);

  // ---- voice loading ------------------------------------------------------

  const ensureKokoroVoices = useCallback(async () => {
    if (voices.length > 0 || voicesLoading) return;
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
  }, [voices.length, voicesLoading, fail]);

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

  // ---- engine switching ----------------------------------------------------

  const setEngineChoice = useCallback(
    (e: EngineChoice) => {
      // Cancel anything in flight when switching engines.
      getEngineManager().cancel();
      systemEngineRef.current?.unload().catch(() => undefined);
      setEngineChoiceState(e);
      setPhase("idle");
      setError(null);
      setSynthProgress(null);
      if (e === "kokoro") void ensureKokoroVoices();
      if (e === "system") void ensureSystemVoices();
    },
    [ensureKokoroVoices, ensureSystemVoices],
  );

  // ---- generation ----------------------------------------------------------

  const generate = useCallback(
    async (text: string, voiceId: string, speed: number) => {
      const validation = validateTextInput(text, MAX_CHARS);
      if (validation) {
        fail(validation);
        return;
      }
      dismissError();

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
        }
        return;
      }

      // Kokoro path (worker).
      const mgr = getEngineManager();
      try {
        if (!kokoroLoaded) {
          setPhase("loading-model");
          setKokoroLoading(true);
          const dev = await mgr.loadModel(setLoadProgress);
          setDevice(dev);
          setKokoroLoaded(true);
          setKokoroLoading(false);
          if (voices.length === 0) setVoices(await mgr.getVoices());
        }
        setPhase("synthesizing");
        setSynthProgress({ done: 0, total: 1 });
        const result = await mgr.synthesize(text, voiceId, speed, {
          onProgress: (done, total) => setSynthProgress({ done, total }),
        });
        audioDataRef.current = {
          samples: result.samples,
          sampleRate: result.sampleRate,
        };
        const wav = encodeWav(result.samples, { sampleRate: result.sampleRate });
        const blob = new Blob([wav as unknown as BlobPart], { type: "audio/wav" });
        setAudioUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
        setAudioSampleRate(result.sampleRate);
        setPhase("ready");
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          setPhase("idle");
          setKokoroLoading(false);
        } else {
          fail(
            e instanceof Error
              ? `Speech generation failed: ${e.message}`
              : "Speech generation failed.",
          );
        }
      } finally {
        setSynthProgress(null);
      }
    },
    [kokoroLoaded, voices.length, fail, dismissError],
  );

  const cancel = useCallback(() => {
    getEngineManager().cancel();
    systemEngineRef.current?.unload().catch(() => undefined);
    setPhase("idle");
    setSynthProgress(null);
    setKokoroLoading(false);
  }, []);

  const getAudioData = useCallback(
    () => audioDataRef.current,
    [],
  );

  const unloadModel = useCallback(async () => {
    getEngineManager().cancel();
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
    setDevice(null);
    setLoadProgress(0);
    setPhase("idle");
    previewCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
    previewCacheRef.current.clear();
  }, []);

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
          const mgr = getEngineManager();
          if (!kokoroLoaded) {
            const dev = await mgr.loadModel(setLoadProgress);
            setDevice(dev);
            setKokoroLoaded(true);
          }
          const result = await mgr.synthesize(PREVIEW_TEXT(voice.name), voice.id, 1);
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
    [kokoroLoaded],
  );

  const value = useMemo<TTSContextValue>(
    () => ({
      engineChoice,
      setEngineChoice,
      kokoroLoaded,
      kokoroLoading,
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
    }),
    [
      engineChoice, setEngineChoice, kokoroLoaded, kokoroLoading, loadProgress,
      device, voices, voicesLoading, systemAvailable, systemVoices, phase,
      synthProgress, audioUrl, audioSampleRate, error, generate, cancel,
      previewVoice, previewingId, dismissError, getAudioData, ensureKokoroVoices,
      unloadModel,
    ],
  );

  return <TTSContext.Provider value={value}>{children}</TTSContext.Provider>;
}

export { DEFAULT_VOICE_ID };
