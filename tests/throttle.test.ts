import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createThrottledProgress } from "../lib/throttle";

describe("createThrottledProgress", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("always passes the first event through", () => {
    const seen: number[] = [];
    const throttled = createThrottledProgress((f) => seen.push(f));
    throttled(0.001);
    expect(seen).toEqual([0.001]);
  });

  it("suppresses sub-delta updates inside the interval", () => {
    const seen: number[] = [];
    const throttled = createThrottledProgress((f) => seen.push(f));
    throttled(0.1);
    vi.advanceTimersByTime(100);
    throttled(0.105); // <1% delta, <250ms
    expect(seen).toEqual([0.1]);
  });

  it("emits when >=250ms elapsed and delta >= 1%", () => {
    const seen: number[] = [];
    const throttled = createThrottledProgress((f) => seen.push(f));
    throttled(0.1);
    vi.advanceTimersByTime(250);
    throttled(0.115);
    expect(seen).toEqual([0.1, 0.115]);
  });

  it("suppresses large deltas that arrive too early (at most every ~250ms)", () => {
    const seen: number[] = [];
    const throttled = createThrottledProgress((f) => seen.push(f));
    throttled(0.1);
    vi.advanceTimersByTime(100);
    throttled(0.9); // big jump, but only 100ms elapsed
    expect(seen).toEqual([0.1]);
    vi.advanceTimersByTime(150);
    throttled(0.9);
    expect(seen).toEqual([0.1, 0.9]);
  });

  it("always passes the final fraction through", () => {
    const seen: number[] = [];
    const throttled = createThrottledProgress((f) => seen.push(f));
    throttled(0.1);
    vi.advanceTimersByTime(10);
    throttled(1);
    expect(seen).toEqual([0.1, 1]);
  });

  it("clamps values to [0, 1]", () => {
    const seen: number[] = [];
    const throttled = createThrottledProgress((f) => seen.push(f));
    throttled(-0.5);
    expect(seen).toEqual([0]);
  });
});
