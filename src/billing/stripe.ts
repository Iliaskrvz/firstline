// Stripe (§9): Checkout for credit packs, the webhook that turns payments into credits, and auto top-up.
// Takes a Stripe client and a pg Pool, so it runs in the web app, the worker and tests (with a fake client).
import type pg from "pg";
import type Stripe from "stripe";
import { PACKS, euro, isPackId, type PackId } from "@/lib/credits";
import { addPurchase, balance } from "./db";

export type AutoTopUp = {
  enabled: boolean;
  /** Top up when available credits drop below this. */
  threshold: number;
  pack: PackId;
  /** Saved during the first Checkout (setup_future_usage). Needed to charge without the user present. */
  payment_method_id?: string | null;
  last_attempt_at?: string | null;
  last_error?: string | null;
};

export const AUTO_TOPUP_COOLDOWN_MS = 15 * 60_000;

/** The workspace's Stripe customer, created on first purchase. */
export async function ensureCustomer(stripe: Stripe, pool: pg.Pool, ws: { id: string; name: string; email: string | null }): Promise<string> {
  const { rows } = await pool.query("select stripe_customer_id from public.workspaces where id = $1", [ws.id]);
  if (rows[0]?.stripe_customer_id) return rows[0].stripe_customer_id;
  const customer = await stripe.customers.create(
    { email: ws.email ?? undefined, name: ws.name, metadata: { workspace_id: ws.id } },
    { idempotencyKey: `customer:${ws.id}` },
  );
  await pool.query("update public.workspaces set stripe_customer_id = $2 where id = $1 and stripe_customer_id is null", [ws.id, customer.id]);
  const again = await pool.query("select stripe_customer_id from public.workspaces where id = $1", [ws.id]);
  return again.rows[0].stripe_customer_id;
}

/** Checkout for one pack. Prices are excl. VAT; Stripe Tax adds it when STRIPE_TAX is on (§9). */
export async function createCheckout(
  stripe: Stripe,
  pool: pg.Pool,
  input: { workspace: { id: string; name: string; email: string | null }; pack: PackId; origin: string; tax: boolean },
): Promise<string> {
  const pack = PACKS[input.pack];
  const customer = await ensureCustomer(stripe, pool, input.workspace);
  const metadata = { workspace_id: input.workspace.id, pack: input.pack, credits: String(pack.credits) };
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer,
    customer_update: { address: "auto", name: "auto" },
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    automatic_tax: { enabled: input.tax },
    invoice_creation: { enabled: true, invoice_data: { metadata } },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: pack.priceCents,
          tax_behavior: "exclusive",
          product_data: { name: `FirstLine ${pack.name}: ${pack.credits.toLocaleString("en")} credits` },
        },
      },
    ],
    // Saves the card / iDEAL (as SEPA Direct Debit) for auto top-up.
    payment_intent_data: { setup_future_usage: "off_session", metadata },
    metadata,
    success_url: `${input.origin}/credits?paid={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.origin}/credits`,
  });
  if (!session.url) throw new Error("Stripe didn't return a Checkout link.");
  return session.url;
}

function packNote(pack: PackId, how: string, amountCents: number | null): string {
  const p = PACKS[pack];
  return `${p.name} pack: ${p.credits.toLocaleString("en")} credits · ${how}${amountCents != null ? ` · ${euro(amountCents)} paid` : ""}`;
}

async function setAutoTopUp(pool: pg.Pool, workspaceId: string, patch: Partial<AutoTopUp>) {
  await pool.query("update public.workspaces set auto_topup = coalesce(auto_topup, '{}'::jsonb) || $2::jsonb where id = $1", [workspaceId, JSON.stringify(patch)]);
}

export type EventResult = { handled: boolean; added: number };

/**
 * The webhook (§9: "webhook → ledger (idempotent)"). Credits are keyed on the Checkout session or the
 * invoice, never on the event, so Stripe retrying or sending two events for one payment adds them once.
 */
