// POST /api/kelviq/webhook: a completed Kelviq checkout → credits (§9). The signature proves it's Kelviq.
import { NextResponse, type NextRequest } from "next/server";
import { handleKelviqEvent, planIdentifiers, verifyKelviqWebhook, type KelviqEvent } from "@/billing/kelviq";
import { serverPool } from "@/server/db";

export async function POST(request: NextRequest) {
  const secret = process.env.KELVIQ_WEBHOOK_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "Payments aren't configured." }, { status: 503 });
  const body = await request.text();
  let event: KelviqEvent;
  try {
    event = verifyKelviqWebhook(body, Object.fromEntries(request.headers.entries()), secret);
  } catch {
    // 400 is not retried by Kelviq: right for forged or stale requests.
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }
  try {
    return NextResponse.json({ received: true, ...(await handleKelviqEvent(serverPool(), event, planIdentifiers())) });
  } catch (e) {
    // 500 makes Kelviq retry (3×, a minute apart); crediting is idempotent, so that's safe.
    console.error(`kelviq webhook ${event.type} ${event.id}:`, (e as Error).message);
    return NextResponse.json({ error: "Processing failed; Kelviq will retry." }, { status: 500 });
  }
}
