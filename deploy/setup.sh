#!/usr/bin/env bash
# One-time (idempotent) server setup for the tracker on Ubuntu 24.04.
# Run on the VPS as a sudoer:  ssh adnan@103.193.179.175 'sudo bash -s' < deploy/setup.sh
# Then copy tracker-*.service and Caddyfile.tracker beside it (deploy.sh does this).
set -euo pipefail

rand() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "${1:-40}"; }

# Postgres
if ! command -v psql >/dev/null; then
  apt-get update -q && DEBIAN_FRONTEND=noninteractive apt-get install -yq postgresql
fi
systemctl enable --now postgresql

# Service user and folders
id tracker >/dev/null 2>&1 || useradd --system --home /srv/tracker --shell /usr/sbin/nologin tracker
install -d -o tracker -g tracker /srv/tracker /srv/tracker/api /srv/tracker/web /srv/tracker/web/releases
install -d -m 750 -o root -g tracker /etc/tracker

# Secrets: generated once, never overwritten
if [ ! -f /etc/tracker/api.env ]; then
  DB_PASS=$(rand 32); API_TOKEN=$(rand 48)
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tracker') THEN
    CREATE ROLE tracker LOGIN PASSWORD '$DB_PASS';
  ELSE
    ALTER ROLE tracker PASSWORD '$DB_PASS';
  END IF;
END \$\$;
SQL
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='tracker'" | grep -q 1 \
    || sudo -u postgres createdb -O tracker tracker

  cat > /etc/tracker/api.env <<ENV
HOST=127.0.0.1
PORT=8080
DATABASE_URL=postgres://tracker:$DB_PASS@127.0.0.1:5432/tracker?sslmode=disable
HASH_SECRET=$(rand 48)
API_TOKEN=$API_TOKEN
TRUST_PROXY=true
ALLOW_LOCALHOST=false
LOG_LEVEL=info
ENV
  cat > /etc/tracker/web.env <<ENV
API_URL=http://127.0.0.1:8080
API_TOKEN=$API_TOKEN
DASHBOARD_PASSWORD=$(rand 20)
SESSION_SECRET=$(rand 48)
DASHBOARD_TZ=Asia/Jakarta
ENV
  chown root:tracker /etc/tracker/*.env && chmod 640 /etc/tracker/*.env
  echo "Generated secrets in /etc/tracker (dashboard password: grep DASHBOARD_PASSWORD /etc/tracker/web.env)"
fi

# IP geolocation (DB-IP "IP to City Lite", CC BY 4.0): refreshed monthly, then the API restarts.
install -d -o tracker -g tracker /var/lib/tracker
cat > /usr/local/bin/tracker-geoip-update <<'SH'
#!/usr/bin/env bash
# Download this month's DB-IP City Lite database (fall back to last month early in the month).
set -euo pipefail
dest=/var/lib/tracker/dbip-city-lite.mmdb
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
for m in "$(date -u +%Y-%m)" "$(date -u -d 'last month' +%Y-%m)"; do
  if curl -fsSL "https://download.db-ip.com/free/dbip-city-lite-$m.mmdb.gz" | gunzip > "$tmp"; then
    install -o tracker -g tracker -m 644 "$tmp" "$dest"
    echo "geoip: installed $m"
    systemctl try-restart tracker-api || true
    exit 0
  fi
done
echo "geoip: download failed" >&2
exit 1
SH
chmod 755 /usr/local/bin/tracker-geoip-update
[ -f /var/lib/tracker/dbip-city-lite.mmdb ] || /usr/local/bin/tracker-geoip-update
echo '15 4 3 * * root /usr/local/bin/tracker-geoip-update >/dev/null' > /etc/cron.d/tracker-geoip
grep -q '^GEOIP_DB=' /etc/tracker/api.env || echo 'GEOIP_DB=/var/lib/tracker/dbip-city-lite.mmdb' >> /etc/tracker/api.env

# Daily database backup, 14 days kept
install -d -o postgres -g postgres -m 700 /var/backups/tracker
cat > /etc/cron.d/tracker-backup <<'CRON'
30 3 * * * postgres pg_dump -Fc tracker > /var/backups/tracker/tracker-$(date +\%F).dump && find /var/backups/tracker -name '*.dump' -mtime +14 -delete
CRON

echo "setup done"
