import { describe, expect, it } from "vitest";
import { costDrift, isAdmin, margin, packFromNote, revenuePerCreditEur } from "./admin";

describe("admin", () => {
  it("admins come from ADMIN_EMAILS, case-insensitive; empty means nobody", () => {
    const env = { ADMIN_EMAILS: " Ilias@BreakingRevenues.com, x@y.nl " };
    expect(isAdmin("ilias@breakingrevenues.com", env)).toBe(true);
    expect(isAdmin("other@y.nl", env)).toBe(false);
    expect(isAdmin("ilias@breakingrevenues.com", {})).toBe(false);
    expect(isAdmin(null, env)).toBe(false);
  });

  it("revenue per credit follows the packs bought", () => {
    expect(packFromNote("Growth pack: 2,000 credits · Kelviq · 69.00 EUR paid")).toBe("growth");
    expect(packFromNote("Welcome credits")).toBeNull();
    expect(revenuePerCreditEur([])).toBeCloseTo(0.038);
    expect(revenuePerCreditEur([{ credits: 500, note: "Starter pack: 500 credits" }, { credits: 2000, note: "Growth pack: 2,000 credits" }])).toBeCloseTo((19 + 69) / 2500);
    expect(revenuePerCreditEur([{ credits: 25, note: "Welcome credits" }])).toBeCloseTo(0.038);
  });

  it("margin and cost per email, USD costs converted to EUR", () => {
    const m = margin({ creditsUsed: 100, emailsWritten: 100, costUsd: 1 }, 0.038, { USD_EUR_RATE: "0.9" });
    expect(m.revenueEur).toBeCloseTo(3.8);
    expect(m.costEur).toBeCloseTo(0.9);
    expect(m.marginEur).toBeCloseTo(2.9);
    expect(m.costPerEmailEur).toBeCloseTo(0.009);
    expect(m.multiple).toBeCloseTo(4.22, 2);
    expect(margin({ creditsUsed: 0, emailsWritten: 0, costUsd: 0 }, 0.038).marginPct).toBeNull();
  });

  it("cost drift: warns above 1.5× target or +25% vs the 30 days before; quiet on small samples", () => {
    expect(costDrift({ costEur: 0.1, emails: 10 }, { costEur: 0, emails: 0 }).level).toBe("ok");
    expect(costDrift({ costEur: 0.2, emails: 20 }, { costEur: 1, emails: 100 }).level).toBe("ok"); // €0.010 both
    const rise = costDrift({ costEur: 0.2, emails: 20 }, { costEur: 0.6, emails: 100 }); // €0.010 vs €0.006
    expect(rise).toMatchObject({ level: "warn", message: expect.stringContaining("rose 67%") });
    expect(costDrift({ costEur: 0.4, emails: 20 }, { costEur: 0, emails: 0 }).message).toMatch(/above 1.5× the €0.010 target/);
  });
});
