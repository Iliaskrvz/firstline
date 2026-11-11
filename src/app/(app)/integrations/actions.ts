"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createTool } from "@/integrations/registry";
import { disconnectIntegration, integrationSecret, saveIntegration, setCapabilities } from "@/integrations/push-pg";
import { LIVE_PROVIDERS, PROVIDER_NAMES, type Provider } from "@/integrations/types";
import { requireWorkspace } from "@/lib/auth";
import { encryptionKey, keyHint, randomToken } from "@/lib/secret-box";
import { serverPool } from "@/server/db";
import { encryptionConfigured, webhookUrl } from "@/server/integrations";
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

  let tool;
  try {
    tool = createTool(provider, apiKey);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const test = await tool.testConnection();
  if (!test.ok) return { error: test.reason };

  // Replace an earlier connection: remove its webhooks in the tool first (best effort).
  const { rows: old } = await pool.query<{ id: string }>("select id from public.integrations where workspace_id = $1 and provider = $2 and status <> 'disconnected'", [workspace.id, provider]);
  if (old[0]) {
    const prev = await integrationSecret(pool, key, old[0].id).catch(() => null);
    if (prev?.row.tool_webhook_ids.length) await createTool(provider, prev.apiKey).removeWebhooks(prev.row.tool_webhook_ids).catch(() => {});
  }

  const token = randomToken();
  const id = await saveIntegration(pool, key, { workspaceId: workspace.id, provider, apiKey, keyHint: keyHint(apiKey), accountName: test.accountName, webhookToken: token });
  let note: string | null = null;
  let webhooks = false;
  if (!test.webhooks) {
    note = `${test.webhooksReason ?? "Webhooks are not available."} FirstLine checks reply and bounce status every 15 minutes instead.`;
  } else {
    const url = webhookUrl(id, token);
    if (!url) {
      note = "This app has no public https address yet (PUBLIC_APP_URL), so the tool can't call it. FirstLine checks statuses every 15 minutes instead.";
    } else {
      const hooks = await tool.setupWebhooks(url);
      if (hooks.ok) {
        webhooks = true;
        await setCapabilities(pool, id, { webhooks: true }, hooks.ids);
      } else {
        note = `Couldn't set up webhooks (${hooks.reason}). FirstLine checks statuses every 15 minutes instead.`;
      }
    }
  }
  if (!webhooks) await setCapabilities(pool, id, { webhooks: false, reason: note ?? undefined }, []);
  revalidatePath("/integrations");
  return { ok: true, webhooks, note };
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
