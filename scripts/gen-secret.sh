#!/usr/bin/env bash
# Create a random 32-byte secret in .env.local without showing it. Never replaces an existing one:
# for INTEGRATIONS_ENCRYPTION_KEY that would make every saved customer key unreadable.
#   bash scripts/gen-secret.sh INTEGRATIONS_ENCRYPTION_KEY
set -euo pipefail
cd "$(dirname "$0")/.."
NAME="${1:?usage: bash scripts/gen-secret.sh NAME}"
[[ "$NAME" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "Use a NAME like INTEGRATIONS_ENCRYPTION_KEY."; exit 1; }
touch .env.local && chmod 600 .env.local
if grep -q "^$NAME=." .env.local; then echo "$NAME already set: kept as it is."; exit 0; fi
grep -v "^$NAME=" .env.local > .env.local.tmp || true
printf '%s=%s\n' "$NAME" "$(openssl rand -base64 32)" >> .env.local.tmp
mv .env.local.tmp .env.local && chmod 600 .env.local
echo "$NAME created (not shown). Back it up somewhere safe: without it, saved integration keys can't be read."
