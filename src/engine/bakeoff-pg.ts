// Model bake-off, the database side: queue a run (with the admin's spending approval), run the oldest
// queued one, store every cost in usage_costs (no workspace, bakeoff_run_id set) and the report.
import type pg from "pg";
import { BAKEOFF } from "@/config/models";
import { finishReport, runBakeoff, type BakeoffDeps, type BakeoffReport } from "./bakeoff";
import type { TestSet } from "./lab";

export async function queueBakeoff(pool: pg.Pool, input: { testSetIds: string[]; provider: string; approvedBy: string }): Promise<number> {
  const { rows } = await pool.query(
    "insert into public.bakeoff_runs (test_set_ids, provider, budget_usd, approved_by) values ($1, $2, $3, $4) returning id",
    [input.testSetIds, input.provider, BAKEOFF.budgetUsd, input.approvedBy],
  );
  return rows[0].id;
}

/** Run the oldest queued bake-off. Returns its id, or null when nothing was queued. */
export async function runQueuedBakeoff(pool: pg.Pool, deps: Omit<BakeoffDeps, "record" | "progress" | "budgetUsd">, log?: (m: string) => void): Promise<number | null> {
  // A run can wait up to 24 h for its batch; one left "running" much longer than that was cut off by a restart.
  await pool.query(
    "update public.bakeoff_runs set status = 'failed', error = 'Stopped: the worker restarted during the run', finished_at = now() where status = 'running' and started_at < now() - interval '30 hours'",
  );
  const { rows } = await pool.query(
    `update public.bakeoff_runs set status = 'running', started_at = now()
      where id = (select id from public.bakeoff_runs where status = 'queued' order by created_at limit 1 for update skip locked)
      returning id, test_set_ids, budget_usd`,
  );
  const run = rows[0];
  if (!run) return null;
  try {
    const { rows: sets } = await pool.query<TestSet>("select id, name, template, leads from public.test_sets where id = any($1)", [run.test_set_ids]);
    const ordered = (run.test_set_ids as string[]).map((id) => sets.find((s) => s.id === id)).filter((s): s is TestSet => !!s);
    if (!ordered.length) throw new Error("None of the chosen test sets exist any more.");
    const out = await runBakeoff(ordered, {
      ...deps,
      budgetUsd: Number(run.budget_usd),
      record: async (costs) => {
        for (const c of costs) {
          await pool.query(
            `insert into public.usage_costs (workspace_id, step, model, input_tokens, output_tokens, cached_tokens, provider_units, cost_usd, bakeoff_run_id)
             values (null, $1, $2, $3, $4, $5, $6, $7, $8)`,
            [c.step, c.model, c.input_tokens ?? 0, c.output_tokens ?? 0, c.cached_tokens ?? 0, c.provider_units ?? 0, c.cost_usd, run.id],
          );
        }
      },
      progress: async (p) => {
        await pool.query("update public.bakeoff_runs set progress = $2, cost_usd = $3 where id = $1", [run.id, JSON.stringify(p), p.spentUsd]);
      },
    });
    const report = finishReport(out.report, deps.config);
    const spent = await runSpend(pool, run.id);
    await pool.query(
      `update public.bakeoff_runs set status = $2, report = $3, records = $4, cost_usd = $5,
              progress = progress || jsonb_build_object('projectedUsd', $6::numeric), finished_at = now() where id = $1`,
      [run.id, out.status, JSON.stringify(report), JSON.stringify(out.records), spent, out.projectedUsd],
    );
    log?.(`model bake-off: run ${run.id} ${out.status}, $${spent.toFixed(2)} spent`);
  } catch (e) {
    await pool.query("update public.bakeoff_runs set status = 'failed', error = $2, cost_usd = $3, finished_at = now() where id = $1", [
      run.id,
      (e as Error).message.slice(0, 500),
      await runSpend(pool, run.id),
    ]);
    log?.(`model bake-off: run ${run.id} failed: ${(e as Error).message}`);
  }
  return run.id;
}

async function runSpend(pool: pg.Pool, runId: number): Promise<number> {
  const { rows } = await pool.query<{ usd: number }>("select coalesce(sum(cost_usd), 0)::float usd from public.usage_costs where bakeoff_run_id = $1", [runId]);
  return rows[0].usd;
}

export type BakeoffRunRow = {
  id: number;
  test_set_ids: string[];
  status: string;
  provider: string | null;
  budget_usd: string;
  cost_usd: string;
  progress: { phase?: string; done?: number; total?: number; spentUsd?: number; projectedUsd?: number | null; note?: string };
  report: BakeoffReport | null;
  picks: Record<string, "a" | "b" | "same">;
  approved_by: string;
  error: string | null;
  created_at: string;
  finished_at: string | null;
};

const COLUMNS = "id, test_set_ids, status, provider, budget_usd, cost_usd, progress, picks, approved_by, error, created_at, finished_at";

export async function listBakeoffs(pool: pg.Pool, limit = 10): Promise<BakeoffRunRow[]> {
  const { rows } = await pool.query(`select ${COLUMNS}, null as report from public.bakeoff_runs order by created_at desc limit $1`, [limit]);
  return rows;
}

export async function getBakeoff(pool: pg.Pool, id: number): Promise<BakeoffRunRow | null> {
  const { rows } = await pool.query(`select ${COLUMNS}, report from public.bakeoff_runs where id = $1`, [id]);
  return rows[0] ?? null;
}

/** The owner's blind pick for one pair: "a", "b" or "same". */
export async function saveBlindPick(pool: pg.Pool, id: number, n: number, pick: "a" | "b" | "same") {
  await pool.query("update public.bakeoff_runs set picks = picks || jsonb_build_object($2::text, $3::text) where id = $1", [id, String(n), pick]);
}

/** Tally of the blind picks, revealed only once every pair is picked. */
export function blindTally(report: BakeoffReport, picks: Record<string, string>) {
  const done = report.blind.filter((p) => picks[String(p.n)]).length;
  const complete = report.blind.length > 0 && done === report.blind.length;
  const count: Record<string, number> = { same: 0 };
  for (const p of report.blind) {
    const pick = picks[String(p.n)];
    if (!pick) continue;
    const w = pick === "same" ? "same" : p.key[pick as "a" | "b"];
    count[w] = (count[w] ?? 0) + 1;
  }
  return { done, total: report.blind.length, complete, count: complete ? count : null };
}
