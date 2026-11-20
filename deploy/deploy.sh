#!/usr/bin/env bash
# Build locally and deploy the tracker API + dashboard to the VPS.
# Needs: go, node/npm, rsync, ssh access as a sudoer. Run deploy/setup.sh on the server once first.
# Usage: ./deploy/deploy.sh
set -euo pipefail

HOST="${DEPLOY_HOST:-adnan@103.193.179.175}"
URL="https://tracker.adnanradjam.com"
RELEASE=$(date -u +%Y%m%d%H%M%S)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist"

rm -rf "$OUT" && mkdir -p "$OUT"

echo "→ Building tracker script"
(cd "$ROOT/tracker" && npm ci --no-audit --no-fund --silent && npm run build --silent)

echo "→ Building API (linux/amd64)"
(cd "$ROOT/api" && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o "$OUT/tracker-api" ./cmd/server)

echo "→ Building dashboard"
(cd "$ROOT/web" && npm ci --no-audit --no-fund --silent && npm run build >/dev/null)
cp -r "$ROOT/web/.next/standalone" "$OUT/web"
cp -r "$ROOT/web/.next/static" "$OUT/web/.next/static"
[ -d "$ROOT/web/public" ] && cp -r "$ROOT/web/public" "$OUT/web/public"

echo "→ Uploading"
ssh "$HOST" "mkdir -p /tmp/tracker-deploy"
rsync -az --delete "$OUT/web/" "$HOST:/tmp/tracker-deploy/web/"
rsync -az "$OUT/tracker-api" "$ROOT/deploy/tracker-api.service" "$ROOT/deploy/tracker-web.service" \
  "$ROOT/deploy/Caddyfile.tracker" "$HOST:/tmp/tracker-deploy/"

echo "→ Activating release $RELEASE"
ssh "$HOST" "RELEASE=$RELEASE sudo -E bash -s" <<'REMOTE'
set -euo pipefail
cd /tmp/tracker-deploy
install -m 644 tracker-api.service tracker-web.service /etc/systemd/system/
systemctl daemon-reload

install -o tracker -g tracker -m 755 tracker-api /srv/tracker/api/tracker-api.new
mv -f /srv/tracker/api/tracker-api.new /srv/tracker/api/tracker-api

rel=/srv/tracker/web/releases/$RELEASE
mv web "$rel" && chown -R tracker:tracker "$rel"
ln -sfn "$rel" /srv/tracker/web/current.tmp && mv -T /srv/tracker/web/current.tmp /srv/tracker/web/current

systemctl enable -q tracker-api tracker-web
systemctl restart tracker-api tracker-web

wait_for() { for i in $(seq 1 60); do curl -fs -o /dev/null "$1" 2>/dev/null && return 0; sleep 1; done; echo "not healthy: $1" >&2; return 1; }
wait_for http://127.0.0.1:8080/healthz   # first start runs migrations, can take ~15s
wait_for http://127.0.0.1:3002/login

# Caddy: add the site once
if ! grep -q '^tracker.adnanradjam.com' /etc/caddy/Caddyfile; then
  cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak-$(date +%Y%m%d-%H%M%S)"
  { echo; cat Caddyfile.tracker; } >> /etc/caddy/Caddyfile
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
  systemctl reload caddy
fi

ls -1t /srv/tracker/web/releases | tail -n +6 | xargs -r -I{} rm -rf "/srv/tracker/web/releases/{}"
rm -rf /tmp/tracker-deploy
REMOTE

echo "→ Smoke test"
curl -fsS "$URL/healthz" >/dev/null
curl -fsS -o /dev/null "$URL/t.js"
echo "✓ Deployed: $URL"
