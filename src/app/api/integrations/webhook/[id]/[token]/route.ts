// POST /api/integrations/webhook/{integrationId}/{token}: events from a sending tool.
// Tools like Instantly don't sign webhooks, so the secret token in the URL authenticates the call.
// Only status flags are kept: reply text in the payload is never stored or logged.
import type { NextRequest } from "next/server";
import { receiveWebhook } from "@/integrations/connect";
import { createTool } from "@/integrations/registry";
import { encryptionKey } from "@/lib/secret-box";
import { serverPool } from "@/server/db";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/integrations/webhook/[id]/[token]">) {
  const { id, token } = await ctx.params;
  let key: Buffer;
  try {
    key = encryptionKey();
  } catch {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }
  const r = await receiveWebhook(serverPool(), key, { integrationId: id, token, body: await request.text(), toolFor: (p, k) => createTool(p, k) });
  return Response.json(r.body, { status: r.status });
}
