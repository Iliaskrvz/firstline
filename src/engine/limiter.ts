// In-process concurrency limiter (global limit per provider, e.g. Firecrawl/Anthropic).

export class Semaphore {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private readonly max: number) {}

  get inUse() {
    return this.active;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

/** Never run more requests at once than the provider's plan allows (it would throttle the extra ones). */
export function effectiveConcurrency(configured: number, planLimit: number | null): number {
  return planLimit && planLimit > 0 ? Math.max(1, Math.min(configured, planLimit)) : configured;
}
