# Dodo Payments setup

Dodo Payments is FirstLine's merchant of record (since 2026-11-17, replacing Polar). It sells the credit
packs, charges the customer, handles VAT (including EU reverse charge for business buyers with a VAT
number) and sends the invoice. FirstLine never sees card or bank details.

Test mode and live mode are separate: a `dodo_test_…` key talks to test mode, a `dodo_live_…` key to live
mode. Products and webhooks are created per mode. Start in test mode.

## How a purchase works

1. On the Credits page an owner or admin clicks a pack. FirstLine creates a Dodo checkout session with:
   - the pack's Dodo product (`DODO_PRODUCT_GROWTH`)
   - the buyer's email
   - metadata `workspace_id`, `pack`, `credits`
   - return address `/credits?paid=1` (Dodo adds `payment_id` and `status`)
2. The customer pays on Dodo's hosted checkout.
3. Dodo sends `payment.succeeded` to `/api/webhook/dodo`. The signature is checked (Standard Webhooks; a bad
   one gets 403), then the pack's credits are added once per payment (ledger key `dodo:<payment id>`).
   - Payments for other products, unknown workspaces and failed payments are acknowledged (202) and ignored.
   - A database error returns 500, so Dodo retries. Crediting is idempotent, so a retry never adds twice.
4. The Credits page shows "Payment received" as soon as the credits are in.
5. `refund.succeeded` is logged for the workspace and listed on /admin. Credits are **not** taken back
   automatically; remove unused credits by hand.

Fake mode: with `DODO_API_KEY=fake-dodo`, or no key outside production, no network calls are made and every
pack has a stand-in product. The "checkout" is a page on this app.

## Files

- `src/billing/dodo.ts`: checkout bodies, pack ↔ product mapping (`DODO_PRODUCT_<PACK>`), webhook
  verification, `handleDodoEvent` (crediting, refunds)
- `src/server/dodo.ts`: the SDK client (`dodopayments`), fake mode, products per pack
- `src/app/(app)/credits/actions.ts`: `buyPack`
- `src/app/checkout/route.ts`: `GET /checkout?products=<id>` for links outside the app
- `src/app/api/webhook/dodo/route.ts`: `POST /api/webhook/dodo`
- `scripts/dodo-setup.ts`: provisioning (below)
- Tests (no Dodo account needed): `src/billing/dodo.test.ts`, `src/app/api/webhook/dodo/route.test.ts`,
  and "Dodo Payments" in `supabase/tests/billing-pg.test.ts` (exactly-once crediting on a real Postgres).

## Settings (in `.env.local`; the deploy copies it to the server)

| Name | What |
| --- | --- |
| `DODO_API_KEY` | Dodo → Developer → API Keys. Save with `bash scripts/set-env.sh DODO_API_KEY` (hidden input). |
| `DODO_WEBHOOK_SECRET` | `whsec_…` of the webhook endpoint. The setup script saves it. |
| `DODO_PRODUCT_STARTER`, `_GROWTH`, `_AGENCY` | Product ids. The setup script saves them. |

## Provisioning

Run inside `~/code/firstline`, each command on a fresh line:

```bash
bash scripts/set-env.sh DODO_API_KEY
```

```bash
npx tsx scripts/dodo-setup.ts https://firstline.46-17-99-33.sslip.io
```

This checks the key, creates one product per pack (EUR, excl. VAT, tax category SaaS) and the webhook
endpoint, and saves the ids and the signing secret in `.env.local` without printing the secret. Then deploy.

## Check before going live

1. In **test mode**: buy the Starter pack with a Dodo test card. Check that:
   - the checkout shows €19 **plus** VAT for a Dutch buyer without a VAT number (prices on the site are
     excl. VAT), and no VAT when you enter a valid EU VAT number of another country;
   - the Credits page shows "Payment received" and 500 credits arrive;
   - /admin shows the purchase; a refund in Dodo shows under "Refunds in Dodo Payments".
2. Finish Dodo's verification (identity, bank, and business if you have a company). Live payments only
   work after every form is approved; Dodo says this usually takes 1–3 business days.
3. Create a **live** key, save it as `DODO_API_KEY`, and run the setup script again: it creates the live
   products and webhook and replaces the test ids.
4. Deploy.
