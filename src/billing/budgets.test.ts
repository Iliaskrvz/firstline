import { describe, expect, it } from "vitest";
import { budgetAlertEmail, type Budget } from "./budgets";

describe("budget alert email", () => {
  it("says what to do per provider", () => {
    const fc: Budget = { provider: "firecrawl", label: "Firecrawl credits", used: 820, limit: 1000, unit: "credits", pct: 82, source: "Firecrawl", periodEnd: null };
    const e = budgetAlertEmail(fc, 80, "https://app.example");
    expect(e.subject).toBe("FirstLine: Firecrawl credits at 82% this month");
    expect(e.text).toMatch(/820 of 1,000 credits/);
    expect(e.text).toMatch(/Upgrade the Firecrawl plan/);
    const ai: Budget = { ...fc, provider: "llm", label: "AI spend (DeepSeek)", used: 41.5, limit: 50, unit: "usd", pct: 83 };
    expect(budgetAlertEmail(ai, 80, null).subject).toBe("FirstLine: AI spend (DeepSeek) at 83% this month");
    expect(budgetAlertEmail(ai, 80, null).text).toMatch(/\$41\.50 of \$50\.00/);
  });
});
