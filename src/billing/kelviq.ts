// Kelviq (merchant of record: it sells the packs, charges and remits VAT, sends the invoice).
// Checkout for a pack, and the webhook that turns a completed checkout into credits (§9).
// Framework-agnostic: the checkout client and pg Pool are passed in, so tests use fakes.
import { validateEvent, WebhookVerificationError } from "@kelviq/node-sdk";
import type pg from "pg";
import { PACKS, isPackId, type PackId } from "@/lib/credits";
import { addPurchase } from "./db";

/** The part of the Kelviq SDK we use (client.checkout). */
export type KelviqCheckout = {
  createSession(p: {
    planIdentifier: string;
    chargePeriod: "ONE_TIME";
    successUrl: string;
    customerId?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<{ checkoutUrl: string; checkoutSessionId: string }>;
};

/** One one-time plan per pack in the Kelviq dashboard; identifiers can be overridden with env vars. */
export function planIdentifiers(env: Record<string, string | undefined> = process.env): Record<PackId, string> {
  return {
    starter: env.KELVIQ_PLAN_STARTER?.trim() || "firstline-starter",
    growth: env.KELVIQ_PLAN_GROWTH?.trim() || "firstline-growth",
    agency: env.KELVIQ_PLAN_AGENCY?.trim() || "firstline-agency",
  };
}

export async function createKelviqCheckout(
  checkout: KelviqCheckout,
  input: { workspaceId: string; pack: PackId; origin: string; plans: Record<PackId, string> },
): Promise<string> {
  const { checkoutUrl } = await checkout.createSession({
    planIdentifier: input.plans[input.pack],
    chargePeriod: "ONE_TIME",
    // Kelviq keeps one customer per customerId: the workspace is the paying customer.
    customerId: input.workspaceId,
    successUrl: `${input.origin}/credits?paid=1`,
    // snake_case keys: the SDK converts payload keys to snake_case anyway; returned verbatim on the webhook.
    metadata: { workspace_id: input.workspaceId, pack: input.pack, credits: PACKS[input.pack].credits },
  });
  if (!checkoutUrl) throw new Error("Kelviq didn't return a checkout link.");
  return checkoutUrl;
}

export const WEBHOOK_TOLERANCE_S = 300;

/**
 * Check a webhook really comes from Kelviq: HMAC-SHA256 over "id.timestamp.body" (the SDK's
 * validateEvent), plus a 5-minute window on the timestamp against replays (the SDK doesn't check that).
 */
export function verifyKelviqWebhook(
  rawBody: string,
  headers: Record<string, string | undefined>,
  secret: string,
  now: Date = new Date(),
): KelviqEvent {
  const ts = Number(headers["webhook-timestamp"]);
  if (!Number.isFinite(ts) || Math.abs(now.getTime() / 1000 - ts) > WEBHOOK_TOLERANCE_S) {
    throw new WebhookVerificationError("Webhook timestamp is missing or too old.");
  }
  return validateEvent(rawBody, headers, secret) as unknown as KelviqEvent;
}

export type KelviqEvent = {
  id: string;
  type: string;
  created_at?: string;
  test?: boolean;
  data?: { object?: Record<string, unknown> };
};

export type EventResult = { handled: boolean; added: number; reason?: string };

/**
 * checkout.completed → credits, once per checkout session (keyed on the session id, so Kelviq's
 * retries and repeated deliveries add nothing).
 */
export async function handleKelviqEvent(pool: pg.Pool, event: KelviqEvent, plans: Record<PackId, string>): Promise<EventResult> {
  if (event.type !== "checkout.completed") return { handled: false, added: 0, reason: "ignored event type" };
  const o = event.data?.object ?? {};
  const meta = (o.metadata ?? {}) as Record<string, unknown>;
  const sessionId = typeof o.id === "string" ? o.id : null;
  if (!sessionId) return { handled: false, added: 0, reason: "no checkout session id" };
  if (o.status && o.status !== "success") return { handled: true, added: 0, reason: `status ${String(o.status)}` };

  const workspaceId = typeof meta.workspace_id === "string" ? meta.workspace_id : null;
  const planId = (o.plan as { identifier?: string } | undefined)?.identifier;
  const pack: PackId | null = isPackId(meta.pack) ? meta.pack : ((Object.entries(plans).find(([, id]) => id === planId)?.[0] as PackId | undefined) ?? null);
  if (!workspaceId || !pack) return { handled: false, added: 0, reason: "not a FirstLine credit pack" };

  const p = PACKS[pack];
  const paid = typeof o.amount === "string" && typeof o.currency === "string" ? ` · ${o.amount} ${String(o.currency).toUpperCase()} paid` : "";
  const added = await addPurchase(pool, {
    workspaceId,
    credits: p.credits,
    key: `kelviq:${sessionId}`,
    note: `${p.name} pack: ${p.credits.toLocaleString("en")} credits · Kelviq${paid}${event.test ? " (test)" : ""}`,
  });
  return { handled: true, added: added ? p.credits : 0 };
}
