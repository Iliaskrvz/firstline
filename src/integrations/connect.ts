// Connecting a sending tool and receiving its webhooks: the logic behind the Integrations page and
// /api/integrations/webhook. Framework-agnostic (pg Pool + adapter factory), so it is tested end to end.
import type pg from "pg";
import { keyHint, randomToken, safeEqual } from "@/lib/secret-box";
import { applyToolEvents, integrationSecret, saveIntegration, setCapabilities, type ToolFactory } from "./push-pg";
import type { Provider } from "./types";

export function webhookPath(integrationId: string, token: string): string {
  return `/api/integrations/webhook/${integrationId}/${token}`;
}

/**
 * Test the key, save it encrypted, register our webhook (or fall back to polling).
 * publicUrl: the app's public https address, or null when the tool can't reach us.
 */
export async function connectTool(
  pool: pg.Pool,
  key: Buffer,
  p: { workspaceId: string; provider: Provider; apiKey: string; publicUrl: string | null; toolFor: ToolFactory },
): Promise<{ error: string } | { ok: true; integrationId: string; webhooks: boolean; note: string | null }> {
  let tool;
  try {
    tool = p.toolFor(p.provider, p.apiKey);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const test = await tool.testConnection();
  if (!test.ok) return { error: test.reason };

  // Replace an earlier connection: remove its webhooks in the tool first (best effort).
  const { rows: old } = await pool.query<{ id: string }>("select id from public.integrations where workspace_id = $1 and provider = $2 and status <> 'disconnected'", [p.workspaceId, p.provider]);
  if (old[0]) {
    const prev = await integrationSecret(pool, key, old[0].id).catch(() => null);
    if (prev?.row.tool_webhook_ids.length) await Promise.resolve(p.toolFor(p.provider, prev.apiKey).removeWebhooks(prev.row.tool_webhook_ids)).catch(() => {});
  }

  const token = randomToken();
  const id = await saveIntegration(pool, key, { workspaceId: p.workspaceId, provider: p.provider, apiKey: p.apiKey, keyHint: keyHint(p.apiKey), accountName: test.accountName, webhookToken: token });
  let note: string | null = null;
  let webhooks = false;
  if (tool.webhookMode === "campaign") {
    // Webhooks are added to each tool campaign on its first push (see push-pg ensureCampaignWebhook).
    const can = test.webhooks && !!p.publicUrl;
    await setCapabilities(pool, id, { webhooks: can, perCampaign: true, reason: can ? undefined : "No public https address or no webhooks: FirstLine checks statuses every 15 minutes instead." }, []);
    return {
      ok: true,
      integrationId: id,
      webhooks: can,
      note: can ? "Connected. FirstLine adds its webhook to each campaign the first time you push to it." : "Connected. Without webhooks, FirstLine checks reply and bounce status every 15 minutes.",
    };
  }
  if (!test.webhooks) {
    note = `${test.webhooksReason ?? "Webhooks are not available."} FirstLine checks reply and bounce status every 15 minutes instead.`;
  } else if (!p.publicUrl) {
    note = "This app has no public https address yet (PUBLIC_APP_URL), so the tool can't call it. FirstLine checks statuses every 15 minutes instead.";
  } else {
    const hooks = await tool.setupWebhooks(`${p.publicUrl.replace(/\/+$/, "")}${webhookPath(id, token)}`);
    if (hooks.ok) {
      webhooks = true;
      await setCapabilities(pool, id, { webhooks: true }, hooks.ids);
    } else {
      note = `Couldn't set up webhooks (${hooks.reason}). FirstLine checks statuses every 15 minutes instead.`;
    }
  }
  if (!webhooks) await setCapabilities(pool, id, { webhooks: false, reason: note ?? undefined }, []);
  return { ok: true, integrationId: id, webhooks, note };
}

export const MAX_WEBHOOK_BODY = 512 * 1024;

/** One webhook call: check the URL token, parse, apply each event once. Returns an HTTP status and body. */
export async function receiveWebhook(
  pool: pg.Pool,
  key: Buffer,
  p: { integrationId: string; token: string; body: string; toolFor: ToolFactory },
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!/^[0-9a-f-]{36}$/i.test(p.integrationId) || p.token.length < 16) return { status: 404, body: { error: "not_found" } };
  const secret = await integrationSecret(pool, key, p.integrationId);
  if (!secret?.webhookToken || !safeEqual(secret.webhookToken, p.token)) return { status: 404, body: { error: "not_found" } };
  if (p.body.length > MAX_WEBHOOK_BODY) return { status: 413, body: { error: "too_large" } };
  let parsed: unknown;
  try {
    parsed = JSON.parse(p.body);
  } catch {
    return { status: 400, body: { error: "invalid_json" } };
  }
  const tool = p.toolFor(secret.row.provider, secret.apiKey);
  const events = (Array.isArray(parsed) ? parsed : [parsed]).flatMap((b) => tool.handleWebhook(b));
  const r = await applyToolEvents(pool, p.integrationId, events, "webhook");
  return { status: 200, body: { ok: true, ...r } };
}
