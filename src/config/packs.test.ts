import { describe, expect, it } from "vitest";
import { enabledPacks, isPackId, PACKS } from "@/lib/credits";
import { packFromNote, revenuePerCreditEur } from "@/lib/admin";
import { packForProduct, polarProductIds } from "@/billing/polar";
import { PACK_CONFIG } from "./packs";

describe("pack config", () => {
  it("only the three current packs are on sale by default", () => {
    expect(enabledPacks({}).map((p) => p.id)).toEqual(["starter", "growth", "agency"]);
    expect(enabledPacks({ PACKS_ENABLED: "starter, lite-50k" }).map((p) => p.id)).toEqual(["starter", "lite-50k"]);
  });

  it("ids are unique, prices sane, bigger packs are cheaper per credit within a kind", () => {
    expect(new Set(PACK_CONFIG.map((p) => p.id)).size).toBe(PACK_CONFIG.length);
    for (const kind of ["standard", "lite"] as const) {
      const per = PACK_CONFIG.filter((p) => p.kind === kind).map((p) => p.priceCents / p.credits);
      expect([...per].sort((a, b) => b - a)).toEqual(per);
    }
    expect(isPackId("lite-50k")).toBe(true);
    expect(isPackId("nope")).toBe(false);
  });

  it("each pack maps to its Polar product through POLAR_PRODUCT_<ID>", () => {
    const products = polarProductIds({ POLAR_PRODUCT_STARTER: " prod-starter ", POLAR_PRODUCT_LITE_50K: "prod-lite", POLAR_PRODUCT_GROWTH: "" });
    expect(products).toEqual({ starter: "prod-starter", "lite-50k": "prod-lite" });
    expect(packForProduct(products, "prod-lite")).toBe("lite-50k");
    expect(packForProduct(products, "other")).toBeNull();
    expect(packForProduct(products, undefined)).toBeNull();
  });

  it("purchases are recognised from old and new ledger notes", () => {
    expect(packFromNote("Starter pack: 500 credits · Kelviq")).toBe("starter");
    expect(packFromNote("Lite 50k pack (lite-50k): 50,000 Lite credits · Polar · 569.00 EUR paid")).toBe("lite-50k");
    expect(revenuePerCreditEur([{ credits: 50_000, note: "Lite 50k pack (lite-50k): x" }])).toBeCloseTo(PACKS["lite-50k"].priceCents / 50_000 / 100);
  });
});
