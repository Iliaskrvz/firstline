# FirstLine

Pay-per-use cold email personalisation. **[SPEC.md](SPEC.md) is the source of truth.**

## Status

- **Phase 1** (done): auth, workspaces, schema with RLS and credit ledger, CSV upload + mapping, template editor.
- **Phase 2** (done, without Claude): per-lead engine (research → facts → write → validate → fallback), pg-boss
  worker, free 5-lead preview. Writing runs on a **fake LLM** until an AI provider key is added (DeepSeek by default).
- **Phase 3** (done): Gmail sender. Run campaign (free, ≤ 50 leads until credits exist), Inboxes, Sender
  Sheet script ([apps-script/](apps-script/README.md)), `/api/sender/next` + `/report`, scheduler, stop rules.
- **Phase 4** (done): follow-up steps in the same thread (plain or personalised, delay in working days),
  several inboxes per campaign (round robin, each lead stays in one inbox), offline alerts by email (Resend),
  Replies page with reply/bounce rates and the do-not-contact list.
- **Phase 5** (in progress): credits wired into runs (reserve → capture/release, fallbacks free, stop a run),
  25 welcome credits, credit packs through **Polar** (merchant of record: it charges VAT and sends invoices)
  with a signature-checked, idempotent webhook (`/api/webhook/polar`, one ledger entry per order), Credits page,
  CSV export with `fl_` columns. Spec change: Polar instead of Stripe (the user's choice; Kelviq before that,
  removed 2026-11-12). Auto top-up is off. Setup and checklist: POLAR_SETUP.md.

## Setup

1. `npm install`
2. `cp .env.example .env.local` and fill in the values you have.
3. Database schema (Supabase CLI):
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push --remote
   ```
4. Supabase → **Authentication → URL Configuration**: Site URL `http://localhost:3000`, Redirect URL
   `http://localhost:3000/auth/callback`.
5. `npm run dev` → http://localhost:3000

## The engine (Phase 2)

All job logic lives in `src/engine/` and has no queue imports, so the queue can change later.

| Step | File |
|---|---|
| robots.txt → Firecrawl map → pick homepage/about/services/newest news (keyword rules, no AI) | `research.ts`, `urls.ts`, `robots.ts` |
| Scrape to markdown, strip nav/footer/cookies/scripts/hidden text, wrap as data | `firecrawl.ts`, `clean.ts` |
| Facts (Haiku) with tiers, 30-day domain cache keyed by extractor | `llm*.ts`, `prompts/extract.ts` |
| Sales Skill v1 writer: plan first, then slots (strict JSON) | `prompts/skill-v1.ts`, `schemas.ts` |
| Plan check + rule checks in code, AI judge, one rewrite, neutral fallback (0 credits) | `checks.ts`, `prompts/judge.ts`, `fallback.ts` |
| Real cost of every Firecrawl/AI call → `usage_costs` | `costs.ts` |

**Switching on AI (DeepSeek):** create a key at platform.deepseek.com → API keys and top up the prepaid balance. Then save
`DEEPSEEK_API_KEY` with `bash scripts/set-env.sh DEEPSEEK_API_KEY`, set `LLM_PROVIDER=deepseek` the same way, and deploy.
Optional: `LLM_MONTHLY_CAP_USD` (monthly budget alert), `DEEPSEEK_BALANCE_ALERT` (low-balance email), `LLM_RPM`.
Until then the preview is labelled "Test output, no AI used". With a provider set but no key, research still runs
and AI steps show "DeepSeek key missing". **Switching back to Claude:** `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`.

### Try the engine without the database

```bash
npm run engine:try -- fixtures/real-websites.csv
```

Real Firecrawl research on at most 5 leads, prints pages picked, facts, plan, slots, checks and cost.

### Run the worker locally

Needs `DATABASE_URL` (Supabase session pooler) and `FIRECRAWL_API_KEY`.

```bash
npm run worker
```

- one job per lead in the `lead-process` queue (pg-boss tables live in the `pgboss` schema)
- concurrency: `WORKER_CONCURRENCY` per worker, `WORKSPACE_CONCURRENCY` per workspace across workers;
  Firecrawl calls are capped at your Firecrawl plan's limit (read at startup), since extra calls get throttled
- retries: 3 with exponential backoff; HTTP 429/5xx are also retried inside each call
- idempotent: finished leads are skipped; the same lead can't be queued twice in one run
- heartbeat every 15 s in `worker_heartbeats`; health check at http://127.0.0.1:8787/health
- VPS: see "Running on the VPS" below (`deploy/ecosystem.config.cjs` runs the web app and the worker)

## Gmail sender (Phase 3)

The Sender Sheet script runs in the user's Google account and calls `GET /api/sender/next` (one email or
"nothing now") and `POST /api/sender/report` (sent / failed / replied / bounced flags) with a per-inbox key.
All scheduling happens on the server (`src/lib/sender/schedule.ts`, `src/sender/db.ts`): sending window, daily
cap with warm-up (10 → 30, +2 per sending day), 6–14 min gaps, one email at a time, suppression list, stop rules
(reply/bounce/unsubscribe stop the lead; a reply pauses other leads at the same company, resumable).

