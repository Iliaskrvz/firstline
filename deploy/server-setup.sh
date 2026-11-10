#!/usr/bin/env bash
# One-time (and repeatable) VPS setup for FirstLine. Runs on the VPS as root, called by deploy/deploy.sh.
# Installs Node 22, pm2 and Caddy (automatic HTTPS), creates the `firstline` user, and points
# Caddy at the app. It refuses to touch ports 80/443 if something other than Caddy uses them.
set -euo pipefail
DOMAIN="$1"
APP_PORT=3100
say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

[ "$(id -u)" = 0 ] || { echo "Run as root."; exit 1; }
command -v apt-get >/dev/null || { echo "This script supports Debian/Ubuntu (apt) only."; exit 1; }
. /etc/os-release; say "Server: $PRETTY_NAME, $(nproc) CPU, $(free -m | awk '/Mem:/{print $2}') MB RAM"

# Ports: never take over a web server that's already there.
for p in 80 443; do
  owner=$(ss -ltnpH "sport = :$p" 2>/dev/null | sed -nE 's/.*users:\(\("([^"]+)".*/\1/p' | head -1)
  if [ -n "$owner" ] && [ "$owner" != "caddy" ]; then
    echo "Port $p is already used by '$owner'. Not changing anything; tell Claude, so FirstLine can be added to that setup instead."
    exit 2
  fi
done
owner=$(ss -ltnpH "sport = :$APP_PORT" 2>/dev/null | sed -nE 's/.*users:\(\("([^"]+)".*/\1/p' | head -1)
if [ -n "$owner" ] && ! pgrep -u firstline -f "next start" >/dev/null; then
  echo "Port $APP_PORT is already used by '$owner'. Stopping."; exit 2
fi

say "Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg rsync debian-keyring debian-archive-keyring apt-transport-https >/dev/null

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  say "Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "node $(node --version)"

if ! command -v caddy >/dev/null; then
  say "Caddy"
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi
echo "$(caddy version | cut -d' ' -f1)"

command -v pm2 >/dev/null || { say "pm2"; npm install -g pm2 >/dev/null 2>&1; }
echo "pm2 $(pm2 --version)"

# Building the app needs ~2 GB; add swap on small servers.
if [ "$(free -m | awk '/Mem:/{print $2}')" -lt 3000 ] && [ "$(swapon --show | wc -l)" -eq 0 ]; then
  say "Adding 2 GB swap (small server)"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "User and folders"
id firstline >/dev/null 2>&1 || useradd --system --create-home --home-dir /opt/firstline --shell /bin/bash firstline
mkdir -p /opt/firstline/app/logs
chown -R firstline:firstline /opt/firstline

say "HTTPS for $DOMAIN (Caddy)"
cat > /etc/caddy/firstline.caddy <<CADDY
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:$APP_PORT
}
CADDY
# A stock Caddyfile (the welcome page) is replaced; a real one just gets our site imported.
if [ ! -s /etc/caddy/Caddyfile ] || grep -q 'usr/share/caddy' /etc/caddy/Caddyfile; then
  echo 'import /etc/caddy/firstline.caddy' > /etc/caddy/Caddyfile
elif ! grep -q 'firstline.caddy' /etc/caddy/Caddyfile; then
  printf '\nimport /etc/caddy/firstline.caddy\n' >> /etc/caddy/Caddyfile
fi
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl enable --now caddy >/dev/null 2>&1
systemctl reload caddy

if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
  say "Firewall: allowing web traffic"
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
fi

say "pm2 starts FirstLine after a reboot"
pm2 startup systemd -u firstline --hp /opt/firstline >/dev/null
echo "server ready"
