# FirstLine

Pay-per-use cold email personalisation. **[SPEC.md](SPEC.md) is the source of truth.**

## Status

- **Phase 1** (done): auth, workspaces, schema with RLS and credit ledger, CSV upload + mapping, template editor.
- **Phase 2** (done, without Claude): per-lead engine (research → facts → write → validate → fallback), pg-boss
  worker, free 5-lead preview. Writing runs on a **fake LLM** until an Anthropic key is added.
- **Phase 3** (done): Gmail sender. Run campaign (free, ≤ 50 leads until credits exist), Inboxes, Sender
  Sheet script ([apps-script/](apps-script/README.md)), `/api/sender/next` + `/report`, scheduler, stop rules.
- **Phase 4** (done): follow-up steps in the same thread (plain or personalised, delay in working days),
  several inboxes per campaign (round robin, each lead stays in one inbox), offline alerts by email (Resend),
  Replies page with reply/bounce rates and the do-not-contact list.
- **Phase 5** (in progress): credits wired into runs (reserve → capture/release, fallbacks free, stop a run),
  25 welcome credits, credit packs through **Kelviq** (merchant of record: it charges VAT and sends invoices;
  iDEAL|Wero + card) with a signature-checked, idempotent webhook, Credits page, CSV export with `fl_` columns.
  Spec change: Kelviq instead of Stripe (the user's choice); auto top-up is off until Kelviq confirms how a
  one-time purchase saves a payment method for later charges.

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
| Real cost of every Firecrawl/Claude call → `usage_costs` | `costs.ts` |

**Switching to Claude:** set `LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` in `.env.local`, restart the worker.
Until then the preview is labelled "Test output, no AI used". With `LLM_PROVIDER=anthropic` and no key, research
still runs and AI steps show "Anthropic key missing".

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

## Layout

- `src/lib/`: pure, tested logic (CSV, domains, templates, credits, env, queue ids)
- `src/engine/`: per-lead pipeline (framework-agnostic)
- `worker/`: pg-boss worker process + pm2 config
- `supabase/migrations/`: schema; `supabase/tests/`: database tests (no Docker needed)
- `fixtures/`: sample CSVs (`sample-leads.csv` is messy on purpose, `real-websites.csv` uses real company sites)
