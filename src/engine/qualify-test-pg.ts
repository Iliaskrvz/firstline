// The qualification test, database side: queue a run (with the admin's spending approval), run the
// oldest queued one, store every cost in usage_costs (no workspace, qualify_test_run_id set).
import type pg from "pg";
import type { EngineConfig } from "./config";
import type { WebReader } from "./firecrawl";
import type { LLM } from "./llm";
import { QUALIFY_TEST, runQualifyTest, type QualifyTestLead, type QualifyTestReport } from "./qualify-test";

export async function queueQualifyTest(pool: pg.Pool, input: { leads: QualifyTestLead[]; provider: string; approvedBy: string }): Promise<number> {
  const { rows } = await pool.query("insert into public.qualify_test_runs (provider, budget_usd, input, approved_by) values ($1, $2, $3, $4) returning id", [
    input.provider,
    QUALIFY_TEST.budgetUsd,
    JSON.stringify(input.leads),
    input.approvedBy,
  ]);
  return rows[0].id;
}

/** Run the oldest queued qualification test. Returns its id, or null when nothing was queued. */
export async function runQueuedQualifyTest(pool: pg.Pool, deps: { reader: WebReader; config: EngineConfig; llm: LLM }, log?: (m: string) => void): Promise<number | null> {
  await pool.query(
    "update public.qualify_test_runs set status = 'failed', error = 'Stopped: the worker restarted during the run', finished_at = now() where status = 'running' and started_at < now() - interval '6 hours'",
  );
  const { rows } = await pool.query(
    `update public.qualify_test_runs set status = 'running', started_at = now()
      where id = (select id from public.qualify_test_runs where status = 'queued' order by created_at limit 1 for update skip locked)
      returning id, input, budget_usd`,
  );
  const run = rows[0];
  if (!run) return null;
  try {
    const out = await runQualifyTest(run.input as QualifyTestLead[], {
      ...deps,
      budgetUsd: Number(run.budget_usd),
      record: async (costs) => {
        for (const c of costs) {
          await pool.query(
            `insert into public.usage_costs (workspace_id, step, model, input_tokens, output_tokens, cached_tokens, provider_units, cost_usd, qualify_test_run_id)
             values (null, $1, $2, $3, $4, $5, $6, $7, $8)`,
            [c.step, c.model, c.input_tokens ?? 0, c.output_tokens ?? 0, c.cached_tokens ?? 0, c.provider_units ?? 0, c.cost_usd, run.id],
          );
        }
      },
      progress: async (p) => {
        await pool.query("update public.qualify_test_runs set progress = $2, cost_usd = $3 where id = $1", [run.id, JSON.stringify(p), p.spentUsd]);
      },
    });
    await pool.query("update public.qualify_test_runs set status = $2, report = $3, cost_usd = $4, finished_at = now() where id = $1", [
      run.id,
      out.status,
      JSON.stringify(out.report),
      await runSpend(pool, run.id),
    ]);
    log?.(`qualification test: run ${run.id} ${out.status}`);
  } catch (e) {
    await pool.query("update public.qualify_test_runs set status = 'failed', error = $2, cost_usd = $3, finished_at = now() where id = $1", [
      run.id,
      (e as Error).message.slice(0, 500),
      await runSpend(pool, run.id),
    ]);
    log?.(`qualification test: run ${run.id} failed: ${(e as Error).message}`);
  }
  return run.id;
}

async function runSpend(pool: pg.Pool, runId: number): Promise<number> {
  const { rows } = await pool.query<{ usd: number }>("select coalesce(sum(cost_usd), 0)::float usd from public.usage_costs where qualify_test_run_id = $1", [runId]);
  return rows[0].usd;
}

export type QualifyTestRunRow = {
  id: number;
  status: string;
  provider: string | null;
  budget_usd: string;
  cost_usd: string;
  progress: { done?: number; total?: number; spentUsd?: number };
  report: QualifyTestReport | null;
  approved_by: string;
  error: string | null;
  created_at: string;
  leads: number;
};

export async function listQualifyTests(pool: pg.Pool, limit = 5): Promise<QualifyTestRunRow[]> {
  const { rows } = await pool.query(
    `select id, status, provider, budget_usd, cost_usd, progress, report, approved_by, error, created_at, jsonb_array_length(input) leads
       from public.qualify_test_runs order by created_at desc limit $1`,
    [limit],
  );
  return rows;
}
