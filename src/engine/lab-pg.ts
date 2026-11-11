// Quality Lab, the database side: test sets, queued eval runs, and the worker loop that runs them.
import type pg from "pg";
import { runEval, summarise, type LabDeps, type TestSet } from "./lab";
import { SKILLS } from "./skills";

/** Every skill version in code exists in skill_versions (eval_runs reference them). */
export async function upsertSkills(pool: pg.Pool, liveVersion: string) {
  for (const s of Object.values(SKILLS)) {
    await pool.query(
      `insert into public.skill_versions (version, prompt, rules, moves, status, traffic_share, changelog)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (version) do update set prompt = excluded.prompt, rules = excluded.rules, moves = excluded.moves,
         status = excluded.status, traffic_share = excluded.traffic_share, changelog = excluded.changelog`,
      [s.version, s.prompt, JSON.stringify(s.rules), JSON.stringify(s.moves), s.version === liveVersion ? "live" : "testing", s.version === liveVersion ? 100 : 0, s.changelog],
    );
  }
}

export async function saveTestSet(pool: pg.Pool, set: TestSet) {
  await pool.query(
    `insert into public.test_sets (id, name, template, leads) values ($1, $2, $3, $4)
     on conflict (id) do update set name = excluded.name, template = excluded.template, leads = excluded.leads`,
    [set.id, set.name, JSON.stringify(set.template), JSON.stringify(set.leads)],
  );
}

export async function queueEvalRun(pool: pg.Pool, input: { testSetId: string; candidate: string; baseline: string; provider: string }): Promise<number> {
  const { rows } = await pool.query(
    "insert into public.eval_runs (skill_version, baseline_version, test_set_id, provider, status) values ($1, $2, $3, $4, 'queued') returning id",
    [input.candidate, input.baseline, input.testSetId, input.provider],
  );
  return rows[0].id;
}

/** Run the oldest queued eval (one at a time). Returns its id, or null when nothing was queued. */
export async function runQueuedEval(pool: pg.Pool, deps: LabDeps, log?: (m: string) => void): Promise<number | null> {
  // Runs left "running" by a crashed worker start again.
  await pool.query("update public.eval_runs set status = 'queued' where status = 'running' and created_at < now() - interval '6 hours'");
  const { rows } = await pool.query(
    `update public.eval_runs set status = 'running', provider = $1
      where id = (select id from public.eval_runs where status = 'queued' order by created_at limit 1 for update skip locked)
      returning id, skill_version, baseline_version, test_set_id`,
    [deps.llm.provider],
  );
  const run = rows[0];
  if (!run) return null;
  try {
    const { rows: sets } = await pool.query("select id, name, template, leads from public.test_sets where id = $1", [run.test_set_id]);
    if (!sets[0]) throw new Error(`Test set "${run.test_set_id}" not found`);
    const versions = { candidate: run.skill_version, baseline: run.baseline_version ?? run.skill_version };
    const out = await runEval(sets[0] as TestSet, versions, deps, async (done, costUsd) => {
      const s = summarise(done);
      await pool.query("update public.eval_runs set details = $2, wins = $3, losses = $4, ties = $5, cost_usd = $6 where id = $1", [
        run.id,
        JSON.stringify(done),
        s.wins,
        s.losses,
        s.ties,
        costUsd,
      ]);
    });
    await pool.query(
      `update public.eval_runs set status = 'done', details = $2, wins = $3, losses = $4, ties = $5, judge_avg = $6,
              rule_fail_rate = $7, cost_usd = $8, human_picks = $9, finished_at = now() where id = $1`,
      [run.id, JSON.stringify(out.results), out.summary.wins, out.summary.losses, out.summary.ties, out.summary.judgeAvg, out.summary.ruleFailRate, out.costUsd, JSON.stringify({ summary: out.summary })],
    );
    log?.(`quality lab: run ${run.id} done (${versions.candidate} vs ${versions.baseline}): ${out.summary.verdictText}`);
  } catch (e) {
    await pool.query("update public.eval_runs set status = 'failed', error = $2, finished_at = now() where id = $1", [run.id, (e as Error).message.slice(0, 500)]);
    log?.(`quality lab: run ${run.id} failed: ${(e as Error).message}`);
  }
  return run.id;
}
