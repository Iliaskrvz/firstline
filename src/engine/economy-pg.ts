// Economy mode, the batch side (Postgres). Run by the worker every minute:
//   1. submitPending: bundle waiting writes per campaign into a batch;
//   2. collectFinished: when a batch has ended, store each answer and hand the lead
//      back to the queue, where the pipeline finishes it (checks, judge, credits).
// No queue imports here: the worker passes `enqueue`.
import type pg from "pg";
import type { BatchItem, LLM } from "./llm";

export const MAX_BATCH_ITEMS = 10_000;
/** A campaign's batch goes out when its research phase is over, or after this long at the latest. */
export const MAX_WAIT_MS = 10 * 60_000;
/** Batches end within 24 h; one that is still open after this is given up and its leads are written directly. */
export const GIVE_UP_MS = 26 * 60 * 60_000;

type Enqueue = (leads: { leadId: string; workspaceId: string }[], runId: string) => Promise<unknown>;
type Opts = { now?: Date; log?: (m: string) => void };

export async function submitPending(pool: pg.Pool, llm: LLM, enqueue: Enqueue, opts: Opts = {}): Promise<{ batches: number; items: number }> {
  const now = opts.now ?? new Date();
  const out = { batches: 0, items: 0 };
  if (!llm.batch) return out;

  // A stopped campaign: hand its waiting leads back; the pipeline skips them and returns their credits.
  const { rows: stopped } = await pool.query(
    `select i.lead_id, i.workspace_id from public.batch_items i join public.campaigns c on c.id = i.campaign_id
      where i.status = 'pending' and c.status <> 'running'`,
  );
  if (stopped.length) await enqueue(stopped.map((r) => ({ leadId: r.lead_id, workspaceId: r.workspace_id })), `eco-stopped-${now.getTime()}`);

  const { rows: campaigns } = await pool.query(
    `select i.campaign_id, min(i.created_at) oldest,
            (select count(*) from public.leads l where l.campaign_id = i.campaign_id and l.status in ('queued', 'researching'))::int still_researching
       from public.batch_items i join public.campaigns c on c.id = i.campaign_id
      where i.status = 'pending' and c.status = 'running'
      group by i.campaign_id`,
  );
  for (const c of campaigns) {
    const waited = now.getTime() - new Date(c.oldest).getTime();
    if (c.still_researching > 0 && waited < MAX_WAIT_MS) continue;
    const { rows } = await pool.query("select id, input from public.batch_items where campaign_id = $1 and status = 'pending' order by created_at limit $2", [
      c.campaign_id,
      MAX_BATCH_ITEMS,
    ]);
    const items: BatchItem[] = rows.map((r) => ({ id: r.id, input: r.input }));
    let providerId: string;
    try {
      providerId = await llm.batch.submit(items);
    } catch (e) {
      opts.log?.(`economy: submitting ${items.length} writes for campaign ${c.campaign_id} failed, will retry: ${(e as Error).message}`);
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query("begin");
      const { rows: job } = await client.query(
        "insert into public.batch_jobs (provider, provider_batch_id, campaign_id, item_count) values ($1, $2, $3, $4) returning id",
        [llm.provider, providerId, c.campaign_id, items.length],
      );
      await client.query("update public.batch_items set status = 'submitted', batch_job_id = $2, updated_at = now() where id = any($1::uuid[])", [
        items.map((i) => i.id),
        job[0].id,
      ]);
      await client.query("commit");
    } catch (e) {
      await client.query("rollback").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
    out.batches++;
    out.items += items.length;
    opts.log?.(`economy: batch ${providerId} submitted with ${items.length} writes`);
  }
  return out;
}

export async function collectFinished(pool: pg.Pool, llm: LLM, enqueue: Enqueue, opts: Opts = {}): Promise<{ batches: number; done: number; errors: number }> {
  const now = opts.now ?? new Date();
  const out = { batches: 0, done: 0, errors: 0 };
  if (!llm.batch) return out;
  const { rows: jobs } = await pool.query("select id, provider_batch_id, created_at from public.batch_jobs where status = 'submitted' and provider = $1 order by created_at", [
    llm.provider,
  ]);
  for (const job of jobs) {
    const gaveUp = now.getTime() - new Date(job.created_at).getTime() > GIVE_UP_MS;
    let ended = false;
    try {
      ended = (await llm.batch.status(job.provider_batch_id)) === "ended";
    } catch (e) {
      opts.log?.(`economy: checking batch ${job.provider_batch_id} failed: ${(e as Error).message}`);
    }
    if (!ended && !gaveUp) continue;

    const { rows } = await pool.query("select id, lead_id, workspace_id, input from public.batch_items where batch_job_id = $1 and status = 'submitted'", [job.id]);
    const results = ended ? await llm.batch.results(job.provider_batch_id, rows.map((r) => ({ id: r.id, input: r.input }))) : [];
    const byId = new Map(results.map((r) => [r.id, r]));
    for (const r of rows) {
      const res = byId.get(r.id);
      if (res?.output) {
        await pool.query("update public.batch_items set status = 'done', output = $2, costs = $3, updated_at = now() where id = $1", [
          r.id,
          JSON.stringify(res.output),
          JSON.stringify(res.costs),
        ]);
        out.done++;
      } else {
        await pool.query("update public.batch_items set status = 'error', error = $2, costs = $3, updated_at = now() where id = $1", [
          r.id,
          res?.error ?? (ended ? "No result in the batch" : "The batch didn't finish in time"),
          JSON.stringify(res?.costs ?? []),
        ]);
        out.errors++;
      }
    }
    await pool.query("update public.batch_jobs set status = $2, ended_at = now() where id = $1", [job.id, ended ? "ended" : "failed"]);
    // Back to the queue: the pipeline uses the answer (or writes directly after an error) and settles the lead.
    await enqueue(rows.map((r) => ({ leadId: r.lead_id, workspaceId: r.workspace_id })), `eco-${job.id}`);
    out.batches++;
    opts.log?.(`economy: batch ${job.provider_batch_id} ${ended ? "ended" : "given up"}: ${rows.length} leads back in the queue`);
  }
  return out;
}
