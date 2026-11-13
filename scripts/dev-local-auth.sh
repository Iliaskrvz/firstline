#!/usr/bin/env bash
# The app against the LOCAL Supabase (Docker: npx supabase start), for testing sign-in methods
# without touching the live project. Emails (confirmations, resets) land in Mailpit: http://127.0.0.1:55324
#   bash scripts/dev-local-auth.sh          # dev server
#   bash scripts/dev-local-auth.sh prod     # production build (no live reload), into .next-local
set -euo pipefail
cd "$(dirname "$0")/.."
eval "$(npx supabase status -o env 2>/dev/null | grep -E '^(API_URL|PUBLISHABLE_KEY|DB_URL)=')"
export NEXT_PUBLIC_SUPABASE_URL="$API_URL"
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY"
export DATABASE_URL="$DB_URL"
export PUBLIC_APP_URL=""
unset ANTHROPIC_API_KEY DEEPSEEK_API_KEY FIRECRAWL_API_KEY
if [ "${1:-}" = "prod" ]; then
  export NEXT_DIST_DIR=".next-local"
  npx next build >/dev/null
  exec npx next start -p 3000
fi
exec npx next dev -p 3000
