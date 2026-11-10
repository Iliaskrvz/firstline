#!/usr/bin/env bash
# Save one setting in .env.local without showing it on screen. Replaces an existing value.
#   bash scripts/set-env.sh STRIPE_SECRET_KEY
set -euo pipefail
cd "$(dirname "$0")/.."
NAME="${1:?usage: bash scripts/set-env.sh NAME}"
[[ "$NAME" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "Use a NAME like STRIPE_SECRET_KEY."; exit 1; }
read -rsp "$NAME (paste, then Enter; nothing shows): " VALUE
echo
VALUE="$(printf '%s' "$VALUE" | tr -d '\r\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
[ -n "$VALUE" ] || { echo "Nothing entered; nothing changed."; exit 1; }
touch .env.local && chmod 600 .env.local
grep -v "^$NAME=" .env.local > .env.local.tmp || true
printf '%s=%s\n' "$NAME" "$VALUE" >> .env.local.tmp
mv .env.local.tmp .env.local && chmod 600 .env.local
echo "$NAME saved (${#VALUE} characters). Run the deploy to put it on the server."
