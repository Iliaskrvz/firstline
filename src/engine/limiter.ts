// Concurrency limiters for providers (Firecrawl, Anthropic). Gate is what the engine needs; Semaphore is
// the in-process one, PgSlotGate / PgRateGate (limiter-pg.ts) are shared by every worker process.

export interface Gate {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

/** Apply several gates in order (e.g. requests per minute, then requests at once). */
export function chainGates(...gates: Gate[]): Gate {
  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      return gates.reduceRight<() => Promise<T>>((next, g) => () => g.run(next), fn)();
    },
  };
}

export class Semaphore implements Gate {
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
