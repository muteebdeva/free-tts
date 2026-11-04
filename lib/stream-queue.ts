/**
 * Bounded FIFO queue for the streaming playback pipeline.
 *
 * The worker pauses when unacknowledged chunks reach the profile's
 * high-water mark; this queue is the main-thread side of that contract —
 * it never holds more than `capacity` chunks, so a fast device can't race
 * ahead generating audio the user may never hear (bounded blob URLs +
 * bounded outstanding work). Chunks are acknowledged back to the worker
 * when they are *taken* for playback (see components/tts-provider.tsx).
 */
export class StreamQueue<T> {
  private items: T[] = [];

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error("StreamQueue: capacity must be a positive integer");
    }
  }

  get size(): number {
    return this.items.length;
  }

  get isFull(): boolean {
    return this.items.length >= this.capacity;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  /** Look at the head without removing it (used to preload the next chunk). */
  peek(): T | undefined {
    return this.items[0];
  }

  /**
   * Enqueue an item. Returns false (and drops nothing) when the queue is
   * full — the caller must apply backpressure instead of growing memory.
   */
  push(item: T): boolean {
    if (this.isFull) return false;
    this.items.push(item);
    return true;
  }

  shift(): T | undefined {
    return this.items.shift();
  }

  /** Drain everything (teardown paths). Returns the drained items. */
  clear(): T[] {
    const drained = this.items;
    this.items = [];
    return drained;
  }
}
