/**
 * Throttled progress callback — ends the render storm during the ~92 MB
 * model download (per-file progress events from transformers.js can fire
 * hundreds of times).
 *
 * Pass-through rule: the first event and the final (fraction >= 1) always
 * go through; otherwise an update is emitted only when at least
 * `minIntervalMs` has elapsed since the last emission AND the value moved
 * by at least `minDelta`. Values are clamped to [0, 1].
 */
export interface ThrottleOptions {
  minIntervalMs?: number;
  minDelta?: number;
}

export function createThrottledProgress(
  fn: (fraction: number) => void,
  opts: ThrottleOptions = {},
): (fraction: number) => void {
  const minIntervalMs = opts.minIntervalMs ?? 250;
  const minDelta = opts.minDelta ?? 0.01;
  let lastSent = 0;
  let lastTime = 0;
  let first = true;

  return (fraction: number) => {
    const clamped = Math.min(1, Math.max(0, fraction));
    const now = Date.now();
    if (
      first ||
      clamped >= 1 ||
      (now - lastTime >= minIntervalMs && Math.abs(clamped - lastSent) >= minDelta)
    ) {
      first = false;
      lastSent = clamped;
      lastTime = now;
      fn(clamped);
    }
  };
}
