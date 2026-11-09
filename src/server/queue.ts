// Enqueue lead jobs from the web app (server only). The worker consumes them.
import "server-only";
import { isDatabaseUrl } from "@/lib/env";
import { PgBoss } from "pg-boss";
import { dbConnection, LEAD_QUEUE, leadJobId, type LeadJobData } from "@/lib/queue";

let bossPromise: Promise<PgBoss> | null = null;

export function queueConfigured(): boolean {
  return isDatabaseUrl(process.env.DATABASE_URL);
}

async function getBoss(): Promise<PgBoss> {
  if (!bossPromise) {
    bossPromise = (async () => {
      const boss = new PgBoss({ ...dbConnection(process.env.DATABASE_URL!), max: 2, schema: "pgboss", supervise: false, schedule: false });
      boss.on("error", (e) => console.error("pg-boss (web):", e.message));
      await boss.start();
      if (!(await boss.getQueue(LEAD_QUEUE))) {
        await boss.createQueue(LEAD_QUEUE, { retryLimit: 3, retryDelay: 20, retryBackoff: true, expireInSeconds: 600 });
      }
      return boss;
    })().catch((e) => {
      bossPromise = null;
      throw e;
    });
  }
  return bossPromise;
}

export async function enqueueLeads(jobs: LeadJobData[], runId: string): Promise<number> {
  const boss = await getBoss();
  let n = 0;
  for (const data of jobs) {
    const id = await boss.send(LEAD_QUEUE, data, { id: leadJobId(data.leadId, runId), group: { id: data.workspaceId } }).catch(() => null);
    if (id) n++;
  }
  return n;
}
