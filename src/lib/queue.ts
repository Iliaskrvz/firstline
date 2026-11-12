// Shared by the web app (enqueue) and the worker (consume). No pg-boss import here.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const LEAD_QUEUE = "lead-process";

export type LeadJobData = {
  leadId: string;
  workspaceId: string;
  preview: boolean;
  /** Re-run a lead that already finished (preview regenerate). */
  force: boolean;
  /** How often this lead already waited for a slot (for the growing wait). Not a failure count. */
  deferrals?: number;
};

/** Highest per-workspace limit the queue knows (pg-boss group tiers c1 … c50). */
export const MAX_GROUP_TIER = 50;
/** pg-boss group concurrency per tier, enforced globally across all workers by the queue itself. */
export const GROUP_TIERS: Record<string, number> = Object.fromEntries(Array.from({ length: MAX_GROUP_TIER }, (_, i) => [`c${i + 1}`, i + 1]));

/**
 * The queue group for a lead job: the workspace, with its leads-at-once limit as the tier, so the
 * queue never hands out more of its jobs at once. Previews get their own group (up to 5 at once),
 * so a preview isn't stuck behind the workspace's own big run.
 */
export function leadJobGroup(data: Pick<LeadJobData, "workspaceId" | "preview">, limit: number): { id: string; tier: string } {
  if (data.preview) return { id: `${data.workspaceId}:preview`, tier: "c5" };
  return { id: data.workspaceId, tier: `c${Math.min(MAX_GROUP_TIER, Math.max(1, Math.floor(limit)))}` };
}

/** Queue priority: free previews before runs, so a preview stays fast while a big run is going. */
export function leadJobPriority(data: Pick<LeadJobData, "preview">): number {
  return data.preview ? 10 : 0;
}

/** Deterministic job id: enqueuing the same lead twice in one run is a no-op. */
export function leadJobId(leadId: string, runId: string): string {
  const h = createHash("sha1").update(`${leadId}:${runId}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Postgres connection settings for the Supabase session pooler. Supabase signs
 * with its own CA: set DATABASE_CA_CERT to the downloaded certificate
 * (Supabase → Database settings → SSL) to verify it; otherwise the connection
 * is still encrypted but the server certificate isn't verified.
 */
export function dbConnection(url: string, env: Record<string, string | undefined> = process.env) {
  const u = new URL(url);
  u.searchParams.delete("sslmode");
  const local = ["localhost", "127.0.0.1", "::1"].includes(u.hostname);
  const caPath = env.DATABASE_CA_CERT?.trim();
  const ssl = local ? false : caPath ? { ca: readFileSync(caPath, "utf8"), rejectUnauthorized: true } : { rejectUnauthorized: false };
  return { connectionString: u.toString(), ssl };
}

/** Pushes to sending tools (§8 Lane B): one job per push; the worker also resumes stuck pushes on its own. */
export const PUSH_QUEUE = "push-run";
export type PushJobData = { pushId: string };
