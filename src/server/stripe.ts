// The Stripe client for the web app (server only).
import "server-only";
import Stripe from "stripe";

let client: Stripe | null = null;

export function stripeConfigured(): boolean {
  return /^sk_(test|live)_/.test(process.env.STRIPE_SECRET_KEY?.trim() ?? "");
}

export function stripeClient(): Stripe {
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY!.trim());
  return client;
}

/** Stripe Tax adds VAT (needs Tax set up in the Stripe dashboard first). */
export function stripeTaxOn(): boolean {
  return process.env.STRIPE_TAX?.trim() === "1";
}
