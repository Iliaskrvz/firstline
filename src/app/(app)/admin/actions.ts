"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { serverPool } from "@/server/db";
import { setLlmOverride } from "@/lib/own-use-pg";
import { grantCredits as grantLedger, MAX_GRANT } from "@/billing/db";
import { logActivity } from "@/teams/db";

/** Leads in progress at once for one workspace (Phase 10). null = automatic from credits bought. */
export async function setConcurrency(workspaceId: string, limit: number | null): Promise<{ error: string } | undefined> {
  if (!z.uuid().safeParse(workspaceId).success) return { error: "Invalid workspace." };
  if (limit !== null && !(Number.isInteger(limit) && limit >= 1 && limit <= 200)) return { error: "Use a number from 1 to 200, or empty for automatic." };
  const { user } = await requireAdmin();
  const pool = serverPool();
  await pool.query("update public.workspaces set concurrency_limit = $2 where id = $1", [workspaceId, limit]);
  await logActivity(pool, { workspaceId, userId: user.id, actor: "FirstLine support", action: "workspace.concurrency_changed", details: { limit } });
  revalidatePath("/admin");
}

/** §11 abuse switch: turn the Sender API off (or on) for one workspace. */
export async function setSenderDisabled(workspaceId: string, disabled: boolean): Promise<{ error: string } | undefined> {
  if (!z.uuid().safeParse(workspaceId).success) return { error: "Invalid workspace." };
  await requireAdmin();
  await serverPool().query("update public.workspaces set sender_disabled = $2 where id = $1", [workspaceId, disabled]);
  revalidatePath("/admin");
}

/**
 * Own use: let one workspace (the owner's) use the real Claude provider while everyone else stays on
 * the server's provider. Its costs are logged as own use, outside the customer margin.
 */
export async function setOwnUse(workspaceId: string, on: boolean): Promise<{ error: string } | undefined> {
  if (!z.uuid().safeParse(workspaceId).success) return { error: "Invalid workspace." };
  const { user } = await requireAdmin();
  const pool = serverPool();
  await setLlmOverride(pool, { workspaceId, provider: on ? "anthropic" : null, setBy: user.email ?? "admin" });
  await logActivity(pool, { workspaceId, userId: user.id, actor: "FirstLine support", action: on ? "workspace.own_use_on" : "workspace.own_use_off", details: { provider: on ? "anthropic" : null } });
  revalidatePath("/admin");
}

/**
 * Free credits for a workspace (e.g. your own outreach test). A "bonus" in the ledger: never counted as
 * bought or as revenue. requestId (made when the form opens) stops a double click from granting twice.
 */
export async function grantCredits(input: { workspaceId: string; credits: number; reason: string; requestId: string }): Promise<{ error: string } | { ok: true; added: boolean }> {
  const parsed = z
    .object({
      workspaceId: z.uuid(),
      credits: z.number().int().min(1, "Grant at least 1 credit.").max(MAX_GRANT, `At most ${MAX_GRANT} credits per grant.`),
      reason: z.string().trim().min(3, "Say what the grant is for.").max(120),
      requestId: z.uuid(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid grant." };
  const { user } = await requireAdmin();
  const pool = serverPool();
  const { workspaceId, credits, reason, requestId } = parsed.data;
  const added = await grantLedger(pool, { workspaceId, credits, key: `grant:${requestId}`, note: `Admin grant: ${reason}` });
  if (added) await logActivity(pool, { workspaceId, userId: user.id, actor: "FirstLine support", action: "credits.granted", details: { credits, reason } });
  revalidatePath("/admin");
  revalidatePath("/credits");
  return { ok: true, added };
}
