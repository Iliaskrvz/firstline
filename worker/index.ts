// FirstLine worker: pulls one job per lead from pg-boss (Supabase Postgres) and
// runs the engine. Run locally with `npm run worker`; on the VPS with pm2
// (see worker/ecosystem.config.cjs). All job logic lives in src/engine/.
import { config as loadEnv } from "dotenv";
// .env.local wins over the shell, so a stale exported key can't shadow it.
loadEnv({ path: ".env.local", override: true, quiet: true });

import { createServer } from "node:http";
import { hostname } from "node:os";
import { Pool } from "pg";
import { PgBoss } from "pg-boss";
import { engineConfig } from "@/engine/config";
import { createFirecrawl } from "@/engine/firecrawl";
import { effectiveConcurrency, Semaphore } from "@/engine/limiter";
import { selectLLM } from "@/engine/llm";
import { processLead } from "@/engine/pipeline";
import { upsertSkills, runQueuedEval } from "@/engine/lab-pg";
import { LIVE_SKILL_VERSION } from "@/engine/skills";
import { PgStore } from "@/engine/store-pg";
import { missingEnv, missingEnvMessage } from "@/lib/env";
import { runRetention } from "@/billing/retention";
import { collectFinished, submitPending } from "@/engine/economy-pg";
import { dbConnection, LEAD_QUEUE, leadJobId, PUSH_QUEUE, type LeadJobData, type PushJobData } from "@/lib/queue";
import { createTool } from "@/integrations/registry";
import { pollIntegrations, pushesToResume, runPush, type PushDeps } from "@/integrations/push-pg";
import { encryptionKey } from "@/lib/secret-box";
import { apiHousekeeping, completeFinishedJobs, completeJobsFor } from "@/api/core-pg";
import { deliverDue } from "@/api/webhooks-pg";
import { checkInboxHealth, resendMailer } from "@/sender/alerts";

