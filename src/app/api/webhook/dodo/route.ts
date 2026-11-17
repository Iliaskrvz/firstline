// POST /api/webhook/dodo: Dodo Payments events. The signature (DODO_WEBHOOK_SECRET) is the
// authentication, so this route stays public. Dodo retries failed deliveries (up to 8 attempts), so
// unknown event types are acknowledged too; only real processing failures return 500.
import { NextResponse, type NextRequest } from "next/server";
import { dodoProductIds, handleDodoEvent, verifyDodoWebhook, WebhookVerificationError, type DodoEvent } from "@/billing/dodo";
import { serverPool } from "@/server/db";

export async function POST(request: NextRequest) {
  const secret = process.env.DODO_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "Payments aren't configured." }, { status: 503 });
  const body = await request.text(); // raw body: parsed JSON would break the signature
  const headers = {
    "webhook-id": request.headers.get("webhook-id") ?? "",
    "webhook-timestamp": request.headers.get("webhook-timestamp") ?? "",
    "webhook-signature": request.headers.get("webhook-signature") ?? "",
  };
  let event: DodoEvent;
  try {
    event = verifyDodoWebhook(body, headers, secret);
  } catch (e) {
    if (e instanceof WebhookVerificationError) return NextResponse.json({ error: "Invalid signature." }, { status: 403 });
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }
  try {
    return NextResponse.json({ received: true, ...(await handleDodoEvent(serverPool(), event, dodoProductIds())) }, { status: 202 });
  } catch (e) {
    // 500 makes Dodo retry (database down, say). Crediting is idempotent per payment, so that's safe.
    console.error(`dodo webhook ${event.type} ${headers["webhook-id"]}:`, (e as Error).message);
    return NextResponse.json({ error: "Processing failed; Dodo will retry." }, { status: 500 });
  }
}
