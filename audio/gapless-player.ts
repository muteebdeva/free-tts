/**
 * GaplessStreamPlayer: gapless streaming TTS playback via the Web Audio API.
 *
 * The old streaming path played each chunk through sequential <audio>
 * elements (per-chunk WAV blob + element swap + decode), which produced
 * audible sentence-by-sentence gaps. This player instead decodes each
 * chunk's raw PCM straight into an AudioBuffer and schedules
 * AudioBufferSourceNodes back-to-back with precise start times derived
 * from accumulated chunk durations — chunk N+1 begins exactly where chunk
 * N ends, so zero silence is inserted between sentences.
 *
 * Chunk joints use the same treatment as the download stitcher
 * (audio/concat.ts): leading/trailing near-digital silence is trimmed
 * (same thresholds) and neighbours overlap by an 8 ms equal-power
 * crossfade, which de-clicks the joints. Playback therefore sounds like
 * the stitched WAV download (minus its final global peak normalisation,
 * which cannot be computed until the whole text is known — models are
 * well-levelled and the crossfade is equal-power, so this is inaudible).
 *
 * iOS: the AudioContext MUST be created and resumed inside the user's tap
 * gesture — unlock() is called synchronously from the Generate button's
 * click handler. unlock() also promotes the page's audio session to the
 * "playback" category (navigator.audioSession + a silent <audio> kick):
 * without this, iOS routes Web Audio through the silent-switch-muted
 * "ambient" channel — the classic whisper-quiet-iPhone symptom. Callers
 * must await ensureUnlocked() after unlock(): a context iOS kept suspended
 * would schedule silence (and stall the stream's backpressure acks), so a
 * false result means "use the legacy <audio> ping-pong fallback", which is
 * gaps-but-audible — never silence.
 */
import { trimSilence } from "./concat";
import { encodeWav } from "./wav-encoder";

/**
 * Promote the page's audio session to the "playback" category.
 *
 * iOS routes Web Audio API output through the "ambient" audio session,
 * which the hardware silent switch mutes — while <audio> elements use the
 * "playback" session, which ignores the switch. That split is exactly the
 * "loud on the old <audio> path, whisper-quiet on Web Audio" symptom:
 * the context runs, the gains are correct, but iOS attenuates/mutes the
 * ambient channel.
 *
 * Two mechanisms, both must run inside a user gesture:
 *  1. iOS 17+ (Safari 17+): the official API — one line.
 *  2. Older iOS: playing even a silent <audio> element flips the session
 *     to "playback" for the whole page (the well-known unmute trick).
 * One-time per page load; harmless everywhere else.
 */
let sessionPromoted = false;
export function promoteAudioSession(): void {
  if (sessionPromoted) return;
  sessionPromoted = true;
  try {
    const nav = navigator as unknown as {
      audioSession?: { type?: string };
    };
    if (nav.audioSession) nav.audioSession.type = "playback";
  } catch {
    /* not supported — the <audio> kick below covers older iOS */
  }
  try {
    // 0.1 s of digital silence; its only job is the session flip.
    const wav = encodeWav(new Float32Array(2400), { sampleRate: 24000 });
    const url = URL.createObjectURL(
      new Blob([wav as unknown as BlobPart], { type: "audio/wav" }),
    );
    const el = new Audio(url);
    const done = () => URL.revokeObjectURL(url);
    // play() in the gesture is allowed; failure just means the kick
    // didn't happen — the Web Audio path is unaffected.
    void el.play().then(done, done);
  } catch {
    /* ignore — best effort */
  }
}

/** Test hook: allow the promotion to run again. */
export function resetSessionPromotionForTests(): void {
  sessionPromoted = false;
}

export interface GaplessPlayerEvents {
  /** A scheduled chunk finished playing (the backpressure ack point). */
  onChunkEnded?: (index: number) => void;
}

export interface ScheduledChunk {
  index: number;
  /** AudioContext-clock start time, seconds. */
  start: number;
  /** Audible duration, seconds (post-trim). */
  duration: number;
}

/** Inter-chunk crossfade, seconds — mirrors concatChunks' 8 ms default. */
export const GAPLESS_CROSSFADE_SEC = 0.008;
/** Silence-trim policy — mirrors concatChunks' defaults. */
const SILENCE_THRESHOLD = 0.005;
const MAX_TRIM_MS = 400;
const CURVE_POINTS = 32;

