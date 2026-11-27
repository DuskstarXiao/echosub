/**
 * Fixed-capacity Int16 PCM Ring Buffer.
 * Used as a pre-roll buffer (~320ms) so the first consonant of an utterance
 * is never clipped before VAD triggers speechStarted.
 */
export class PcmRingBuffer {
  private readonly buffer: Int16Array;
  private writePtr = 0;
  private size = 0;

  constructor(readonly capacity: number) {
    if (capacity <= 0) throw new Error('RingBuffer capacity must be positive');
    this.buffer = new Int16Array(capacity);
  }

  push(chunk: Int16Array): void {
    if (chunk.length >= this.capacity) {
      const tail = chunk.subarray(chunk.length - this.capacity);
      this.buffer.set(tail, 0);
      this.writePtr = 0;
      this.size = this.capacity;
      return;
    }

    const firstPart = Math.min(chunk.length, this.capacity - this.writePtr);
    this.buffer.set(chunk.subarray(0, firstPart), this.writePtr);

    const remaining = chunk.length - firstPart;
    if (remaining > 0) {
      this.buffer.set(chunk.subarray(firstPart), 0);
    }

    this.writePtr = (this.writePtr + chunk.length) % this.capacity;
    this.size = Math.min(this.capacity, this.size + chunk.length);
  }

  /** Returns all currently buffered samples in chronological order. */
  readAll(): Int16Array {
    if (this.size === 0) return new Int16Array(0);
    const out = new Int16Array(this.size);
    const start = (this.writePtr - this.size + this.capacity) % this.capacity;
    const firstPart = Math.min(this.size, this.capacity - start);
    out.set(this.buffer.subarray(start, start + firstPart), 0);
    if (firstPart < this.size) {
      out.set(this.buffer.subarray(0, this.size - firstPart), firstPart);
    }
    return out;
  }

  clear(): void {
    this.writePtr = 0;
    this.size = 0;
  }

  get length(): number {
    return this.size;
  }
}
