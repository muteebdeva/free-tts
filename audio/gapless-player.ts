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
 * click handler. A one-time pointerdown backup re-resumes if the first
 * attempt raced. If Web Audio is unavailable, unlock() returns false and
 * the caller falls back to the legacy <audio> ping-pong path (gaps, but
 * audible) — never silence.
 */
import { trimSilence } from "./concat";

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
   */
  unlock(): boolean {
    if (this.ctx) return true;
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
