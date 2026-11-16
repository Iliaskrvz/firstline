import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COMPARE_TOOLS } from "@/content/compare";
import { PACK_CONFIG } from "@/config/packs";
import { COMPETITORS, type Competitor } from "@/content/competitors";
import { competitorCost, firstLineCost } from "./price-compare";

const byId = (id: string) => COMPETITORS.find((c) => c.id === id) as Competitor;

describe("FirstLine cost per month", () => {
  it("uses the per-email price of the pack a year of volume fills", () => {
    expect(firstLineCost(300, PACK_CONFIG)).toMatchObject({ pack: { id: "growth" }, monthly: 10.35 }); // the homepage's "300 emails ≈ €10"
    expect(firstLineCost(10_000, PACK_CONFIG)).toMatchObject({ pack: { id: "agency" }, monthly: 299 });
    expect(firstLineCost(20, PACK_CONFIG)).toMatchObject({ pack: { id: "starter" }, monthly: 0.76 });
  });

  it("never uses packs that aren't on sale (the proposed volume packs)", () => {
    expect(firstLineCost(100_000, PACK_CONFIG).pack.id).toBe("agency");
  });
});

describe("competitor cost from their public pricing page", () => {
  it("gives the recorded price at 300 and 10,000, a range in between, unknown beyond", () => {
    expect(competitorCost(byId("instantly"), 300)).toMatchObject({ kind: "price", price: 94 });
    expect(competitorCost(byId("instantly"), 2_000)).toMatchObject({ kind: "range", low: { price: 94 }, high: { price: 194 } });
    expect(competitorCost(byId("instantly"), 10_000)).toMatchObject({ kind: "price", price: 194 });
    expect(competitorCost(byId("instantly"), 20_000)).toEqual({ kind: "unknown", why: "above_range" });
  });

  it("says so when the page has no price for the volume", () => {
    expect(competitorCost(byId("lyne"), 300)).toEqual({ kind: "unknown", why: "not_published" });
    expect(competitorCost(byId("clay"), 5_000)).toEqual({ kind: "unknown", why: "not_recorded" }); // their page has plans, we only recorded 300
    expect(competitorCost(byId("clay"), 10_000)).toEqual({ kind: "unknown", why: "not_published" }); // recorded: not priceable from the page
    expect(competitorCost(byId("lemlist"), 5_000)).toMatchObject({ kind: "price", price: 69 }); // same plan covers both
  });
});

describe("compare pages", () => {
  it("every competitor has copy and its own /compare/<id> page", () => {
    for (const c of COMPETITORS) {
      expect(COMPARE_TOOLS[c.id], c.id).toBeDefined();
      expect(existsSync(path.resolve(__dirname, `../app/(marketing)/compare/${c.id}/page.tsx`)), c.id).toBe(true);
    }
  });
});
