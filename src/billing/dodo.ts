// Dodo Payments (merchant of record: it sells the packs, charges and remits VAT, sends the invoice).
// Hosted checkout for a credit pack, and signed webhooks that turn a successful payment into credits (§9).
// Framework-agnostic: the checkout client and pg Pool are passed in, so tests and fake mode need no
// Dodo account. API facts checked against docs.dodopayments.com and the dodopayments SDK types on 2026-11-17.
import type pg from "pg";
import { Webhook, WebhookVerificationError } from "standardwebhooks";
import { PACKS, isPackId, type PackId } from "@/lib/credits";
import { logActivity } from "@/teams/db";
import { addPurchase } from "./db";

export { WebhookVerificationError };

/** Test or live: Dodo keys say so themselves (dodo_test_… / dodo_live_…), and each only works on its own host. */
export function dodoEnvironment(apiKey: string | undefined): "test_mode" | "live_mode" {
  return apiKey?.trim().startsWith("dodo_live_") ? "live_mode" : "test_mode";
}

/** The part of the SDK we use: client.checkoutSessions.create (POST /checkouts). Field names are the API's. */
export type DodoCheckoutBody = {
  product_cart: { product_id: string; quantity: number }[];
  customer?: { email: string; name?: string };
  return_url?: string;
  metadata?: Record<string, string | number | boolean>;
};
export type DodoCheckouts = { create(body: DodoCheckoutBody): Promise<{ session_id: string; checkout_url?: string | null }> };

/** Dodo product id per pack: DODO_PRODUCT_<ID> (e.g. DODO_PRODUCT_GROWTH, DODO_PRODUCT_LITE_50K). */
export const dodoProductEnvName = (pack: string) => `DODO_PRODUCT_${pack.toUpperCase().replace(/-/g, "_")}`;

export function dodoProductIds(env: Record<string, string | undefined> = process.env): Partial<Record<PackId, string>> {
  const out: Partial<Record<PackId, string>> = {};
  for (const id of Object.keys(PACKS)) {
    const v = env[dodoProductEnvName(id)]?.trim();
    if (v) out[id] = v;
  }
  return out;
}

export function packForProduct(products: Partial<Record<PackId, string>>, productId: unknown): PackId | null {
  if (typeof productId !== "string") return null;
  return (Object.entries(products).find(([, id]) => id === productId)?.[0] as PackId | undefined) ?? null;
}

const PRODUCT_ID = /^[A-Za-z0-9_-]{4,64}$/;

/** ?products=<id>[,<id>…] for /checkout links: Dodo product ids, at most 10. */
export function parseProductIds(values: string[]): string[] | null {
  const ids = values.flatMap((v) => v.split(",")).map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0 || ids.length > 10 || !ids.every((id) => PRODUCT_ID.test(id))) return null;
  return [...new Set(ids)];
}

async function start(checkouts: DodoCheckouts, body: DodoCheckoutBody): Promise<string> {
  const { checkout_url } = await checkouts.create(body);
  if (!checkout_url) throw new Error("Dodo didn't return a checkout link.");
  return checkout_url;
}

/** Checkout for a credit pack from the Credits page: the pack's product, our ids in metadata for the webhook. */
export async function createPackCheckout(
  checkouts: DodoCheckouts,
  input: { workspaceId: string; pack: PackId; origin: string; products: Partial<Record<PackId, string>>; email?: string | null },
): Promise<string> {
  const productId = input.products[input.pack];
  if (!productId) throw new Error(`No Dodo product for the ${PACKS[input.pack].name} pack yet (${dodoProductEnvName(input.pack)}).`);
  return start(checkouts, {
    product_cart: [{ product_id: productId, quantity: 1 }],
    ...(input.email ? { customer: { email: input.email } } : {}),
    // Dodo adds ?payment_id=…&status=… to this address.
    return_url: `${input.origin}/credits?paid=1`,
    metadata: { workspace_id: input.workspaceId, pack: input.pack, credits: PACKS[input.pack].credits },
  });
}

/** Checkout for /checkout?products=… links: the current workspace pays; the webhook finds the pack by product. */
export async function createLinkCheckout(
  checkouts: DodoCheckouts,
  input: { products: string[]; workspaceId: string; origin: string; email?: string | null },
): Promise<string> {
  return start(checkouts, {
    product_cart: input.products.map((product_id) => ({ product_id, quantity: 1 })),
    ...(input.email ? { customer: { email: input.email } } : {}),
    return_url: `${input.origin}/credits?paid=1`,
    metadata: { workspace_id: input.workspaceId },
  });
}

/**
 * Fake mode (no DODO_API_KEY outside production, or DODO_API_KEY=fake-dodo): no network, the
 * "checkout" is a page on this app that says so. Same shape as the real response.
 */
export function fakeDodoCheckouts(origin: string): DodoCheckouts & { calls: DodoCheckoutBody[] } {
  const calls: DodoCheckoutBody[] = [];
  return {
    calls,
    async create(body) {
      calls.push(body);
      const id = `cks_fake_${calls.length}`;
      return { session_id: id, checkout_url: `${origin}/credits?fake_checkout=${id}` };
    },
  };
}

export type DodoEvent = { business_id?: string; type: string; timestamp?: string; data: Record<string, unknown> };

/**
 * Check a webhook really comes from Dodo (Standard Webhooks: HMAC-SHA256 over "id.timestamp.body",
 * timestamp within 5 minutes; secret "whsec_…"). Throws WebhookVerificationError on a bad signature.
 */
