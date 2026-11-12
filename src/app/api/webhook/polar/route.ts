// POST /api/webhook/polar: Polar events. The signature (POLAR_WEBHOOK_SECRET) is the authentication,
// so this route stays public. Polar retries failed deliveries up to 10 times and disables the
// endpoint after 10 failures in a row, so unknown event types are acknowledged too.
import { NextResponse, type NextRequest } from "next/server";
import { webhooks } from "@polar-sh/sdk/2026-10";
import { handlePolarEvent, verifyPolarWebhook, type PolarEvent } from "@/billing/polar";

export async function POST(request: NextRequest) {
  const secret = process.env.POLAR_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "Payments aren't configured." }, { status: 503 });
  const body = await request.text(); // raw body: parsed JSON would break the signature
  const headers = {
    "webhook-id": request.headers.get("webhook-id") ?? "",
    "webhook-timestamp": request.headers.get("webhook-timestamp") ?? "",
    "webhook-signature": request.headers.get("webhook-signature") ?? "",
  };
  let event: PolarEvent;
  try {
    event = await verifyPolarWebhook(body, headers, secret);
  } catch (e) {
    if (e instanceof webhooks.PolarWebhookVerificationError) return NextResponse.json({ error: "Invalid signature." }, { status: 403 });
    if (e instanceof webhooks.PolarWebhookUnknownTypeError) return NextResponse.json({ received: true, ignored: e.eventType }, { status: 202 });
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }
  try {
    return NextResponse.json({ received: true, ...(await handlePolarEvent(event)) }, { status: 202 });
  } catch (e) {
    // 500 makes Polar retry. Handlers must stay idempotent (dedupe on the webhook-id header / order id).
    console.error(`polar webhook ${event.type} ${headers["webhook-id"]}:`, (e as Error).message);
    return NextResponse.json({ error: "Processing failed; Polar will retry." }, { status: 500 });
  }
}