function crossfadeCurves(): { fadeIn: Float32Array; fadeOut: Float32Array } {
  const fadeIn = new Float32Array(CURVE_POINTS);
  const fadeOut = new Float32Array(CURVE_POINTS);
  for (let i = 0; i < CURVE_POINTS; i++) {
    const t = i / (CURVE_POINTS - 1);
    // Equal-power: sin^2 / cos^2 — identical curves to concatChunks.
    fadeIn[i] = Math.sin((t * Math.PI) / 2) ** 2;
    fadeOut[i] = Math.cos((t * Math.PI) / 2) ** 2;
  }
  return { fadeIn, fadeOut };
}

interface ActiveChunk {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export class GaplessPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private events: GaplessPlayerEvents;
  /** Audio-clock time when the next chunk's audible content should start. */
  private cursor = 0;
  private nextIndex = 0;
  private lastScheduledDuration = 0;
  private active = new Map<number, ActiveChunk>();
  private backupListener: (() => void) | null = null;
  private dead = false;
  private readonly fadeIn: Float32Array;
  private readonly fadeOut: Float32Array;

  /** Recorded schedule — read by unit tests and the verify gate. */
  readonly timeline: ScheduledChunk[] = [];
  /** Post-trim sample count per received chunk — read by the verify gate. */
  readonly trimmedLengths: number[] = [];

  constructor(events: GaplessPlayerEvents = {}) {
    this.events = events;
    const { fadeIn, fadeOut } = crossfadeCurves();
    this.fadeIn = fadeIn;
    this.fadeOut = fadeOut;
  }

  /** Replace the event handlers (the provider wires these up after creation). */
  setEvents(events: GaplessPlayerEvents): void {
    this.events = events;
  }

  /**
   * Synchronous gesture-time init. MUST be called inside the user tap that
   * starts generation (iOS will not unlock the AudioContext otherwise).
   * Returns false when Web Audio is unavailable — use the fallback path.
   *
   * NOTE: returning true means "a context exists", NOT "audio is audible".
   * iOS may keep the context suspended even after a gesture-time resume, and
   * (separately) may route it through the silent-switch-muted ambient
   * channel. Callers must await ensureUnlocked() before committing to this
   * path; the session promotion below handles the ambient-channel case.
   */
  unlock(): boolean {
    // Session promotion FIRST: without it, iOS plays Web Audio on the
    // "ambient" channel (silent-switch-muted) — the whisper-quiet symptom.
    promoteAudioSession();
    if (this.ctx) {
      // Already created (e.g. a retried generate): a raced gesture may have
      // left it suspended — retry the resume instead of blindly reporting
      // success. The caller still verifies via ensureUnlocked().
      void this.ctx.resume().catch(() => undefined);
      return true;
    }
    try {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.cursor = this.ctx.currentTime;
      // The resume() call inside the gesture is what unlocks iOS. The
      // one-time backup below covers the case where this raced.
      void this.ctx.resume().catch(() => undefined);
      const backup = () => this.ensureRunning();
      this.backupListener = backup;
      window.addEventListener("pointerdown", backup, { once: true });
      return true;
    } catch {
      this.ctx = null;
      this.master = null;
      return false;
    }
  }

  /**
   * Await the gesture-time resume and report whether the context is really
   * running. MUST be awaited after unlock() before the caller commits to
   * the Web Audio path: scheduling into a suspended context is silence,
   * and (worse) the chunk-end callbacks never fire, so the worker's
   * backpressure acks stall and the stream never completes — no audio AND
   * no download. Resolving false means "use the <audio> fallback".
   */
  async ensureUnlocked(): Promise<boolean> {
    const ctx = this.ctx;
    if (!ctx) return false;
    if (ctx.state === "running") return true;
    try {
      // A second resume covers the iOS quirk where the first gesture-time
      // resume is ignored.
      await ctx.resume();
    } catch {
      return false;
    }
    // Read fresh: the state may have changed while resuming (TS narrows the
    // earlier check away, so go through a plain string).
    const state: string = ctx.state;
    return state === "running";
  }

  /** True when the context exists and is running (audio is audible). */
  get running(): boolean {
    return !!this.ctx && this.ctx.state === "running";
  }

