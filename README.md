# FirstLine

Pay-per-use cold email personalisation. **[SPEC.md](SPEC.md) is the source of truth.**

## Status

- **Phase 1** (done): auth, workspaces, schema with RLS and credit ledger, CSV upload + mapping, template editor.
- **Phase 2** (in progress): per-lead engine (research → facts → write → validate → fallback), pg-boss worker,
  free 5-lead preview. Writing runs on a **fake LLM** until an Anthropic key is added.

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
- concurrency: `WORKER_CONCURRENCY` per worker, `WORKSPACE_CONCURRENCY` per workspace across workers
- retries: 3 with exponential backoff; HTTP 429/5xx are also retried inside each call
- idempotent: finished leads are skipped; the same lead can't be queued twice in one run
- heartbeat every 15 s in `worker_heartbeats`; health check at http://127.0.0.1:8787/health
- VPS: `pm2 start worker/ecosystem.config.cjs` (logs in `logs/`); full setup steps come with deployment

## Scripts

| Command | What it does |
|---|---|
| `npm test` | Unit tests + migration/RLS/ledger tests (PGlite) + concurrency and worker-path tests on an embedded Postgres 17 |
| `npm run typecheck` | Next route types + `tsc` |
| `npm run worker` | Start the job worker |
| `npm run engine:try -- <csv>` | Engine on a CSV without the database (max 5 leads) |
| `npx supabase db push --remote` | Apply `supabase/migrations` to the linked project |

## Layout

- `src/lib/`: pure, tested logic (CSV, domains, templates, credits, env, queue ids)
- `src/engine/`: per-lead pipeline (framework-agnostic)
- `worker/`: pg-boss worker process + pm2 config
- `supabase/migrations/`: schema; `supabase/tests/`: database tests (no Docker needed)
- `fixtures/`: sample CSVs (`sample-leads.csv` is messy on purpose, `real-websites.csv` uses real company sites)
