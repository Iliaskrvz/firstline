# Polar setup

Polar (polar.sh) is FirstLine's merchant of record: it sells the credit packs, charges, handles VAT and sends invoices. It's built on `@polar-sh/sdk` 1.1 (API version `2026-10`) with no framework adapter. Kelviq was removed on 2026-11-12. Organization: `first-line`.

**This runs against the live production environment.** Real cards are charged. To test without paying, use the single-use 100% code from `scripts/polar-setup.ts`.

## How a purchase works

1. Credits page → "Buy Growth" (workspace owners and admins only). The checkout is created with:
   - the pack's Polar product (`POLAR_PRODUCT_GROWTH`)
   - the workspace id as `external_customer_id`
   - metadata `{ workspace_id, pack, credits }`
   - success URL `/credits?paid=1`
2. The customer pays on Polar's hosted checkout.
3. Polar sends `order.paid` to `/api/webhook/polar`. The signature is checked (a bad one gets 403), then the pack's credits go into the ledger **once per order**. The ledger key is `polar:<order id>`, so retries and repeated deliveries add nothing. The workspace activity log shows "Payment (Polar) · credits.bought".
   - If the metadata is missing, the workspace comes from `customer.external_id` and the pack from `product_id`.
   - Orders for other products, unknown workspaces and unpaid orders are acknowledged (202) and ignored. They never cause errors that would make Polar disable the endpoint.
4. `order.refunded` is logged for the workspace and listed on /admin. Credits are **not** taken back automatically; you decide.

`/checkout?products=<id>` still exists for links outside the app. It requires sign-in as a workspace owner or admin, and that workspace is the customer.

Fake mode: with `POLAR_ACCESS_TOKEN=fake-polar`, or no token outside production, no network calls are made and every pack has a stand-in product.

## Files

- `src/billing/polar.ts` has:
  - the environment setting
  - pack ↔ product mapping (`POLAR_PRODUCT_<PACK>`)
  - pack checkout and generic checkout
  - the fake checkout client
  - webhook verification
  - `handlePolarEvent` (crediting, refunds)
- `src/server/polar.ts`: the SDK client (`createPolar`), fake mode, products per pack
- `src/app/(app)/credits/actions.ts`: `buyPack` uses Polar
- `src/app/checkout/route.ts`: `GET /checkout?products=<id>`
- `src/app/api/webhook/polar/route.ts`: `POST /api/webhook/polar`
- `src/billing/admin-db.ts`: `loadRefunds`, shown on /admin
- `scripts/polar-setup.ts`: provisioning (below)
- Tests:
  - `src/billing/polar.test.ts`
  - `src/app/api/webhook/polar/route.test.ts`
  - `supabase/tests/billing-pg.test.ts` → "Polar", on a real Postgres: exactly-once crediting, fallbacks, ignored orders, refunds
- Removed: `@kelviq/node-sdk`, `src/billing/kelviq.ts`, `src/server/kelviq.ts`, `/api/kelviq/webhook`, and the KELVIQ_* settings from `.env.example`

## Env keys (in `.env.local`; the deploy copies it to the server)

- `POLAR_ACCESS_TOKEN`: organization access token, production.
- `POLAR_WEBHOOK_SECRET`: written by the script.
- `POLAR_SERVER`: `production` (or `sandbox`).
- `POLAR_PRODUCT_STARTER`, `POLAR_PRODUCT_GROWTH`, `POLAR_PRODUCT_AGENCY` (one per pack on sale): written by `--packs`.
- The old `KELVIQ_*` lines in `.env.local` are no longer read and can be deleted.

## Provisioning

```bash
npx tsx scripts/polar-setup.ts https://firstline.46-17-99-33.sslip.io --packs
```

The script:
1. Checks the token.
2. Creates a private "Test Product" ($10).
3. With `--packs`, creates one product per pack on sale. Prices come from `src/config/packs.ts` in EUR, excl. VAT: Starter €19, Growth €69, Agency €299.
4. Registers the webhook (order.created, order.paid, order.updated, order.refunded, customer.state_changed) and saves its secret without printing it.
5. Makes a single-use 100%-off code for the Starter pack.

It's safe to run again: it reuses existing products (matched by `metadata.pack`) and the existing endpoint. If you change pack prices later, change them in Polar too (or archive the product and run the script again).

Done on 2026-11-12 (organization default currency switched to EUR first):
- Starter `f9ccd69b-02ae-4e28-abff-0e35058ded12` (€19), Growth `ec3e2405-7298-4365-901a-77d29dadd001` (€69), Agency `2d0cd553-82d9-4122-8540-39ac429b1d8c` (€299), all excl. VAT
- Test Product `cabfc829-c0b5-4b51-8775-5d78849c7494` (private, $10 / €10)
- Webhook endpoint `047331f5-2add-493c-8a54-08a1e6eea7d6` → `https://firstline.46-17-99-33.sslip.io/api/webhook/polar`

## Customer portal

Polar hosts it and emails customers the link (receipts, invoices). No app code is needed.

## Check before going live

- [x] Token created in **production** with read+write on products, checkouts, webhooks and discounts
- [ ] Polar account fully set up for payouts (identity, bank details)
- [x] `scripts/polar-setup.ts … --packs` ran clean; ids recorded above
- [x] Deployed: the live webhook route answers (unsigned → 403) and /checkout sends signed-out visitors to sign in
- [ ] Credits page → Buy Starter → enter the 100% code → paid. Then the Credits page shows +500, and Polar → Webhooks shows the delivery with 202
- [ ] Legal: the sub-processor list, privacy and terms now name Polar (Polar Software, Inc., US). Have the lawyer confirm the entity and the data-transfer basis.
