#!/usr/bin/env bash
# Deploy FirstLine to the VPS from this Mac. Safe to run again for every update.
#   bash deploy/deploy.sh                      (defaults below)
#   bash deploy/deploy.sh root@1.2.3.4 my.domain.com
# 1. sets up the server (deploy/server-setup.sh), 2. copies the code (not node_modules, not .git),
# 3. copies .env.local (never printed; only the firstline user can read it), 4. builds, starts with pm2,
# 5. checks that the site and worker answer.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="${1:-root@46.17.99.33}"
IP="${HOST#*@}"
DOMAIN="${2:-firstline.${IP//./-}.sslip.io}"
APP=/opt/firstline/app
say() { printf '\n\033[1;34m### %s\033[0m\n' "$*"; }

[ -f .env.local ] || { echo ".env.local not found in $(pwd)"; exit 1; }
grep -q '^DATABASE_URL=postgres' .env.local || { echo ".env.local has no DATABASE_URL (run: bash scripts/set-database-url.sh)"; exit 1; }

say "1/5 Server setup on $HOST (address: https://$DOMAIN)"
ssh -o ConnectTimeout=15 "$HOST" "bash -s -- '$DOMAIN'" < deploy/server-setup.sh

say "2/5 Copying the code"
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude .git --exclude 'logs/' --exclude '.env*' --exclude .DS_Store \
  --exclude '.claude/' --exclude 'supabase/.temp/' \
  ./ "$HOST:$APP/"
rsync -az .env.example "$HOST:$APP/.env.example"

say "3/5 Copying your keys (.env.local; not shown)"
ssh "$HOST" "umask 077; cat > $APP/.env.local.new" < .env.local
ssh "$HOST" "cd $APP && sed -i '/^PUBLIC_APP_URL=/d' .env.local.new && echo 'PUBLIC_APP_URL=https://$DOMAIN' >> .env.local.new \
  && mv .env.local.new .env.local && chmod 600 .env.local && chown -R firstline:firstline $APP"

say "4/5 Installing, building and (re)starting (takes a few minutes)"
ssh "$HOST" "su - firstline -c 'cd $APP && npm ci --no-audit --no-fund --loglevel=error && npm run build && pm2 startOrReload deploy/ecosystem.config.cjs --update-env && pm2 save'"

say "5/5 Checks"
sleep 5
ssh "$HOST" "curl -s -o /dev/null -w 'web (local): HTTP %{http_code}\n' http://127.0.0.1:3100/login; curl -s -m 5 http://127.0.0.1:8787/health | head -c 200; echo"
for i in 1 2 3 4 5 6; do
  code=$(curl -s -o /dev/null -m 20 -w '%{http_code}' "https://$DOMAIN/login" || true)
  [ "$code" = 200 ] && break
  echo "waiting for the HTTPS certificate… ($code)"; sleep 10
done
echo "https://$DOMAIN/login → HTTP $code"
echo
echo "Done. FirstLine runs at https://$DOMAIN"
echo "Logs:   ssh $HOST 'su - firstline -c \"pm2 logs --lines 50\"'"
