// POST /api/integrations/webhook/{integrationId}/{token}: events from a sending tool.
// Tools like Instantly don't sign webhooks, so the secret token in the URL authenticates the call.
// Only status flags are kept: reply text in the payload is never stored or logged.
import type { NextRequest } from "next/server";
import { createTool } from "@/integrations/registry";
import { applyToolEvents, integrationSecret } from "@/integrations/push-pg";
import { encryptionKey, safeEqual } from "@/lib/secret-box";
import { serverPool } from "@/server/db";

const MAX_BODY = 512 * 1024;
const notFound = () => Response.json({ error: "not_found" }, { status: 404 });

export async function POST(request: NextRequest, ctx: RouteContext<"/api/integrations/webhook/[id]/[token]">) {
  const { id, token } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || token.length < 16) return notFound();
  let key: Buffer;
  try {
    key = encryptionKey();
  } catch {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }
  const pool = serverPool();
  const secret = await integrationSecret(pool, key, id);
  if (!secret?.webhookToken || !safeEqual(secret.webhookToken, token)) return notFound();

  const text = await request.text();
  if (text.length > MAX_BODY) return Response.json({ error: "too_large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const tool = createTool(secret.row.provider, secret.apiKey);
  const events = (Array.isArray(body) ? body : [body]).flatMap((b) => tool.handleWebhook(b));
  const r = await applyToolEvents(pool, id, events, "webhook");
  return Response.json({ ok: true, ...r });
}