Local testing needs a public address for Google to call:

```bash
npm run tunnel
```

Copy the `https://….trycloudflare.com` address into `PUBLIC_APP_URL` in `.env.local`. The address changes every
time the tunnel restarts; then run FirstLine → Connect… in the sheet again.

## Sending tools (Phase 7)

Push written leads into Instantly (Smartlead and Lemlist follow) with the personalised parts as custom variables.

- Code: `src/integrations/`. One `SendingTool` interface (`types.ts`), the Instantly API v2 adapter, a fake, and `push-pg.ts` (pushes, events, polling). Every adapter must pass `testing/contract.ts`; Instantly is tested against an in-memory API (`testing/instantly-sim.ts`), never the real one.
- Keys are encrypted with `INTEGRATIONS_ENCRYPTION_KEY` (AES-256-GCM). Create it once with `bash scripts/gen-secret.sh INTEGRATIONS_ENCRYPTION_KEY`; never change it after keys are saved.
- Flow: Integrations page → paste key → test → saved, webhooks registered. Campaign page → "Push to a sending tool" → pick campaign → variables (defaults match the CSV export: `fl_subject`, `fl_<slot>`, `fl_full_email`) → dry run (5) → push all. The worker runs pushes in batches of up to 1,000 with retries, resumes after a crash (2-minute lease) and offers "Retry failed".
- Webhooks: `/api/integrations/webhook/{id}/{token}`. Instantly doesn't sign webhooks, so the secret token in the URL authenticates. Events are stored once as a hash (no email, no reply text). Bounces and unsubscribes go on the suppression list. Without webhooks (plan or no public https address), the worker polls every 15 minutes.
- Outcome rows (`outcomes`): one per email that left FirstLine (Gmail, CSV, push), with skill version, writer, slot types and fact tiers, no personal data. The Quality Lab shows reply rate per version from them.
- No account? Use the key `fake-instantly` (or `fake-instantly-nohooks`) outside production.

## Teams and scale (Phase 10)

- **Roles:** owner, admin, member (`src/lib/team.ts`). Owners and admins buy credits and manage integrations, API keys and the team; members do everything else. Seats are free. Settings → Team: invite by email (a 7-day link; emailed when RESEND_API_KEY is set, otherwise copy the link), remove, change role, transfer ownership. Settings → Activity: who ran, pushed, bought or changed what.
- **Several workspaces per person:** the current one is in the `fl_ws` cookie, checked against the memberships on every request; switch at the top right. Every list query filters on the current workspace.
- **Leads at once per workspace:** set on /admin, or automatic from credits bought (`src/lib/concurrency.ts`). Enforced across all workers with `workspace_slots`.
- **More workers:** `WORKER_INSTANCES=2` in .env.local, then deploy. Firecrawl's plan concurrency and the AI provider's requests per minute and at once are shared in Postgres (`src/engine/limiter-pg.ts`), and periodic tasks (alerts, batches, polling, retention) run on one worker at a time.
- **Packs:** `src/config/packs.ts`. Lite credits pay for Lite-writer campaigns only. Load test: `npx tsx scripts/load-test.ts 5000`.

## Models and costs

