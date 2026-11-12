import { describe, expect, it } from "vitest";
import { concurrencyLevel } from "./concurrency";

describe("concurrency levels", () => {
  it("grow with credits bought", () => {
    expect([0, 1999, 2000, 9999, 10_000, 50_000, 1_000_000].map(concurrencyLevel)).toEqual([5, 5, 10, 10, 20, 40, 40]);
  });
});
