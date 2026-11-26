# Paid email verification: design (not built)

Written 2026-11-26, after Part A (free email checks) and Part B (lead qualification). Design only: nothing here is built.

**Owner's decision (2026-11-26): plan approved.** Provider: Bouncer. Customer price: 1 credit per 2 verified addresses
(rounded up per run; unknown results and re-checks within 30 days free). **Don't buy anything yet;** when we build, start with
the smallest pack (1,000 checks, $8). Building waits for the lawyer items (`docs/legal-drafts/bouncer.md`) and the Bouncer
account (see "Before building").
Provider facts were read on 2026-11-26 from the providers' own pages where those pages could be read (sources at the end).
Anything marked *(unconfirmed)* comes from third-party reviews or couldn't be read, and needs a second look before building.

## What we have today (Part A, free)

`src/lib/email-check*.ts` checks every address for free, from our own servers, without contacting any mailbox:

- format, throwaway domains, role and personal addresses, and typo suggestions;
- the domain's mail servers via DNS, cached for 7 days per domain (1 hour when DNS gives no answer);
- the result per lead (`email_status`: valid / risky / invalid), with invalid leads skipped for free.

What it can't tell: whether **this mailbox** exists. `jan@acme.nl` passes when `acme.nl` has mail servers, even if Jan left
last year. Only an SMTP conversation with the mail server can tell, and the hard rule stays: **our servers never open SMTP
connections or "ping" mailboxes** (two guard tests in `src/lib/email-check.test.ts`). A paid provider does that part, on its
own infrastructure, as our sub-processor.

## Providers compared

Prices are pay-as-you-go, in USD, one credit per check.