export function verifyDodoWebhook(rawBody: string, headers: Record<string, string>, secret: string): DodoEvent {
  const event = new Webhook(secret).verify(rawBody, headers) as DodoEvent;
  if (!event || typeof event.type !== "string" || typeof event.data !== "object" || event.data === null) {
    throw new WebhookVerificationError("Unexpected payload");
  }
  return event;
}

export type DodoEventResult = { type: string; handled: boolean; added: number; note: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Amounts are in the currency's smallest unit (cents for EUR). */
const money = (minor: unknown, currency: unknown) =>
  typeof minor === "number" && typeof currency === "string" ? `${(minor / 100).toFixed(2)} ${currency.toUpperCase()}` : null;

type PaymentLike = {
  payment_id?: unknown;
  status?: unknown;
  total_amount?: unknown;
  currency?: unknown;
  metadata?: Record<string, unknown> | null;
  product_cart?: { product_id?: unknown; quantity?: unknown }[] | null;
};

type RefundLike = { refund_id?: unknown; payment_id?: unknown; amount?: unknown; currency?: unknown; is_partial?: unknown; status?: unknown };

const ledgerKey = (paymentId: string) => `dodo:${paymentId}`;

/**
 * What to do with each verified event.
 * - payment.succeeded: the pack's credits, once per payment (ledger key `dodo:<payment id>`), so Dodo's
 *   retries and repeated deliveries add nothing. Payments that aren't a FirstLine pack are acknowledged.
 * - refund.succeeded: logged for the workspace that bought it and shown on /admin. Credits are not
 *   taken back automatically.
 * Never throws for data we can't use: Dodo retries failed deliveries, and a stuck event helps no one.
 */
export async function handleDodoEvent(pool: pg.Pool, event: DodoEvent, products: Partial<Record<PackId, string>>): Promise<DodoEventResult> {
  const base = { type: event.type, handled: false, added: 0 };
  if (event.type === "payment.succeeded") {
    const p = event.data as PaymentLike;
    const paymentId = typeof p.payment_id === "string" ? p.payment_id : null;
    if (!paymentId) return { ...base, note: "no payment id" };
    if (typeof p.status === "string" && p.status !== "succeeded") return { ...base, note: `payment not succeeded (${p.status})` };
    const meta = p.metadata ?? {};
    const cart = Array.isArray(p.product_cart) ? p.product_cart : [];
    const pack: PackId | null = isPackId(meta.pack) ? meta.pack : packForProduct(products, cart[0]?.product_id);
    if (!pack) return { ...base, note: "not a FirstLine credit pack" };
    const candidate = typeof meta.workspace_id === "string" && UUID_RE.test(meta.workspace_id) ? meta.workspace_id : null;
    const workspaceId = candidate ? ((await pool.query("select id from public.workspaces where id = $1", [candidate])).rows[0]?.id ?? null) : null;
    if (!workspaceId) {
      console.error(`dodo payment ${paymentId}: pack ${pack} paid, but no known workspace on it`);
      return { ...base, note: "no known workspace on this payment" };
    }
    const pk = PACKS[pack];
    const quantity = typeof cart[0]?.quantity === "number" && cart[0].quantity > 1 ? Math.floor(cart[0].quantity) : 1;
    const credits = pk.credits * quantity;
    const paid = money(p.total_amount, p.currency);
    const added = await addPurchase(pool, {
      workspaceId,
      credits,
      key: ledgerKey(paymentId),
      kind: pk.kind,
      note: `${pk.name} pack (${pk.id})${quantity > 1 ? ` × ${quantity}` : ""}: ${credits.toLocaleString("en")} ${pk.kind === "lite" ? "Lite " : ""}credits · Dodo${paid ? ` · ${paid} paid` : ""}`,
    });
    if (added) {
      await logActivity(pool, { workspaceId, userId: null, actor: "Payment (Dodo)", action: "credits.bought", target: `${pk.name} pack`, details: { credits, kind: pk.kind, order: paymentId } });
    }
    return { ...base, handled: true, added: added ? credits : 0, note: added ? `${credits} credits added` : "already credited" };
  }
  if (event.type === "refund.succeeded") {
    const r = event.data as RefundLike;
    const paymentId = typeof r.payment_id === "string" ? r.payment_id : null;
    if (!paymentId) return { ...base, note: "no payment id on the refund" };
    // The purchase we booked for that payment says which workspace and pack it was.
    const { rows } = await pool.query<{ workspace_id: string; amount: number; note: string | null }>(
      "select workspace_id, amount, note from public.credit_ledger where stripe_event_id = $1 and type = 'purchase' limit 1",
      [ledgerKey(paymentId)],
    );
    if (!rows[0]) return { ...base, note: "refund for a payment that isn't a FirstLine pack" };
    const pack = rows[0].note?.match(/\(([a-z0-9-]+)\)/)?.[1];
    const packName = pack && isPackId(pack) ? `${PACKS[pack].name} pack` : "Credit pack";
    await logActivity(pool, {
      workspaceId: rows[0].workspace_id,
      userId: null,
      actor: "Payment (Dodo)",
      action: "payment.refunded",
      target: packName,
      details: { order: paymentId, refund: r.refund_id ?? null, pack: pack ?? null, refunded: money(r.amount, r.currency), partial: r.is_partial === true, credits: rows[0].amount },
    });
    return { ...base, handled: true, note: "refund logged; credits not taken back automatically" };
  }
  return { ...base, note: "ignored event type" };
}