  /** Best-effort resume (first chunk + backup tap listener). */
  ensureRunning(): void {
    if (this.ctx && this.ctx.state === "suspended") {
      void this.ctx.resume().catch(() => undefined);
    }
  }

  /**
   * Schedule one chunk back-to-back after previously scheduled audio.
   * Late chunks (generation slower than playback) start ASAP — the only
   * gap possible is audio that does not exist yet.
   */
  playChunk(samples: Float32Array, sampleRate: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.dead) return;
    this.ensureRunning();
    const index = this.nextIndex++;
    // Fully-silent chunk (no sample above the silence floor): nothing
    // audible to schedule. Skipping it inserts no gap; the ack must still
    // fire exactly once per received chunk (backpressure accounting).
    // (trimSilence below is bounded to 400 ms per edge, so this explicit
    // check is what catches a long all-silence chunk.)
    let hasSignal = false;
    for (let i = 0; i < samples.length; i++) {
      if (Math.abs(samples[i]) >= SILENCE_THRESHOLD) {
        hasSignal = true;
        break;
      }
    }
    if (!hasSignal) {
      this.trimmedLengths.push(0);
      queueMicrotask(() => this.events.onChunkEnded?.(index));
      return;
    }
    const trimmed = trimSilence(
      samples,
      SILENCE_THRESHOLD,
      Math.round((sampleRate * MAX_TRIM_MS) / 1000),
    );
    if (trimmed.length === 0) {
      // Unreachable given the hasSignal check above, but kept as a guard:
      // an empty schedule must never swallow its ack.
      this.trimmedLengths.push(0);
      queueMicrotask(() => this.events.onChunkEnded?.(index));
      return;
    }
    const buf = ctx.createBuffer(1, trimmed.length, sampleRate);
    buf.getChannelData(0).set(trimmed);
    const duration = buf.duration;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    src.connect(gain);
    gain.connect(master);

    // Crossfade against the still-playing previous chunk; clamped to half
    // of either chunk so tiny chunks never invert the overlap. No previous
    // chunk (or a skipped all-silence one) => no crossfade.
    const prev = index > 0 ? this.active.get(index - 1) : undefined;
    let xfade = GAPLESS_CROSSFADE_SEC;
    if (!prev || this.lastScheduledDuration <= 0) {
      xfade = 0;
    } else {
      xfade = Math.min(xfade, duration / 2, this.lastScheduledDuration / 2);
      if (xfade < 0.001) xfade = 0;
    }

    let start: number;
    if (xfade === 0) {
      start = Math.max(ctx.currentTime, this.cursor);
      gain.gain.setValueAtTime(1, start);
    } else {
      start = Math.max(ctx.currentTime, this.cursor - xfade);
      // Outgoing chunk fades out over the overlap…
      if (prev) {
        prev.gain.gain.setValueAtTime(1, start);
        prev.gain.gain.setValueCurveAtTime(this.fadeOut, start, xfade);
      }
      // …incoming chunk fades in.
      gain.gain.setValueAtTime(0, start);
      gain.gain.setValueCurveAtTime(this.fadeIn, start, xfade);
    }
    src.start(start);
    // Stop just past the buffer end so onended fires and resources release.
    src.stop(start + duration + 0.05);
    this.active.set(index, { source: src, gain });
    this.timeline.push({ index, start, duration });
    this.trimmedLengths.push(trimmed.length);
    this.lastScheduledDuration = duration;
    this.cursor = start + duration;
    src.onended = () => {
      this.active.delete(index);
      this.events.onChunkEnded?.(index);
    };
  }

  /**
   * Silence now. Returns the indexes of chunks that were scheduled but had
   * not finished — the caller acks each one (backpressure accounting).
   */
  stop(): number[] {
    const pending = [...this.active.keys()];
    for (const [, a] of this.active) {
      a.source.onended = null;
      try {
        a.source.stop();
      } catch {
        // Already stopped — ignore.
      }
    }
    this.active.clear();
    return pending;
  }

  dispose(): void {
    this.dead = true;
    this.stop();
    if (this.backupListener) {
      window.removeEventListener("pointerdown", this.backupListener);
      this.backupListener = null;
    }
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    if (ctx) void ctx.close().catch(() => undefined);
  }
}
