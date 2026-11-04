/**
 * Tier-0 fallback engine: the browser's built-in speechSynthesis.
 *
 * Zero download, zero cost, works everywhere — but it is a thin wrapper over
 * OS voices, so voice identity/quality/coverage are device-dependent and the
 * app CANNOT capture PCM (no WAV/MP3 export). This engine speaks directly and
 * returns no audio data; `capabilities.audioExport` is false so the UI hides
 * download controls instead of faking them.
 *
 * Privacy: only voices with `localService === true` are used, so synthesis
 * stays on-device. Chrome/Edge "network" voices (which send text to vendor
 * servers) are excluded — see MODEL-RESEARCH.md §3.
 */
import type {
  EngineCapabilities,
  GenerationOptions,
  SynthesisResult,
  TTSEngine,
  Voice,
} from "../engine-interface";

function supported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Local (on-device) voices only — never network voices. */
function localVoices(): SpeechSynthesisVoice[] {
  if (!supported()) return [];
  return window.speechSynthesis.getVoices().filter((v) => v.localService);
}

function toVoice(v: SpeechSynthesisVoice, index: number): Voice {
  return {
    // voiceURI is per-device; prefix with index for stability within a session.
    id: `system:${index}:${v.voiceURI}`,
    name: v.name,
    language: v.lang || "und",
    gender: null, // the API does not expose gender — never invented
    accent: null,
    description: `System voice · ${v.lang || "unknown language"} · on-device`,
  };
}

export class SystemEngine implements TTSEngine {
  readonly id = "system";
  readonly label = "System voices";
  /** The OS speech engine runs wherever the OS runs it — not a compute device we choose. */
  readonly activeDevice = "wasm" as const;

  readonly capabilities: EngineCapabilities = {
    // Device-dependent: populated honestly as "varies by device" in the UI.
    languages: [],
    speedControl: true,
    audioExport: false,
    limitations: [
      "Voices come from your device/OS — the list differs on every device.",
      "Quality varies widely; some devices have no local voices at all.",
      "Audio cannot be downloaded — system voices play only, they are not recorded.",
      "Some languages may be missing if your OS has no voice installed.",
    ],
  };

  private cache: Voice[] | null = null;

  isLoaded(): boolean {
    return this.cache !== null;
  }

  async load(): Promise<void> {
    if (!supported()) {
      throw new Error("SystemEngine: speechSynthesis is not available in this browser");
    }
    this.cache = await resolveVoices();
  }

  async getVoices(): Promise<Voice[]> {
    if (!this.cache) await this.load();
    return this.cache!;
  }

  async synthesize(
    text: string,
    voiceId: string,
    options: GenerationOptions = {},
  ): Promise<SynthesisResult> {
    if (!supported()) throw new Error("SystemEngine: speechSynthesis unavailable");
    const voices = await this.getVoices();
    const synth = window.speechSynthesis;

    return new Promise<SynthesisResult>((resolve, reject) => {
      const utter = new SpeechSynthesisUtterance(text);
      const match = voices.find((v) => v.id === voiceId);
      if (match) {
        const native = localVoices().find((nv, i) => toVoice(nv, i).id === voiceId);
        if (native) utter.voice = native;
      }
      // Default: let the browser pick (usually the OS default voice).
      utter.rate = clampRate(options.speed ?? 1);
      utter.onend = () =>
        resolve({ samples: new Float32Array(0), sampleRate: 0 });
      utter.onerror = (ev) =>
        reject(new Error(`SystemEngine: speech failed (${ev.error || "unknown"})`));

      if (options.signal) {
        if (options.signal.aborted) {
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        options.signal.addEventListener(
          "abort",
          () => {
            synth.cancel();
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      }
      // Chrome requires cancel() before speak() to flush stale queues.
      synth.cancel();
      synth.speak(utter);
    });
  }

  async unload(): Promise<void> {
    if (supported()) window.speechSynthesis.cancel();
    this.cache = null;
  }
}

/**
 * Resolve the voice list. Chrome populates voices asynchronously, so wait for
 * `voiceschanged` (with a timeout) when the first read is empty.
 */
function resolveVoices(timeoutMs = 3000): Promise<Voice[]> {
  const synth = window.speechSynthesis;
  const read = () => localVoices().map(toVoice);
  const first = read();
  if (first.length > 0) return Promise.resolve(first);

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      synth.removeEventListener("voiceschanged", onChange);
      resolve(read()); // may legitimately be empty — caller handles it
    }, timeoutMs);
    const onChange = () => {
      window.clearTimeout(timer);
      synth.removeEventListener("voiceschanged", onChange);
      resolve(read());
    };
    synth.addEventListener("voiceschanged", onChange);
  });
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.min(2, Math.max(0.5, rate));
}
