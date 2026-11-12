// Provider budgets (owner's change request, 2026-11-12): Firecrawl credits left this billing period
// and Anthropic spend against the monthly cap, shown on /admin, with an alert at 80% and 100%.
import type pg from "pg";
import type { CreditUsage } from "@/engine/firecrawl";

export const ALERT_LEVELS = [80, 100] as const;

export type Budget = {
  provider: "firecrawl" | "anthropic";
  label: string;
  used: number;
  limit: number | null;
  unit: "credits" | "usd";
  /** 0–100+, null when there is no limit to compare with. */
  pct: number | null;
  source: string;
  periodEnd: string | null;
};

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
export const period = (now: Date) => now.toISOString().slice(0, 7);

/** Firecrawl: its own numbers when it answers; otherwise our log of credits used this month. */
export async function firecrawlBudget(pool: pg.Pool, usage: CreditUsage | null, env: Record<string, string | undefined> = process.env, now = new Date()): Promise<Budget> {
  if (usage?.plan) {
    const used = Math.max(0, usage.plan - usage.remaining);
    return { provider: "firecrawl", label: "Firecrawl credits", used, limit: usage.plan, unit: "credits", pct: Math.round((used / usage.plan) * 100), source: "Firecrawl", periodEnd: usage.periodEnd };
  }
  const { rows } = await pool.query<{ n: number }>("select coalesce(sum(provider_units), 0)::int n from public.usage_costs where model like 'firecrawl-%' and created_at >= $1", [
    monthStart(now),
  ]);
  const limit = Number(env.FIRECRAWL_MONTHLY_CREDITS) || null;
  return {
    provider: "firecrawl",
    label: "Firecrawl credits",
    used: rows[0].n,
    limit,
    unit: "credits",
    pct: limit ? Math.round((rows[0].n / limit) * 100) : null,
    source: usage ? `our log (Firecrawl says ${usage.remaining} left)` : "our log this month",
    periodEnd: null,
  };
}

/** Anthropic: our logged cost this calendar month against ANTHROPIC_MONTHLY_CAP_USD (your Console spend cap). */
export async function anthropicBudget(pool: pg.Pool, env: Record<string, string | undefined> = process.env, now = new Date()): Promise<Budget> {
  const { rows } = await pool.query<{ usd: number }>("select coalesce(sum(cost_usd), 0)::float usd from public.usage_costs where model like 'claude-%' and created_at >= $1", [
    monthStart(now),
  ]);
  const cap = Number(env.ANTHROPIC_MONTHLY_CAP_USD) || null;
  const used = Math.round(rows[0].usd * 100) / 100;
  return { provider: "anthropic", label: "Anthropic spend", used, limit: cap, unit: "usd", pct: cap ? Math.round((used / cap) * 100) : null, source: "our cost log this month", periodEnd: null };
}

/** The highest alert level reached and not yet sent this month (records it), or null. */
export async function newAlertLevel(pool: pg.Pool, b: Budget, now = new Date()): Promise<number | null> {
  if (b.pct == null) return null;
  const reached = [...ALERT_LEVELS].reverse().find((l) => b.pct! >= l);
  if (!reached) return null;
  const r = await pool.query("insert into public.provider_budget_alerts (provider, period, level) values ($1, $2, $3) on conflict do nothing", [b.provider, period(now), reached]);
  return r.rowCount ? reached : null;
}

export function budgetAlertEmail(b: Budget, level: number, appUrl: string | null): { subject: string; text: string } {
  const amount =
    b.unit === "usd" ? `$${b.used.toFixed(2)} of $${b.limit?.toFixed(2)}` : `${b.used.toLocaleString("en")} of ${b.limit?.toLocaleString("en")} credits`;
  const what = b.provider === "firecrawl" ? "Firecrawl credits" : "Anthropic spend";
  return {
    subject: `FirstLine: ${what} at ${b.pct}% this month`,
    text:
      `${what} has reached ${level}% (${amount}).\n\n` +
      (b.provider === "firecrawl"
        ? "When the credits run out, research stops and leads fall back to the neutral line. Upgrade the Firecrawl plan or buy extra credits before customers notice."
        : "When the cap is reached, Anthropic refuses requests and AI steps fail. Raise the spend cap or upgrade in the Anthropic Console.") +
      (appUrl ? `\n\nDetails: ${appUrl}/admin` : ""),
  };
}
