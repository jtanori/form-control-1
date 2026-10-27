/** In-process sliding-window limiter. A single instance is enough for MVP. */
export class WindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns the number of seconds to wait, or 0 when the request may proceed. */
  take(key: string): number {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.limit) {
      const oldest = recent[0] ?? now;
      this.hits.set(key, recent);
      return Math.max(1, Math.ceil((this.windowMs - (now - oldest)) / 1000));
    }
    recent.push(now);
    this.hits.set(key, recent);
    return 0;
  }

  reset(): void {
    this.hits.clear();
  }
}
