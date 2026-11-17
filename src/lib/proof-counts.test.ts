import { describe, expect, it, vi } from "vitest";
import { counterThreshold, counterVisible } from "./proof-counts";
import { track } from "./track";

describe("homepage counter switch", () => {
  const counts = { personalised: 1200, neutral: 300 };

  it("stays off without a threshold, and below it", () => {
    expect(counterThreshold({})).toBeNull();
    expect(counterThreshold({ PROOF_COUNTER_MIN: "abc" })).toBeNull();
    expect(counterThreshold({ PROOF_COUNTER_MIN: "1000" })).toBe(1000);
    expect(counterVisible(counts, null, "on")).toBe(false);
    expect(counterVisible(counts, 5000, "on")).toBe(false);
    expect(counterVisible(counts, 1000, "on")).toBe(true);
  });

  it("is off whenever SHOW_PROOF is off, and shown in local preview", () => {
    expect(counterVisible(counts, 1, "off")).toBe(false);
    expect(counterVisible(counts, null, "preview")).toBe(true);
    expect(counterVisible(null, 1, "on")).toBe(false); // database unreachable: hidden, page still works
  });
});

describe("analytics events", () => {
  it("do nothing when Plausible isn't loaded, and never throw", () => {
    vi.stubGlobal("window", {});
    expect(() => track("Signup")).not.toThrow();
    const plausible = vi.fn(() => {
      throw new Error("blocked");
    });
    vi.stubGlobal("window", { plausible });
    expect(() => track("Demo used", { status: "done" })).not.toThrow();
    expect(plausible).toHaveBeenCalledWith("Demo used", { props: { status: "done" } });
    vi.unstubAllGlobals();
  });
});
