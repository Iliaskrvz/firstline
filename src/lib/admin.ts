// Admin (§10.9, me only): who is admin, and the margin maths. Pure, tested.
import { PACKS, type PackId } from "./credits";

/** ADMIN_EMAILS: comma-separated addresses that may open /admin. Empty = nobody. */
export function isAdmin(email: string | null | undefined, env: Record<string, string | undefined> = process.env): boolean {
  if (!email) return false;
  const admins = (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.trim().toLowerCase());
}

/** §9: target real cost ~€0.010 per email (Pro). */
export const TARGET_COST_EUR = 0.01;
/** §9: price = real cost × 3. */
export const PRICE_MULTIPLE = 3;
export const DRIFT_ALERT = 0.25;

export function usdToEur(usd: number, env: Record<string, string | undefined> = process.env): number {
  const rate = Number(env.USD_EUR_RATE);
  return usd * (Number.isFinite(rate) && rate > 0 ? rate : 0.92);
}

/** Which pack a purchase was (ledger note "Lite 50k pack (lite-50k): …", or older "Starter pack: …"). */
export function packFromNote(note: string | null): PackId | null {
  const byId = /^.+ pack \(([\w-]+)\):/.exec(note ?? "");
  if (byId && byId[1] in PACKS) return byId[1];
  const m = /^(\w+) pack:/.exec(note ?? "");
  if (!m) return null;
  const id = m[1].toLowerCase();
  return id in PACKS ? id : null;
}

/**
 * What a used credit earned, on average: the price of the packs bought (excl. VAT), per credit.
 * Bonus credits earn nothing but are only a small share; with no purchases yet, use the Starter price.
 */
export function revenuePerCreditEur(purchases: { credits: number; note: string | null }[]): number {
  let cents = 0;
  let credits = 0;
  for (const p of purchases) {
    const pack = packFromNote(p.note);
    if (!pack) continue;
    cents += PACKS[pack].priceCents * (p.credits / PACKS[pack].credits);
    credits += p.credits;
  }
  const starter = PACKS.starter.priceCents / PACKS.starter.credits / 100;
  return credits > 0 ? cents / credits / 100 : starter;
}

export type MarginRow = { creditsUsed: number; emailsWritten: number; costUsd: number };
export type Margin = { revenueEur: number; costEur: number; marginEur: number; marginPct: number | null; costPerEmailEur: number | null; multiple: number | null };

export function margin(row: MarginRow, perCreditEur: number, env: Record<string, string | undefined> = process.env): Margin {
  const revenueEur = row.creditsUsed * perCreditEur;
  const costEur = usdToEur(row.costUsd, env);
  const marginEur = revenueEur - costEur;
  return {
    revenueEur,
    costEur,
    marginEur,
    marginPct: revenueEur > 0 ? marginEur / revenueEur : null,
    costPerEmailEur: row.emailsWritten > 0 ? costEur / row.emailsWritten : null,
    multiple: costEur > 0 ? revenueEur / costEur : null,
  };
}

export type DriftAlert = { level: "ok" | "warn"; message: string | null };

/**
 * Cost drift (§10.9): the cost per written email over the last 7 days against the 30 days before,
 * and against the target. Fake-LLM periods cost ~0, so no alert below 20 written emails.
 */
export function costDrift(recent: { costEur: number; emails: number }, baseline: { costEur: number; emails: number }): DriftAlert {
  if (recent.emails < 20) return { level: "ok", message: null };
  const now = recent.costEur / recent.emails;
  const msgs: string[] = [];
  if (now > TARGET_COST_EUR * 1.5) msgs.push(`Cost per email €${now.toFixed(4)} is above 1.5× the €${TARGET_COST_EUR.toFixed(3)} target.`);
  if (baseline.emails >= 20) {
    const before = baseline.costEur / baseline.emails;
    if (before > 0 && now > before * (1 + DRIFT_ALERT)) msgs.push(`Cost per email rose ${Math.round((now / before - 1) * 100)}% (7 days vs the 30 before).`);
  }
  return msgs.length ? { level: "warn", message: msgs.join(" ") } : { level: "ok", message: null };
}
