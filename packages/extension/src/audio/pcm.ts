/**
 * Fixed-capacity PCM collector fed by a ScriptProcessorNode. It exists for one
 * job: MicVAD cannot flush a partial utterance, so a forced 30 s cut needs the
 * samples captured since speech started. Audio never leaves memory.
 */
export class PcmCollector {
  private chunks: Float32Array[] = [];
  private dropped = 0;
  private stored = 0;

  constructor(private readonly maxSamples: number = 16_000 * 35) {}

  push(frame: Float32Array): void {
    if (frame.length === 0) return;
    this.chunks.push(frame.slice());
    this.stored += frame.length;
    while (this.stored > this.maxSamples && this.chunks.length > 1) {
      const removed = this.chunks.shift();
      if (!removed) break;
      this.stored -= removed.length;
      this.dropped += removed.length;
    }
  }

  /** Absolute sample index of "now" — pass to `since()` when speech starts. */
  mark(): number {
    return this.dropped + this.stored;
  }

  /** Samples captured after `mark`, concatenated. */
  since(mark: number): Float32Array {
    const start = Math.max(mark, this.dropped);
    const skip = start - this.dropped;
    const total = Math.max(0, this.stored - skip);
    const output = new Float32Array(total);
    let written = 0;
    let offset = 0;
    for (const chunk of this.chunks) {
      if (offset + chunk.length <= skip) {
        offset += chunk.length;
        continue;
      }
      const localStart = Math.max(0, skip - offset);
      const slice = chunk.subarray(localStart);
      const remaining = total - written;
      output.set(remaining >= slice.length ? slice : slice.subarray(0, remaining), written);
      written += Math.min(slice.length, remaining);
      offset += chunk.length;
      if (written >= total) break;
    }
    return output;
  }

  clear(): void {
    this.chunks = [];
    this.dropped = 0;
    this.stored = 0;
  }

  get length(): number {
    return this.stored;
  }
}
