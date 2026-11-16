// FirstLine's cost for a monthly volume, next to the competitor prices in src/content/competitors.ts.
// Used by /compare and /calculator. Pure, so it's tested without a server.
import type { Competitor } from "@/content/competitors";
import type { Pack } from "@/config/packs";

export type FirstLineCost = {
  /** Emails per month. */
  emails: number;
  /** The pack you'd buy for a year of this volume (credits never expire, so leftovers carry over). */
  pack: Pack;
  /** That pack's price per email, in euros. */
  perEmail: number;
  /** emails × perEmail, in euros. */
  monthly: number;
};

/**
 * FirstLine's monthly cost at the per-email price of the pack you'd buy: the biggest pack that a year
 * of your volume fills (at least the smallest pack). Excl. VAT, like the pack prices.
 */
export function firstLineCost(emails: number, packs: Pack[]): FirstLineCost {
  const sorted = packs.filter((p) => p.kind === "standard" && p.enabled).sort((a, b) => a.credits - b.credits);
  if (!sorted.length) throw new Error("No packs on sale");
  const yearly = Math.max(0, emails) * 12;
  const pack = sorted.filter((p) => p.credits <= yearly).at(-1) ?? sorted[0];
  const perEmail = pack.priceCents / pack.credits / 100;
  return { emails, pack, perEmail, monthly: Math.round(emails * perEmail * 100) / 100 };
}

export type CompetitorCost =
  | { kind: "price"; plan: string; price: number; currency: "$" | "€" }
  | { kind: "range"; low: { plan: string; price: number }; high: { plan: string; price: number }; currency: "$" | "€" }
  | { kind: "unknown"; why: "not_published" | "not_recorded" | "above_range" };

/**
 * What a competitor's public pricing page says for this many emails a month. Only two points are on
 * record (300 and 10,000), so between them the honest answer is a range. Where we only have one of the
 * two it's "not_recorded" (their page may list a plan, we just didn't record it); above 10,000 it's
 * "above_range"; with no price on the page at all, "not_published".
 */
export function competitorCost(c: Competitor, emails: number): CompetitorCost {
  if (!c.for300 && !c.for10k) return { kind: "unknown", why: "not_published" };
  if (emails <= 300) return c.for300 ? { kind: "price", ...c.for300 } : { kind: "unknown", why: "not_recorded" };
  if (emails > 10_000) return { kind: "unknown", why: "above_range" };
  if (emails === 10_000) return c.for10k ? { kind: "price", ...c.for10k } : { kind: "unknown", why: "not_published" };
  if (c.for300 && c.for10k) {
    if (c.for300.price === c.for10k.price) return { kind: "price", ...c.for10k };
    return { kind: "range", low: { plan: c.for300.plan, price: c.for300.price }, high: { plan: c.for10k.plan, price: c.for10k.price }, currency: c.for10k.currency };
  }
  return { kind: "unknown", why: "not_recorded" };
}