| | **Bouncer** (recommended) | **ZeroBounce** | **Emailable** | **NeverBounce** |
|---|---|---|---|---|
| Seat / processing | EU. "Your data are stored only in EU AWS data centres"; addresses are hashed except in the results layer | US company. The EU endpoint `api-eu.zerobounce.net` is "processed and stored on our servers in Frankfurt"; other endpoints may use the US | US (Emailable LLC, NY). Processing location not stated | US *(unconfirmed: privacy and DPA pages refused the fetch)* |
| DPA | Yes, published (`/dpa/`) | Yes, an EU DPA is provided at sign-up; also EU-US Data Privacy Framework | Yes, accepted with the terms; transfers under the EU-US DPF | Said to exist, with SCCs *(unconfirmed)* |
| Retention at the provider | Deleted after 60 days, or on demand | Deleted 30 days after upload | Erased within 90 days of the terms ending | *(unconfirmed)* |
| Price, 1,000 | $8 ($0.008) | minimum buy is 2,000 for $39 ($0.0195) | minimum buy is 5,000 for $38 ($0.0076) | ≈ $8 ($0.008) *(unconfirmed)* |
| Price, 10,000 | $60 ($0.006) | not shown in the page text | not shown in the page text | *(unconfirmed)* |
| Price, 100,000 | $400 ($0.004) | not shown in the page text | not shown in the page text | $299–$400 in reviews *(unconfirmed, sources disagree)* |
| Credits expire | Never | "Never" on one part of the page, "expiration rules may apply" in the FAQ | Never | Reviews say after 12 months *(unconfirmed)* |
| "Unknown" charged | No ("never charge … for 'unknown' results") | No ("never charge you for 'unknown' results") | Refunded for lists; single API calls not stated | Reviews say yes, also for accept-all *(unconfirmed)* |
| Accuracy claim | No figure ("best on the market accuracy") | "99.6% Validation Accuracy Guaranteed" (no method given) | No figure found; SOC 2 Type II badge | None on the developer pages read |
| Catch-all | `domain.acceptAll`: yes / no / unknown, next to status deliverable / risky / undeliverable / unknown | A catch-all status *(unconfirmed: API docs didn't load)*; optional AI scoring at 1 extra credit per address | `accept_all` check is off by default and "heavily impacts" response time; states deliverable / risky / undeliverable / unknown | Result code `catchall` ("Accept-all (Unverifiable)"), flag `accepts_all` |
| Real-time API | `GET api.usebouncer.com/v1.1/email/verify`, header `x-api-key`; timeout 10 s by default, 30 s max | v2 validate, EU endpoint *(limits unconfirmed: docs didn't load)* | `/v1/verify`; timeout 2–10 s (default 5) | `GET api.neverbounce.com/v4.2/single/check`; optional `timeout`, no default stated |
| Rate limit | 1,000 requests a minute by default, more on request | "Premium API rate limits" with the subscription; numbers not stated | 25 a second for `/v1/verify` | Not stated |

**Kickbox** was on the list but its pages refused every fetch, so it isn't in the table. Reviews give prices that
contradict each other. If we want it in the running, read kickbox.com/pricing and its docs by hand first.

### Recommendation: Bouncer

- **EU hosting** (EU AWS data centres) and a published DPA. This is the easiest story for our EU customers and our own privacy
  policy, and it matches how we already chose EU-friendly tools.
- **Fair billing:** unknown results and duplicates are free, and credits never expire. We never pay for a check we can't charge for.
- **Cheapest of the confirmed prices** at our early volume: $0.006 a check on the 10,000 pack, $0.004 on the 100,000 pack.
- **Plain real-time API:** one GET with a timeout, a 1,000-a-minute limit, and catch-all reported separately (`domain.acceptAll`).
  That makes it simple to map onto our existing statuses.
- It says real-time calls give "5% more 'unknown' results" than its batch API. We start with real-time (simpler, and unknowns
  are free); batch can come later if the unknown rate matters.

**Runner-up: ZeroBounce through its EU endpoint.** Frankfurt processing and a 30-day deletion are good. Against it: a $39
minimum, unclear credit expiry, rate limits we couldn't read, and US processing unless we pin the EU host.

## Price for the customer (our cost × 3)

- Our cost: buy the 10,000 pack ($60) at the start, so **$0.006 a check ≈ €0.0055** (at USD_EUR_RATE 0.92). Later, the
  100,000 pack ($400) gives $0.004 ≈ €0.0037.
- × 3: **≈ €0.017 a check** (€0.011 on the bigger pack).
- One credit sells for €0.030 (Agency) to €0.038 (Starter). One credit per check would be 5–7× our cost, above the rule.
- **Proposal: 1 credit per 2 verified addresses**, rounded up per run. That is €0.015–€0.019 a check, ≈ ×2.7–×3.5 on the
  10,000 pack and more on the 100,000 pack. "Unknown" results are free for the customer, because we don't pay for them either.
- Re-checking an address within 30 days comes from our cache. That costs us nothing, so it's free for the customer.
- *Decided 2026-11-26:* 1 credit per 2, starting on the smallest pack (1,000 checks, $8 = $0.008 ≈ €0.0074 a check). At that
  pack the margin is lower than the rule: €0.015–€0.019 a check is ×2.0–×2.6. It reaches ×3 from the 5,000 pack ($35) up, so
  move to a bigger pack once usage is known. Revisit 1 per 3 only at the 100,000 pack. Pack prices stay as they are.

## Design

### Where it runs

```
import → free checks (Part A) → [paid verification, opt-in] → research → qualify (Part B) → write
```

- **Opt-in per campaign** (`campaigns.verify_mailboxes boolean default false`). It's switched on in the email-check card on
  the campaign page, which shows "Verify mailboxes: about N credits for M addresses (unknown results free)".
- **Only addresses that passed the free checks:** `email_status` valid or risky, and not excluded by the customer. Invalid
  addresses are never sent to the provider. The customer can limit it to **risky only** (the cheaper option: role, personal,
  catch-all-prone domains).
- **Before writing:** a lead waits for its verification, like it waits for its DNS check today. An address found invalid is
  skipped before any research or writing credits are spent.

### Adapter

`src/lib/email-verify/` (outside `src/engine/`, no pg-boss imports anywhere):

```ts
export type VerifyStatus = "valid" | "invalid" | "catch_all" | "risky" | "unknown";

export type VerifyResult = {
  status: VerifyStatus;
  /** The provider's reason, mapped to ours: "mailbox_not_found", "domain_rejects", "low_deliverability", "timeout", … */
  reason: string | null;
  /** False for unknown: the provider doesn't charge us, so we don't charge the customer. */
  billable: boolean;
};

export interface EmailVerifier {
  readonly name: "bouncer" | "fake";
  /** Our real cost per billable check, in USD (config, matching the pack we bought). */
  readonly costPerCheckUsd: number;
  verify(email: string, opts: { timeoutS: number; signal?: AbortSignal }): Promise<VerifyResult>;
}
```

- **`BouncerVerifier`:** HTTPS only to `api.usebouncer.com`. The key comes from `BOUNCER_API_KEY`. Mapping:
  - deliverable, and acceptAll no → `valid`;
  - deliverable, and acceptAll yes → `catch_all` (shown as risky, reason "accepts every address");
  - risky → `risky` (e.g. low_deliverability, low_quality);
  - undeliverable → `invalid`;
  - unknown, or HTTP 200 with reason timeout → `unknown`, `billable: false`;
  - 429 → back off and retry later (`retryAfter` when present); 402 → stop verifying and alert the admin. Neither charges the customer.
- **`FakeVerifier`** (default when `LLM_PROVIDER=fake` or there is no key): deterministic, no network. A local part
  starting with `bounce` gives invalid, `catchall.` in the domain gives catch_all, `unknown` gives unknown, everything else valid.
- **`MissingKeyVerifier`:** with the switch on but no key, every call reports "Verification key missing". Nothing is charged.
  The campaign keeps its free-check results.
- **Recorded-response tests:** Bouncer's documented JSON for each status, 402, 429 and timeout, replayed through a fake `fetch`.
- **Guard:** the existing never-SMTP test is extended to `src/lib/email-verify/`: no `net`/`tls` imports, no port 25. The only
  host it may call is the provider's HTTPS API.

### Cache: 30 days per address

New table `email_verifications`:

- columns: `workspace_id`, `email` (lowercased), `provider`, `status`, `reason`, `checked_at`, `expires_at` (+30 days), with
  primary key `(workspace_id, email)`;
- RLS on, server only, like `email_domain_checks`;
- deleted by the existing retention job when it expires.

The cache is **per workspace**, not shared across customers. Each customer is the controller of its own lead list. Reusing one
customer's result for another would mean sharing personal data between controllers. *(A shared cache would be cheaper: ask
the lawyer before considering it.)*

### Results on the lead

- Leads get `verify_status` and `verify_reason`.
- They also feed the existing `email_status`:
  - `invalid` makes the lead invalid (skipped, writing reservation released, as in Part A);
  - `catch_all` and `risky` make it risky with the new reasons `accept_all` and `low_deliverability`, so "Exclude risky" covers them;
  - `valid` confirms it; `unknown` changes nothing.
- The pre-send refusal in `senderNext` already stops invalid addresses. A verified-invalid address is never sent.
- API: `options.verify_mailboxes` (default false), and `email_check.verified` (status + reason) in each result.
  The n8n node and Make app get the same switch.

### Credits and costs

- **Ledger:** at run start, reserve `ceil(n / 2)` credits for the n addresses that need a paid check (cache hits excluded).
  Verification has its own idempotency key `verify:<campaign_id>:<run_id>`, so a retried run never charges twice.
- **When the run's checks are done:** capture `ceil(billable / 2)` and release the rest. Unknowns, provider errors and a
  missing key are not billable.
- The ledger today reserves per lead. Verification needs a small campaign-level pair: `reserve_verification` and
  `settle_verification`, keyed by that idempotency key. These are new SQL functions with the same balance checks.
- **Costs:** every paid call logs to `usage_costs` with:
  - step `verify` (added to the step check);
  - model `bouncer`, `provider_units = 1`;
  - `cost_usd` = `costPerCheckUsd` for billable checks, 0 for unknown;
  - `campaign_id` set.

  /admin's "Where the money goes" picks it up automatically. A daily cap (`VERIFY_DAILY_CAP`) and a low-balance alert follow
  the DeepSeek pattern.
- **Fallback stays free:** if Bouncer is down or out of credits, leads go on with their free-check result and nobody is charged.

### Worker

`emailVerifyTick` runs every 20 seconds, next to `emailCheckTick`. It picks campaigns with the switch on and leads with a
passed free check and no verification yet, and works through them:

- 10 at a time, under a shared limiter set below Bouncer's 1,000 a minute;
- timeout 10 seconds per check;
- the cache is read first.

## Before building

1. **Lawyer** (questions and draft texts in `docs/legal-drafts/bouncer.md`):
   - add Bouncer (or the chosen provider) as a sub-processor in the privacy policy and our DPA;
   - check that verifying a lead's mailbox through a third party fits the legitimate-interest basis we use for cold email.
2. ~~**Owner:** the credit rate and the first pack.~~ Decided 2026-11-26: 1 credit per 2 checks; start with the smallest pack
   (1,000 checks), and don't buy before the build.
3. **Bouncer account:** the owner creates it, buys the smallest pack and saves the key with `read -rs` into `.env.local`. Then signs the DPA.
4. **Re-read before building** (APIs change): Bouncer's real-time reference and status list, its DPA, and whether real-time
   unknowns are also free (the pricing page says so; the API reference is silent).

## Build plan (about 2 days)

1. Migration: `campaigns.verify_mailboxes`, the lead columns, `email_verifications`, the step `verify`, and the two ledger
   functions with idempotency.
2. Adapter, fake, Bouncer client, mapping, recorded-response tests, and the extended never-SMTP guard.
3. Worker tick, the pipeline gate, the cache, and the credit reserve and settle.
4. UI switch and estimate, results in the email-check card and the lead table; API, n8n and Make fields; /admin line.
5. Tests:
   - fake verifier end to end on embedded Postgres;
   - no charge for unknowns or provider failure;
   - a retry never charges twice;
   - the cache is per workspace and expires after 30 days;
   - invalid leads release their writing reservation;
   - everything still runs with `LLM_PROVIDER=fake` and no keys.

## Sources (read 2026-11-26)

- Bouncer pricing: https://www.usebouncer.com/pricing/
- Bouncer GDPR (EU hosting, DPA link, 60-day deletion): https://www.usebouncer.com/gdpr/
- Bouncer real-time API (endpoint, statuses, `acceptAll`, 1,000/min, timeout): https://docs.usebouncer.com/api-reference/real-time/verify-email.md
- ZeroBounce pricing (minimum $39 for 2,000, unknown free, 99.6% claim, AI scoring 1 credit): https://www.zerobounce.net/email-validation-pricing
- ZeroBounce GDPR (EU endpoint in Frankfurt, DPA, DPF): https://www.zerobounce.net/gdpr
- Emailable pricing (5,000 for $38, credits never expire, unknown refunded): https://emailable.com/pricing/
- Emailable API (accept_all, timeout 2–10 s) and rate limits (25/s): https://emailable.com/docs/api/emails/ and https://emailable.com/docs/api/rate-limits/
- Emailable privacy policy and DPA (US seat, DPF, 90-day erasure): https://emailable.com/privacy-policy/ and https://emailable.com/data-processing-agreement/
- NeverBounce single check (endpoint, `catchall`, timeout): https://developers.neverbounce.com/reference/single-check.md
- Could not be read (refused or 404): neverbounce.com pricing, privacy and DPA pages; kickbox.com and docs.kickbox.com;
  ZeroBounce's API quickstart; Bouncer's `/dpa/` page (linked, not opened). Third-party reviews used only for the items marked
  *(unconfirmed)*, e.g. https://emailextractor.ai/blog/neverbounce-pricing and https://pipeline.zoominfo.com/sales/neverbounce-api.
