"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createApiKey, revokeApiKey } from "@/api/core-pg";
import { createEndpoint, deleteEndpoint, validEndpointUrl, WEBHOOK_EVENTS, type WebhookEvent } from "@/api/webhooks-pg";
import { requireWorkspace } from "@/lib/auth";
import { encryptionConfigured, encryptionKey } from "@/lib/secret-box";
import { serverPool } from "@/server/db";
import { queueConfigured } from "@/server/queue";

const NOT_READY = "The API needs DATABASE_URL and INTEGRATIONS_ENCRYPTION_KEY in .env.local.";

/** Only the workspace owner manages keys and webhooks (admins too, once teams exist: Phase 10). */
async function owner() {
  const { workspace, user } = await requireWorkspace();
  const pool = serverPool();
  const { rows } = await pool.query("select 1 from public.workspaces where id = $1 and owner_id = $2", [workspace.id, user.id]);
  if (!rows[0]) return null;
  return { workspace, user, pool };
}

export async function createKey(name: string): Promise<{ error: string } | { key: string }> {
  const n = z.string().trim().min(1, "Give the key a name, e.g. n8n.").max(60).safeParse(name);
  if (!n.success) return { error: n.error.issues[0].message };
  if (!queueConfigured()) return { error: NOT_READY };
  const o = await owner();
  if (!o) return { error: "Only the workspace owner can create API keys." };
  const { key } = await createApiKey(o.pool, o.workspace.id, n.data, o.user.id);
  revalidatePath("/settings/api");
  return { key };
}

export async function revokeKey(id: string): Promise<{ error: string } | { ok: true }> {
  if (!z.uuid().safeParse(id).success) return { error: "Invalid key." };
  const o = await owner();
  if (!o) return { error: "Only the workspace owner can revoke API keys." };
  await revokeApiKey(o.pool, o.workspace.id, id);
  revalidatePath("/settings/api");
  return { ok: true };
}

export async function addWebhook(url: string, events: string[]): Promise<{ error: string } | { secret: string }> {
  if (!queueConfigured() || !encryptionConfigured()) return { error: NOT_READY };
  const u = url.trim();
  const bad = validEndpointUrl(u, process.env.NODE_ENV !== "production");
  if (bad) return { error: bad };
  const ev = events.filter((e): e is WebhookEvent => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (!ev.length) return { error: "Pick at least one event." };
  const o = await owner();
  if (!o) return { error: "Only the workspace owner can add webhooks." };
  const { secret } = await createEndpoint(o.pool, encryptionKey(), o.workspace.id, u, ev);
  revalidatePath("/settings/api");
  return { secret };
}

export async function removeWebhook(id: string): Promise<{ error: string } | { ok: true }> {
  if (!z.uuid().safeParse(id).success) return { error: "Invalid webhook." };
  const o = await owner();
  if (!o) return { error: "Only the workspace owner can remove webhooks." };
  await deleteEndpoint(o.pool, o.workspace.id, id);
  revalidatePath("/settings/api");
  return { ok: true };
}
