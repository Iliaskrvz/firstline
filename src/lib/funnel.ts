// The signup funnel for /admin, straight from FirstLine's own database (exact, no tracking script):
// demo runs, signups, workspaces that created their first campaign, and workspaces that paid for the
// first time, in the last N days. Demo rows are kept 30 days, so the demo count covers at most that.
import type pg from "pg";

export type Funnel = { days: number; demos: number; signups: number; firstCampaigns: number; firstPurchases: number };

export async function loadFunnel(pool: pg.Pool, days = 30, now = new Date()): Promise<Funnel> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const { rows } = await pool.query(
    `select
       (select count(*) from public.demo_runs where created_at >= $1)::int demos,
       (select count(*) from auth.users where created_at >= $1)::int signups,
       (select count(*) from (select min(created_at) m from public.campaigns where source = 'app' group by workspace_id) x where m >= $1)::int first_campaigns,
       (select count(*) from (select min(created_at) m from public.credit_ledger where type = 'purchase' group by workspace_id) x where m >= $1)::int first_purchases`,
    [since],
  );
  const r = rows[0];
  return { days, demos: r.demos, signups: r.signups, firstCampaigns: r.first_campaigns, firstPurchases: r.first_purchases };
}
