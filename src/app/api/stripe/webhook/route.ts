// POST /api/stripe/webhook: Stripe → credits (§9). The signature proves the event is Stripe's.
import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { handleStripeEvent } from "@/billing/stripe";
import { serverPool } from "@/server/db";
import { stripeClient, stripeConfigured } from "@/server/stripe";

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!stripeConfigured() || !secret) return NextResponse.json({ error: "Stripe isn't configured." }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature." }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripeClient().webhooks.constructEvent(await request.text(), signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }
  try {
    const res = await handleStripeEvent(stripeClient(), serverPool(), event);
    return NextResponse.json({ received: true, ...res });
  } catch (e) {
    // 500 makes Stripe retry later; crediting is idempotent, so a retry is safe.
    console.error(`stripe webhook ${event.type} ${event.id}:`, (e as Error).message);
    return NextResponse.json({ error: "Processing failed; Stripe will retry." }, { status: 500 });
  }
}