export async function handleStripeEvent(stripe: Stripe, pool: pg.Pool, event: Stripe.Event): Promise<EventResult> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const s = event.data.object;
      // iDEAL/Wero can confirm a bit later: "completed" then arrives unpaid, "async_payment_succeeded" follows.
      if (s.payment_status !== "paid") return { handled: true, added: 0 };
      const ws = s.metadata?.workspace_id;
      const pack = s.metadata?.pack;
      if (!ws || !isPackId(pack)) return { handled: false, added: 0 };
      const added = await addPurchase(pool, { workspaceId: ws, credits: PACKS[pack].credits, key: `checkout:${s.id}`, note: packNote(pack, "Checkout", s.amount_total) });
      // Remember the payment method for auto top-up.
      const piId = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id;
      if (piId) {
        const pi = await stripe.paymentIntents.retrieve(piId);
        const pm = typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id;
        if (pm) await setAutoTopUp(pool, ws, { payment_method_id: pm });
      }
      return { handled: true, added: added ? PACKS[pack].credits : 0 };
    }
    case "invoice.paid": {
      const inv = event.data.object;
      if (inv.metadata?.kind !== "auto_topup") return { handled: true, added: 0 };
      const ws = inv.metadata.workspace_id;
      const pack = inv.metadata.pack;
      if (!ws || !isPackId(pack)) return { handled: false, added: 0 };
      const added = await addPurchase(pool, { workspaceId: ws, credits: PACKS[pack].credits, key: `invoice:${inv.id}`, note: packNote(pack, "auto top-up", inv.amount_paid) });
      await setAutoTopUp(pool, ws, { last_error: null });
      return { handled: true, added: added ? PACKS[pack].credits : 0 };
    }
    case "invoice.payment_failed": {
      const inv = event.data.object;
      if (inv.metadata?.kind !== "auto_topup" || !inv.metadata.workspace_id) return { handled: true, added: 0 };
      await setAutoTopUp(pool, inv.metadata.workspace_id, { last_error: "The last automatic top-up payment failed. Buy a pack once to update your payment method." });
      return { handled: true, added: 0 };
    }
    default:
      return { handled: false, added: 0 };
  }
}

/**
 * Auto top-up (§9): when available credits drop below the threshold, charge the saved payment method
 * for the chosen pack through an invoice (so VAT is right), at most once per 15 minutes per workspace.
 * Credits arrive with the `invoice.paid` webhook.
 */
export async function runAutoTopUps(
  stripe: Stripe,
  pool: pg.Pool,
  opts: { tax: boolean; now?: Date; log?: (m: string) => void } = { tax: false },
): Promise<string[]> {
  const now = opts.now ?? new Date();
  const { rows } = await pool.query(
    `select w.id, w.stripe_customer_id, w.auto_topup from public.workspaces w
      where w.stripe_customer_id is not null and (w.auto_topup->>'enabled')::boolean is true and w.auto_topup->>'payment_method_id' is not null`,
  );
  const charged: string[] = [];
  for (const w of rows) {
    const cfg = w.auto_topup as AutoTopUp;
    if (!isPackId(cfg.pack)) continue;
    if (cfg.last_attempt_at && now.getTime() - new Date(cfg.last_attempt_at).getTime() < AUTO_TOPUP_COOLDOWN_MS) continue;
    if ((await balance(pool, w.id)).available >= cfg.threshold) continue;

    const pack = PACKS[cfg.pack];
    await setAutoTopUp(pool, w.id, { last_attempt_at: now.toISOString() }); // before charging: never twice in a row
    const metadata = { workspace_id: w.id, pack: cfg.pack, credits: String(pack.credits), kind: "auto_topup" };
    try {
      const inv = await stripe.invoices.create({
        customer: w.stripe_customer_id,
        collection_method: "charge_automatically",
        auto_advance: false,
        automatic_tax: { enabled: opts.tax },
        default_payment_method: cfg.payment_method_id!,
        description: `FirstLine auto top-up: ${pack.name} pack`,
        metadata,
      });
      await stripe.invoiceItems.create({
        customer: w.stripe_customer_id,
        invoice: inv.id!,
        amount: pack.priceCents,
        currency: "eur",
        tax_behavior: "exclusive",
        description: `FirstLine ${pack.name}: ${pack.credits.toLocaleString("en")} credits`,
      });
      await stripe.invoices.finalizeInvoice(inv.id!);
      await stripe.invoices.pay(inv.id!, { off_session: true });
      charged.push(w.id);
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300);
      await setAutoTopUp(pool, w.id, { last_error: `Automatic top-up failed: ${msg}` });
      opts.log?.(`auto top-up for workspace ${w.id} failed: ${msg}`);
    }
  }
  return charged;
}
