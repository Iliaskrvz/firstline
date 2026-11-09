# FirstLine

Pay-per-use cold email personalisation. **[SPEC.md](SPEC.md) is the source of truth.**

## Status

Phase 1 (skeleton + input): auth, workspaces, full schema with RLS and credit ledger, CSV upload with
column mapping, template editor with `{{vars}}` and `[[slots]]`.

## Setup

1. `npm install`
2. `cp .env.example .env.local` and fill in the Phase 1 values (Supabase → Project Settings → API).
3. Push the database schema:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npm run db:push
   ```
4. Supabase dashboard → **Authentication → URL Configuration**: Site URL `http://localhost:3000`,
   add `http://localhost:3000/auth/callback` to Redirect URLs.
5. Google login (optional): create an OAuth client (Web) in Google Cloud Console with redirect URI
   `https://<project-ref>.supabase.co/auth/v1/callback`, then paste the client ID and secret into
   Supabase → Authentication → Sign In / Providers → Google.
6. `npm run dev` → http://localhost:3000

## Scripts

| Command | What it does |
|---|---|
| `npm test` | Vitest: CSV, domain, template logic + the SQL migration run in PGlite (RLS, ledger) |
| `npm run typecheck` | Next route types + `tsc` |
| `npm run db:push` | Apply `supabase/migrations` to the linked project |
| `npm run db:types` | Generate TypeScript types from the linked database |

## Layout

- `src/lib/`: pure, tested logic (`csv`, `domain`, `template`, `credits`) and the model config
- `src/engine/`: per-lead pipeline (Phase 2)
- `supabase/migrations/`: schema; `supabase/tests/`: migration tests (no Docker needed)
- `fixtures/sample-leads.csv`: a small messy CSV for trying the upload