- **One file:** `src/config/models.ts` holds, per provider, the model per step, the price tables (DeepSeek peak/off-peak, Anthropic; checked against both pricing pages on 2026-11-13), DeepSeek's peak hours and holidays, and the bake-off candidates. No model names anywhere else.
- **Provider:** `LLM_PROVIDER=deepseek` (owner's decision 2026-11-13) or `anthropic` (kept, unused; switching back is this one setting plus `ANTHROPIC_API_KEY`). `fake` = test output.
- **Steps (DeepSeek):**

  | Step | Model |
  |---|---|
  | extraction | deepseek-flash |
  | writer_pro | deepseek-v4-pro |
  | writer_lite | deepseek-flash |
  | writer_economy | deepseek-v4-pro, held until DeepSeek's off-peak hours (half price) |
  | judge | deepseek-flash |
  | judge_sample | deepseek-v4-pro (planned 5% double-check, not wired yet) |
  | testset_judge | deepseek-v4-pro (Quality Lab comparisons and the bake-off) |

  Thinking is off for every step. DeepSeek peak hours are 01:00–04:00 and 06:00–10:00 UTC, Monday to Friday, except Chinese public holidays; everything else is off-peak. Each request is priced by the hour it ran, and cache hits are recorded separately (`cached_tokens`).
- **Privacy (hard rule, tested):** a lead's email address, first name, last name and LinkedIn URL never go to the AI provider. The writer refers to the person neutrally; `{{first_name}}` and other variables are filled in by our code afterwards. Every DeepSeek request is also scrubbed (`src/engine/privacy.ts`). `src/engine/llm-deepseek.test.ts` fails if any of them appears in a request. Deep research isn't available with DeepSeek.
- **JSON:** every answer is checked against our schemas; an empty or invalid answer is retried once, then the lead gets the free fallback.

- **Costs:** every call's real cost goes to `usage_costs`. /admin shows the spend per step and model over the last 30 days. Lab and bake-off rows have no workspace and are left out of the customer margins.
- **Model bake-off** (/admin/lab):
  - Writers (DeepSeek): V4 Pro, Flash, and V4 Pro held for off-peak hours, all from the same facts.
  - Judging: V4 Pro scores every email and compares each writer with V4 Pro blind, in both orders. Flash judges the same pairs, to measure how often it agrees.
  - Extraction: Flash vs V4 Pro on 30 leads, with every fact checked against its page.
  - With `LLM_PROVIDER=anthropic` the Claude candidates run instead (Sonnet, Haiku, Sonnet batch, Opus).
  - Output: a blind sheet of 20 pairs for the owner.
  - Budget: hard $20. After 5 leads the whole run is projected, and it stops if that would go over.
  - It starts only when an admin ticks the approval box. It never changes defaults.

## Sign-in methods

People sign in with an email address and password, a passkey, Google, or a sign-in link by email (`/login`, `/signup`, `/forgot-password`, Settings → Account). Passwords: at least 10 characters (`src/lib/auth-messages.ts`). Sign-up needs a confirmed email address before the 25 welcome credits arrive. The Google and passkey buttons only show when the Supabase project has them switched on (read from `/auth/v1/settings`, `src/lib/auth-options.ts`), so a half-configured project never shows a broken button.

**Live project setup (Supabase dashboard, project FirstLine):** do this by hand. Don't run `supabase config push`: `supabase/config.toml` holds localhost values for local testing.

1. Authentication → URL Configuration: Site URL `https://firstline.46-17-99-33.sslip.io`; add redirect URL `https://firstline.46-17-99-33.sslip.io/auth/callback`.
2. Authentication → Sign In / Providers → Email: Confirm email ON; minimum password length 10.
3. Authentication → Passkeys: enable; RP display name `FirstLine`; RP ID `firstline.46-17-99-33.sslip.io`; origin `https://firstline.46-17-99-33.sslip.io`. Changing the RP ID later (brand domain) makes existing passkeys stop working: people must add them again, and sign in with password, Google or link in the meantime.
4. Google: Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application); authorised redirect URI `https://enxycdkxofmfendkvafy.supabase.co/auth/v1/callback`. Then Supabase → Sign In / Providers → Google: paste the client ID and secret, enable. The consent screen shows the app name and domain, so finish it once the brand and domain are decided.
5. Recommended: Authentication → Emails → SMTP settings with Resend. Supabase's built-in mailer sends only a few emails per hour, too few for sign-ups and password resets.

**Test locally without touching the live project:** `npx supabase start` (local ports 553xx), then `bash scripts/dev-local-auth.sh` (or `… prod` for a production build in `.next-local`). Confirmation and reset emails land in Mailpit at http://127.0.0.1:55324. Passkeys work there with RP ID `localhost`; Google stays off locally.

## Running on the VPS

`bash deploy/deploy.sh` (from this Mac) sets up the server and deploys: Node 22, pm2 and Caddy (automatic HTTPS) on
the VPS, the web app on 127.0.0.1:3100 behind Caddy, and the worker, both under pm2 as the `firstline` user (restart
on crash and after a reboot). It copies the code with rsync and `.env.local` over SSH (never printed, mode 600), sets
`PUBLIC_APP_URL` to the server's address, builds and reloads. Run it again for every update.

- default host `root@46.17.99.33`, address `https://firstline.46-17-99-33.sslip.io` (no DNS needed); pass your
  own: `bash deploy/deploy.sh root@HOST firstline.example.com` after pointing an A record at the server
- it stops without changing anything if another web server already uses ports 80/443
- after the first deploy add the address in Supabase → Authentication → URL Configuration (Site URL and
  `https://<address>/auth/callback` as a redirect URL)
- logs: `ssh root@HOST 'su - firstline -c "pm2 logs --lines 50"'`

## Scripts

| Command | What it does |
|---|---|
| `npm test` | Unit tests + migration/RLS/ledger tests (PGlite) + concurrency and worker-path tests on an embedded Postgres 17 |
| `npm run typecheck` | Next route types + `tsc` |
| `npm run worker` | Start the job worker |
| `npm run tunnel` | Public https address for the dev server (Cloudflare quick tunnel), for the Sender Sheet |
| `npm run engine:try -- <csv>` | Engine on a CSV without the database (max 5 leads) |
| `npx supabase db push --remote` | Apply `supabase/migrations` to the linked project |

- `scripts/gen-secret.sh NAME`: create a random secret in .env.local without showing it (never overwrites).
- `scripts/secret-scan.sh`: scan staged changes and unpushed commits for secrets. Run it on its own before pushing.

## Layout

- `src/lib/`: pure, tested logic (CSV, domains, templates, credits, env, queue ids)
- `src/engine/`: per-lead pipeline (framework-agnostic)
- `worker/`: pg-boss worker process + pm2 config
- `supabase/migrations/`: schema; `supabase/tests/`: database tests (no Docker needed)
- `fixtures/`: sample CSVs (`sample-leads.csv` is messy on purpose, `real-websites.csv` uses real company sites)
