# Polar setup

Polar (polar.sh) replaces Kelviq as merchant of record: it sells, charges, handles VAT and sends invoices. It's built on `@polar-sh/sdk` 1.1 (API version `2026-10`). There's no framework adapter. Organization: `first-line`.

**This runs against the live production environment.** Real cards are charged. To test without paying, use the single-use 100% code from `scripts/polar-setup.ts`.

## Status

| Step | State |
|---|---|
| SDK, client, `/checkout`, `/api/webhook/polar` | Built and tested with a fake client and signed test payloads |
| Access token | **You:** create it and save it in `.env.local` |
| Test product, webhook endpoint, test discount | **You:** run `scripts/polar-setup.ts` once the token is saved |
| Paid orders → credits | **Not built yet.** The webhook verifies events and acknowledges them, but credits nothing (TODO stubs). See "Proposed mapping" below. |
| Kelviq | Still in the code and on the Credits page until the mapping is approved; then it gets removed |

## Files

New:
- `src/billing/polar.ts`: environment from `POLAR_SERVER`, product-id parsing, checkout creation, fake checkout client, webhook verification, and event handler stubs.
- `src/billing/polar.test.ts`: 6 tests. They cover checkout calls, signature checks (wrong secret, changed body, old timestamp) and unknown event types.
- `src/server/polar.ts`: one SDK client per process (`createPolar`). Fake mode applies when `POLAR_ACCESS_TOKEN=fake-polar`, or when there's no token outside production.
- `src/app/checkout/route.ts`: `GET /checkout?products=<id>` redirects to Polar's hosted checkout. A signed-in user is passed as `external_customer_id`. No success URL is set: Polar shows its own confirmation.
- `src/app/api/webhook/polar/route.ts`: `POST /api/webhook/polar`. Response codes:
  - 403: bad signature
  - 202: handled, or an unknown event type (so Polar stops retrying)
  - 500: a handler error, so Polar retries
- `scripts/polar-setup.ts`: the one-time provisioning script (below).

Changed:
- `src/proxy.ts`: the session middleware skips `/api/webhook/*`.
- `scripts/secret-scan.sh`: now also catches Polar tokens and secrets (`polar_oat_…`, `polar_whs_…` and similar).
- `.env.example`, `package.json`.

## Env keys (in `.env.local`; the deploy copies it to the server)

- `POLAR_ACCESS_TOKEN`: organization access token, production.
- `POLAR_WEBHOOK_SECRET`: written by `scripts/polar-setup.ts`.
- `POLAR_SERVER`: `production` (or `sandbox`).

## Provisioning

```bash
npx tsx scripts/polar-setup.ts https://firstline.46-17-99-33.sslip.io
```

The script:
1. Checks the token (prints nothing secret).
2. Creates "Test Product" (one-time, $10) if no active product exists.
3. Creates the webhook endpoint `https://firstline.46-17-99-33.sslip.io/api/webhook/polar` for these events: `order.created`, `order.paid`, `order.updated`, `order.refunded` and `customer.state_changed`. It saves the signing secret to `.env.local` without printing it.
4. Makes a single-use 100%-off code for the test product.
5. Prints the product id, endpoint id, discount code and checkout links.

It's safe to run again: it reuses what already exists.

Record the ids it prints here:
- Test product id: `…`
- Webhook endpoint id: `…`

## Customer portal

Polar hosts the customer portal and emails customers the link, so no app code is needed. An in-app "Manage billing" link can come later.

## Proposed mapping: paid order → credits (needs your OK)

This is the same model as Kelviq today: a workspace buys a credit pack once, and credits land in the ledger exactly once.

1. **One Polar product per pack.** Each pack in `src/config/packs.ts` that's on sale gets a one-time Polar product at that pack's price, for example "FirstLine Starter". The mapping is pack id → Polar product id, stored in env as `POLAR_PRODUCT_<PACK>`, following the old `KELVIQ_PLAN_<PACK>` pattern. The script can create these products once you've decided the prices.
2. **Checkout from the Credits page.** The `buyPack` action calls `polar.checkouts.create` with:
   - `products: [productId]`
   - `external_customer_id: <workspace id>`, so the workspace is the paying customer, as with Kelviq
   - `metadata: { workspace_id, pack, credits }`
   - `success_url: <app>/credits?paid=1`

   The bare `/checkout` route stays available for links.
3. **`order.paid` → `addPurchase`** with these rules:
   - The ledger key is `polar:<order id>`, so retries and both `order.created` and `order.paid` events add credits only once.
   - The workspace comes from `metadata.workspace_id`, falling back to `customer.external_id`.
   - The pack comes from `metadata.pack`, falling back to `product_id`.
   - Then an activity log entry, "Payment (Polar)".
   - Unknown products are acknowledged and ignored.
4. **`order.refunded`:** log it and alert you on /admin. Credits are not taken back automatically; same as Kelviq today.
5. **Kelviq is removed:** the SDK, routes, env keys and docs.
6. Embedded-Postgres tests cover exactly-once crediting, retries, unknown products and refunds, the same way as the Kelviq tests.

## Check before going live

- [ ] Token created in **production** with read+write on products, checkouts, webhooks and discounts
- [ ] `scripts/polar-setup.ts` ran clean; ids recorded above
- [ ] Deployed (`SSH_KEY=~/.ssh/sbd_hostkey bash deploy/deploy.sh`), so the server has the new routes and `.env.local`
- [ ] Polar dashboard → Webhooks: a delivery to `/api/webhook/polar` shows 202
- [ ] A checkout with the 100% code completes, and an `order.paid` delivery arrives
- [ ] Mapping above approved and built, then a real pack purchase gives credits once
- [ ] Polar organization fully set up for payouts (identity, bank details); Polar won't take live payments before that
