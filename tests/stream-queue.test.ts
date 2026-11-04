import { describe, expect, it } from "vitest";
import { StreamQueue } from "../lib/stream-queue";

describe("StreamQueue", () => {
  it("rejects non-positive capacity", () => {
    expect(() => new StreamQueue(0)).toThrow();
    expect(() => new StreamQueue(-2)).toThrow();
  });

  it("is FIFO", () => {
    const q = new StreamQueue<number>(4);
    q.push(1); q.push(2); q.push(3);
    expect(q.shift()).toBe(1);
    expect(q.shift()).toBe(2);
    expect(q.shift()).toBe(3);
    expect(q.shift()).toBeUndefined();
  });

  it("refuses pushes beyond capacity (backpressure, no silent growth)", () => {
    const q = new StreamQueue<string>(2);
    expect(q.push("a")).toBe(true);
    expect(q.push("b")).toBe(true);
    expect(q.isFull).toBe(true);
    expect(q.push("c")).toBe(false);
    expect(q.size).toBe(2);
    // Draining makes room again.
    expect(q.shift()).toBe("a");
    expect(q.push("c")).toBe(true);
  });

  it("peek does not consume", () => {
    const q = new StreamQueue<number>(3);
    q.push(7);
    expect(q.peek()).toBe(7);
    expect(q.size).toBe(1);
    expect(q.peek()).toBe(7);
  });

  it("clear drains and returns items", () => {
    const q = new StreamQueue<number>(3);
    q.push(1); q.push(2);
    expect(q.clear()).toEqual([1, 2]);
    expect(q.isEmpty).toBe(true);
    expect(q.size).toBe(0);
  });

  it("respects the profile high-water marks", () => {
    for (const cap of [4, 3, 2]) {
      const q = new StreamQueue<number>(cap);
      for (let i = 0; i < cap; i++) expect(q.push(i)).toBe(true);
      expect(q.push(999)).toBe(false);
    }
  });
});
