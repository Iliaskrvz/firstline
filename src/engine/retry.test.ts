import { describe, expect, it } from "vitest";
import { effectiveConcurrency, Semaphore } from "./limiter";
import { backoffMs, HttpError, isRetryable, parseRetryAfter, TimeoutError, withRetry } from "./retry";

describe("withRetry", () => {
  const noSleep = async () => {};

  it("retries 429/5xx/timeouts, then succeeds", async () => {
    let n = 0;
    const out = await withRetry(async () => {
      n++;
      if (n === 1) throw new HttpError("rate", 429);
      if (n === 2) throw new TimeoutError();
      if (n === 3) throw new HttpError("down", 503);
      return "ok";
    }, { sleep: noSleep });
    expect([out, n]).toEqual(["ok", 4]);
  });

  it("does not retry 4xx", async () => {
    let n = 0;
    await expect(withRetry(async () => { n++; throw new HttpError("bad", 400); }, { sleep: noSleep })).rejects.toThrow("bad");
    expect(n).toBe(1);
  });

  it("gives up after the retry limit and honours Retry-After", async () => {
    const waits: number[] = [];
    await expect(
      withRetry(async () => { throw new HttpError("rate", 429, 2000); }, { retries: 2, sleep: async (ms) => { waits.push(ms); } }),
    ).rejects.toThrow("rate");
    expect(waits).toEqual([2000, 2000]);
  });

  it("backoff grows and is capped", () => {
    expect(backoffMs(0, 500, 8000, () => 1)).toBe(500);
    expect(backoffMs(3, 500, 8000, () => 1)).toBe(4000);
    expect(backoffMs(10, 500, 8000, () => 0)).toBe(4000);
    expect(isRetryable(new Error("x"))).toBe(false);
    expect(parseRetryAfter("3")).toBe(3000);
  });
});

describe("Semaphore", () => {
  it("never runs more than max at once", async () => {
    const s = new Semaphore(2);
    let peak = 0;
    let running = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        s.run(async () => {
          running++;
          peak = Math.max(peak, running);
          await new Promise((r) => setTimeout(r, 5));
          running--;
        }),
      ),
    );
    expect(peak).toBe(2);
  });
});

describe("effectiveConcurrency", () => {
  it("caps at the plan limit and keeps the setting when the limit is unknown", () => {
    expect(effectiveConcurrency(5, 2)).toBe(2);
    expect(effectiveConcurrency(1, 2)).toBe(1);
    expect(effectiveConcurrency(5, null)).toBe(5);
    expect(effectiveConcurrency(5, 0)).toBe(5);
  });
});
