"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createTool } from "@/integrations/registry";
import { connectTool } from "@/integrations/connect";
import { disconnectIntegration, integrationSecret } from "@/integrations/push-pg";
import { LIVE_PROVIDERS, PROVIDER_NAMES, type Provider } from "@/integrations/types";
import { requireWorkspace } from "@/lib/auth";
import { encryptionKey } from "@/lib/secret-box";
import { serverPool } from "@/server/db";
import { encryptionConfigured } from "@/server/integrations";
import { publicAppUrl } from "@/server/sender-view";
import { queueConfigured } from "@/server/queue";

const NOT_READY = "Integrations need DATABASE_URL and INTEGRATIONS_ENCRYPTION_KEY in .env.local (see the README).";

const Connect = z.object({
  provider: z.enum(LIVE_PROVIDERS as [Provider, ...Provider[]]),
  apiKey: z.string().trim().min(8, "Paste the full API key.").max(500),
});

/** Test the key, save it encrypted, and register our webhook (or fall back to polling). */
export async function connectIntegration(input: z.input<typeof Connect>): Promise<{ error: string } | { ok: true; webhooks: boolean; note: string | null }> {
  const parsed = Connect.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid key." };
  if (!queueConfigured() || !encryptionConfigured()) return { error: NOT_READY };
  const { provider, apiKey } = parsed.data;
  const { workspace } = await requireWorkspace();
  const pool = serverPool();
  const key = encryptionKey();

  const r = await connectTool(pool, key, { workspaceId: workspace.id, provider, apiKey, publicUrl: publicAppUrl(), toolFor: (p, k) => createTool(p, k) });
  if ("error" in r) return r;
  revalidatePath("/integrations");
  return { ok: true, webhooks: r.webhooks, note: r.note };
}

export async function disconnect(integrationId: string): Promise<{ error: string } | { ok: true }> {
  if (!z.uuid().safeParse(integrationId).success) return { error: "Invalid integration." };
  if (!queueConfigured() || !encryptionConfigured()) return { error: NOT_READY };
  const { workspace } = await requireWorkspace();
  const pool = serverPool();
  const s = await integrationSecret(pool, encryptionKey(), integrationId).catch(() => null);
  if (s && s.row.workspace_id !== workspace.id) return { error: "Invalid integration." };
  if (s?.row.tool_webhook_ids.length) await createTool(s.row.provider, s.apiKey).removeWebhooks(s.row.tool_webhook_ids).catch(() => {});
  await disconnectIntegration(pool, workspace.id, integrationId);
  revalidatePath("/integrations");
  return { ok: true };
}

/** Re-test a saved key (e.g. after changing the plan in the tool). */
export async function retest(integrationId: string): Promise<{ error: string } | { ok: true; message: string }> {
  if (!z.uuid().safeParse(integrationId).success) return { error: "Invalid integration." };
  if (!queueConfigured() || !encryptionConfigured()) return { error: NOT_READY };
  const { workspace } = await requireWorkspace();
  const pool = serverPool();
  const s = await integrationSecret(pool, encryptionKey(), integrationId);
  if (!s || s.row.workspace_id !== workspace.id) return { error: "Invalid integration." };
  const t = await createTool(s.row.provider, s.apiKey).testConnection();
  await pool.query("update public.integrations set status = $2, last_error = $3, last_checked_at = now() where id = $1", [
    integrationId,
    t.ok ? "connected" : "error",
    t.ok ? null : t.reason,
  ]);
  revalidatePath("/integrations");
  return t.ok ? { ok: true, message: `${PROVIDER_NAMES[s.row.provider]} answered: the key works.` } : { error: t.reason };
}
