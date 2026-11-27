import { describe, expect, it } from "vitest";
import { ownUseCapUsd, ownUseDecision } from "./own-use";
import { assignVariants, halfStats, renderPlain, stripSlots } from "./split-test";

describe("own use: which AI a lead gets", () => {
  const on = { override: "anthropic" as const, hasKey: true, capUsd: 50, spentUsd: 10 };

  it("other workspaces keep the server's provider", () => {
    expect(ownUseDecision({ ...on, override: null })).toEqual({ use: "default" });
  });

  it("the switched-on workspace gets Claude, within the cap", () => {
    expect(ownUseDecision(on)).toEqual({ use: "claude" });
  });

  it("never test output for it: no key, no cap or cap reached stops its leads with the reason", () => {
    expect(ownUseDecision({ ...on, hasKey: false })).toMatchObject({ use: "blocked", reason: expect.stringMatching(/ANTHROPIC_API_KEY/) });
    expect(ownUseDecision({ ...on, capUsd: null })).toMatchObject({ use: "blocked", reason: expect.stringMatching(/OWN_USE_MONTHLY_CAP_USD/) });
    expect(ownUseDecision({ ...on, spentUsd: 50 })).toMatchObject({ use: "blocked", reason: expect.stringMatching(/cap of \$50/) });
  });

  it("reads the cap; empty, zero or text means no cap", () => {
    expect(ownUseCapUsd({ OWN_USE_MONTHLY_CAP_USD: " 40 " })).toBe(40);
    for (const v of [undefined, "", "0", "abc", "-5"]) expect(ownUseCapUsd({ OWN_USE_MONTHLY_CAP_USD: v })).toBeNull();
  });
});

describe("split test", () => {
  it("the plain copy: [[slots]] out, lines left empty dropped, variables kept", () => {
    const body = "Hi {{first_name}},\n\n[[opener · something specific · 25]]\n\nWe help bakeries cut waste. [[bridge · one sentence · 20]] Worth a call?\n\nTom";
    expect(stripSlots(body)).toBe("Hi {{first_name}},\n\nWe help bakeries cut waste. Worth a call?\n\nTom");
    expect(stripSlots("Idea for {{company}}")).toBe("Idea for {{company}}");
  });

  it("renders the plain email per lead", () => {
    expect(renderPlain({ plain_subject: "Idea for {{company}}", plain_body: "Hi {{first_name}},\n\nWe help.\n\n\nTom" }, { first_name: "Sanne", company: "Bakkerij Vos" })).toEqual({
      subject: "Idea for Bakkerij Vos",
      body: "Hi Sanne,\n\nWe help.\n\nTom",
    });
  });

  it("splits 50/50; leads already written (the preview) count as FirstLine", () => {
    const leads = Array.from({ length: 20 }, (_, i) => ({ id: `L${i}`, written: i < 5 }));
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const m = assignVariants(leads, 0.5, random);
    expect(m.size).toBe(20);
    expect([...m.values()].filter((v) => v === "holdout")).toHaveLength(10);
    for (let i = 0; i < 5; i++) expect(m.get(`L${i}`)).toBe("firstline");
    // Spread over the list, not the first or last half.
    const holdoutIdx = [...m.entries()].filter(([, v]) => v === "holdout").map(([id]) => Number(id.slice(1)));
    expect(Math.min(...holdoutIdx)).toBeLessThan(12);
    expect(Math.max(...holdoutIdx)).toBeGreaterThan(12);
  });

  it("rates per half; nothing contacted = no rate", () => {
    expect(halfStats({ contacted: 200, replied: 10, positive: 4 })).toEqual({ contacted: 200, replied: 10, positive: 4, replyRate: 0.05, positiveRate: 0.02 });
    expect(halfStats({ contacted: 0, replied: 0, positive: 0 }).replyRate).toBeNull();
  });
});
