// Real numbers for the homepage counter: emails personalised and leads that got a neutral line for
// free, over FirstLine's whole life. Live leads are counted directly; leads already deleted by the
// retention job were added to lifetime_counts just before deletion (src/billing/retention.ts).
import type pg from "pg";
import type { ProofMode } from "./proof";

export type ProofCounts = { personalised: number; neutral: number };

export async function proofCounts(pool: pg.Pool | pg.PoolClient): Promise<ProofCounts> {
  const { rows } = await pool.query<{ personalised: string; neutral: string }>(
    `select
       coalesce((select value from public.lifetime_counts where key = 'personalised'), 0)
         + (select count(*) from public.leads where status = 'done') personalised,
       coalesce((select value from public.lifetime_counts where key = 'neutral'), 0)
         + (select count(*) from public.leads where status = 'fallback') neutral`,
  );
  return { personalised: Number(rows[0].personalised), neutral: Number(rows[0].neutral) };
}

/** Add a campaign's lead counts to the lifetime totals. Call inside the transaction that deletes its leads. */
export async function archiveLeadCounts(client: pg.PoolClient, campaignId: string) {
  await client.query(
    `insert into public.lifetime_counts (key, value, updated_at)
     select x.k, x.n, now()
       from (select count(*) filter (where status = 'done') d, count(*) filter (where status = 'fallback') f
               from public.leads where campaign_id = $1) s,
            lateral (values ('personalised', s.d), ('neutral', s.f)) x (k, n)
     on conflict (key) do update set value = public.lifetime_counts.value + excluded.value, updated_at = now()`,
    [campaignId],
  );
}

/** The threshold from PROOF_COUNTER_MIN (emails personalised); unset or invalid means the counter stays off. */
export function counterThreshold(env: Record<string, string | undefined> = process.env): number | null {
  const n = Number(env.PROOF_COUNTER_MIN?.trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/**
 * Whether to show the counter: SHOW_PROOF on, a threshold set, and the real number past it. In local
 * preview (SHOW_PROOF=preview) it's shown whatever the numbers, so the layout can be checked.
 */
export function counterVisible(counts: ProofCounts | null, threshold: number | null, mode: ProofMode): boolean {
  if (!counts || mode === "off") return false;
  if (mode === "preview") return true;
  return threshold !== null && counts.personalised >= threshold;
}