const VERSION = process.env.npm_package_version ?? "dev";
const WORKER_ID = `${hostname()}-${process.pid}`;
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function main() {
  const missing = missingEnv(process.env, ["database", "firecrawl"]);
  if (missing.length) {
    console.error(`\nFirstLine worker can't start.\n${missingEnvMessage(missing)}\n`);
    process.exit(1);
  }
  const config = engineConfig();
  const llm = await selectLLM(config);
  if (config.llmProvider === "anthropic" && !config.anthropicApiKey) {
    log("⚠ LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is missing: research runs, AI steps will show 'Anthropic key missing'.");
  }

  const conn = dbConnection(process.env.DATABASE_URL!);
  const pool = new Pool({ ...conn, max: config.concurrency.perWorker + 2 });
  const store = new PgStore(pool);
  const reader = createFirecrawl(config.firecrawlApiKey!);
  const planLimit = (await reader.planConcurrency?.()) ?? null;
  const firecrawlSlots = effectiveConcurrency(config.concurrency.firecrawl, planLimit);
  if (firecrawlSlots < config.concurrency.firecrawl) {
    log(`Firecrawl plan allows ${planLimit} requests at once: using ${firecrawlSlots} (FIRECRAWL_CONCURRENCY=${config.concurrency.firecrawl}).`);
  }
  const firecrawlGate = new Semaphore(firecrawlSlots);

  const stats = { jobsDone: 0, jobsFailed: 0, lastHeartbeatAt: null as Date | null, lastHeartbeatError: null as string | null, startedAt: new Date() };

  // Skill versions (§6), from code into skill_versions (the Quality Lab references them).
  await upsertSkills(pool, LIVE_SKILL_VERSION);

  const boss = new PgBoss({ ...conn, max: 4, schema: "pgboss" });
  boss.on("error", (e) => log("pg-boss error:", e.message));
  await boss.start();
  if (!(await boss.getQueue(LEAD_QUEUE))) {
    await boss.createQueue(LEAD_QUEUE, {
      retryLimit: config.retries.jobRetryLimit,
      retryDelay: config.retries.jobRetryDelaySec,
      retryBackoff: true,
      expireInSeconds: 600,
    });
  }

  if (!(await boss.getQueue(PUSH_QUEUE))) {
    await boss.createQueue(PUSH_QUEUE, { retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 3600 });
  }

  const heartbeat = async () => {
    try {
      await pool.query(
        `insert into public.worker_heartbeats (worker_id, host, version, llm_provider, started_at, last_seen_at, jobs_done, jobs_failed)
         values ($1, $2, $3, $4, $5, now(), $6, $7)
         on conflict (worker_id) do update set last_seen_at = now(), jobs_done = excluded.jobs_done,
           jobs_failed = excluded.jobs_failed, llm_provider = excluded.llm_provider`,
        [WORKER_ID, hostname(), VERSION, llm.provider, stats.startedAt, stats.jobsDone, stats.jobsFailed],
      );
      stats.lastHeartbeatAt = new Date();
      stats.lastHeartbeatError = null;
    } catch (e) {
      stats.lastHeartbeatError = (e as Error).message;
      log("heartbeat failed:", stats.lastHeartbeatError);
    }
  };
  await heartbeat();
  const beat = setInterval(heartbeat, 15_000);

  // Inbox health (§8): email the owner when a Sender Sheet goes quiet inside its window.
  const resendKey = process.env.RESEND_API_KEY?.trim();
  const mailer = resendKey ? resendMailer(resendKey, process.env.ALERT_FROM_EMAIL?.trim() || "FirstLine <onboarding@resend.dev>") : null;
  if (!mailer) log("RESEND_API_KEY not set: offline inboxes show in the app, but no alert emails are sent.");
  const inboxCheck = async () => {
    try {
      const r = await checkInboxHealth(pool, mailer, { appUrl: process.env.PUBLIC_APP_URL?.trim() || null, log });
      if (r.alerted.length) log(`Offline inbox alert: ${r.alerted.join(", ")}`);
    } catch (e) {
      log("inbox health check failed:", (e as Error).message);
    }
  };
  await inboxCheck();
  const inboxTimer = setInterval(inboxCheck, 5 * 60_000);


  // Economy mode (§9): bundle waiting writes into batches and collect finished ones.
  const enqueueLeads = async (leads: { leadId: string; workspaceId: string }[], runId: string) => {
    for (const l of leads) {
      await boss
        .send(LEAD_QUEUE, { leadId: l.leadId, workspaceId: l.workspaceId, preview: false, force: false }, { id: leadJobId(l.leadId, runId), group: { id: l.workspaceId } })
        .catch(() => null);
    }
  };
  let economyBusy = false;
  const economyTick = async () => {
    if (economyBusy) return;
    economyBusy = true;
    try {
      await collectFinished(pool, llm, enqueueLeads, { log });
      await submitPending(pool, llm, enqueueLeads, { log });
    } catch (e) {
      log("economy tick failed:", (e as Error).message);
    } finally {
      economyBusy = false;
    }
  };
  const economyTimer = setInterval(economyTick, 30_000);

  // Quality Lab (§7.4): run queued evals one at a time, in the background.
  let labBusy = false;
  const labTick = async () => {
    if (labBusy) return;
    labBusy = true;
    try {
      while ((await runQueuedEval(pool, { store, reader, llm, config }, log)) != null) {
        /* next queued run */
      }
    } catch (e) {
      log("quality lab tick failed:", (e as Error).message);
    } finally {
      labBusy = false;
    }
  };
  const labTimer = setInterval(labTick, 60_000);

  // Pushes to sending tools (§8 Lane B): jobs from the app, plus resuming pushes a crashed worker left behind,
  // plus status polling for tools whose plan has no webhooks.
  let pushDeps: PushDeps | null = null;
  try {
    const publicUrl = process.env.PUBLIC_APP_URL?.trim().replace(/\/+$/, "") || null;
    pushDeps = { key: encryptionKey(), toolFor: (provider, apiKey) => createTool(provider, apiKey), publicUrl: publicUrl && /^https:\/\//.test(publicUrl) ? publicUrl : null, log };
  } catch {
    log("INTEGRATIONS_ENCRYPTION_KEY not set: pushes to sending tools are off.");
  }
  const runOnePush = async (pushId: string) => {
    if (!pushDeps) return;
    const r = await runPush(pool, pushId, pushDeps);
    if (r) log(`push ${pushId}: ${r.status} · ${r.added} added, ${r.skipped} skipped, ${r.failed} failed${r.error ? ` (${r.error})` : ""}`);
  };
  let pushBusy = false;
  const pushTick = async () => {
    if (pushBusy || !pushDeps) return;
    pushBusy = true;
    try {
      for (const id of await pushesToResume(pool)) await runOnePush(id);
      const p = await pollIntegrations(pool, pushDeps);
      if (p.applied) log(`integrations: ${p.applied} status update(s) from polling`);
    } catch (e) {
      log("push tick failed:", (e as Error).message);
    } finally {
      pushBusy = false;
    }
  };
  const pushTimer = setInterval(pushTick, 60_000);
  await boss.work<PushJobData>(PUSH_QUEUE, { localConcurrency: 2, pollingIntervalSeconds: 2 }, async ([job]) => {
    await runOnePush(job.data.pushId);
  });

  // Public API: finish jobs the hook missed, deliver signed webhooks, clean up.
  let apiBusy = false;
  const apiTick = async () => {
    if (apiBusy) return;
    apiBusy = true;
    try {
      await completeFinishedJobs(pool);
      if (pushDeps) {
        const d = await deliverDue(pool, pushDeps.key, (url, init) => fetch(url, { ...init, redirect: "manual" }));
        if (d.delivered || d.failed || d.retried) log(`webhooks: ${d.delivered} delivered, ${d.retried} to retry, ${d.failed} failed`);
      }
    } catch (e) {
      log("api tick failed:", (e as Error).message);
    } finally {
      apiBusy = false;
    }
  };
  const apiTimer = setInterval(apiTick, 15_000);

  // Data retention (§11): end idle campaigns and delete lead data 30 days after a campaign ended.
  const retention = async () => {
    try {
      await apiHousekeeping(pool);
      const r = await runRetention(pool);
      if (r.ended || r.purged) log(`retention: ${r.ended} campaign(s) ended, ${r.purged} purged (${r.leadsDeleted} leads deleted)`);
    } catch (e) {
      log("retention failed:", (e as Error).message);
    }
  };
  await retention();
  const retentionTimer = setInterval(retention, 6 * 60 * 60_000);

  await boss.work<LeadJobData>(
    LEAD_QUEUE,
    {
      localConcurrency: config.concurrency.perWorker, // jobs at once on this worker
      groupConcurrency: config.concurrency.perWorkspace, // per workspace, across all workers
      includeMetadata: true,
      pollingIntervalSeconds: 2,
    },
    async ([job]) => {
      const { leadId, preview, force } = job.data;
      const t0 = Date.now();
      try {
        const res = await processLead(leadId, { store, reader, llm, config, firecrawlGate }, { preview, force });
        stats.jobsDone++;
        // Public API: the last lead of a job finishes the job and queues its webhook.
        if (!preview) await completeJobsFor(pool, leadId).catch((e) => log("api job completion failed:", (e as Error).message));
        log(`lead ${leadId}: ${res.outcome}${res.detail ? ` (${res.detail})` : ""} · $${res.costUsd.toFixed(5)} · ${Date.now() - t0}ms`);
        return res;
      } catch (e) {
        const msg = (e as Error).message;
        const finalAttempt = job.retryCount >= config.retries.jobRetryLimit;
        log(`lead ${leadId}: error (attempt ${job.retryCount + 1}${finalAttempt ? ", giving up" : ", will retry"}): ${msg}`);
        if (finalAttempt) {
          stats.jobsFailed++;
          await store.setLeadStatus(leadId, "failed", { detail: `Error after retries: ${msg.slice(0, 200)}`, confidence: null }).catch(() => {});
          await completeJobsFor(pool, leadId).catch(() => {});
        }
        throw e; // pg-boss retries with backoff
      }
    },
  );

  // /health for uptime checks (and the VPS later).
  const port = Number(process.env.WORKER_HEALTH_PORT ?? 8787);
  const server = createServer(async (req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }
    const stale = !stats.lastHeartbeatAt || Date.now() - stats.lastHeartbeatAt.getTime() > 60_000;
    let queue: unknown = null;
    try {
      queue = await boss.getQueue(LEAD_QUEUE);
    } catch {
      /* report without queue stats */
    }
    const body = {
      ok: !stale,
      worker_id: WORKER_ID,
      version: VERSION,
      llm_provider: llm.provider,
      uptime_s: Math.round((Date.now() - stats.startedAt.getTime()) / 1000),
      last_heartbeat_at: stats.lastHeartbeatAt,
      last_heartbeat_error: stats.lastHeartbeatError,
      jobs_done: stats.jobsDone,
      jobs_failed: stats.jobsFailed,
      queue,
    };
    res.writeHead(stale ? 503 : 200, { "Content-Type": "application/json" }).end(JSON.stringify(body, null, 2));
  });
  server.listen(port, "127.0.0.1", () => log(`health: http://127.0.0.1:${port}/health`));

  log(`FirstLine worker ${WORKER_ID} started · LLM: ${llm.provider}${llm.provider === "fake" ? " (test output, no AI used)" : ""} · concurrency ${config.concurrency.perWorker}/worker, ${config.concurrency.perWorkspace}/workspace`);

  const shutdown = async (signal: string) => {
    log(`${signal}: finishing running jobs…`);
    clearInterval(beat);
    clearInterval(inboxTimer);
    clearInterval(economyTimer);
    clearInterval(labTimer);
    clearInterval(retentionTimer);
    clearInterval(pushTimer);
    clearInterval(apiTimer);
    server.close();
    await boss.stop({ graceful: true, timeout: 30_000 }).catch(() => {});
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((e) => {
  console.error("Worker crashed:", e);
  process.exit(1); // pm2 restarts it
});
