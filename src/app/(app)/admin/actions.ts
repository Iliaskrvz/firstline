"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { serverPool } from "@/server/db";
import { setLlmOverride } from "@/lib/own-use-pg";
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
