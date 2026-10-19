#!/usr/bin/env bash
# Writes the production .env with random secrets (docs/deploy.md, step 3). Never overwrites.
#   scripts/deploy/init-env.sh demo.example.ir you@example.com [--demo]
set -euo pipefail
source "$(dirname "$0")/lib.sh"

[ -f "$ENV_FILE" ] && fail "$ENV_FILE already exists; edit it by hand (it holds the database passwords)."
domain=${1:-}
email=${2:-}
demo=${3:-}
[ -n "$domain" ] || read -r -p "Domain (e.g. demo.example.ir): " domain
[ -n "$email" ] || read -r -p "Email for certificate notices: " email
[[ "$domain" =~ ^[a-z0-9.-]+$ ]] || fail "invalid domain: $domain"

# URL-safe random strings (no characters that need escaping in connection URLs).
secret() { head -c 48 /dev/urandom | base64 | tr -d '/+=\n' | head -c "${1:-32}"; }
owner_pw=$(secret 32)
app_pw=$(secret 32)
worker_pw=$(secret 32)

umask 077
cat > "$ENV_FILE" <<ENV
# Madar production settings, written by scripts/deploy/init-env.sh on $(date +%Y-%m-%d).
# Keep this file private and backed up outside the server: it holds every password.

MADAR_DOMAIN=$domain
CADDY_GLOBAL_OPTIONS=email $email
# Own certificate instead of automatic HTTPS: tls /certs/fullchain.pem /certs/privkey.pem
CADDY_TLS=

# Domestic mirrors for builds (Docker Hub and npm may be blocked); see docs/deploy.md.
BASE_REGISTRY=docker.io/library
NPM_REGISTRY=https://registry.npmjs.org/

POSTGRES_USER=madar_owner
POSTGRES_PASSWORD=$owner_pw
POSTGRES_DB=madar
DATABASE_URL=postgres://madar_owner:$owner_pw@postgres:5432/madar
APP_DATABASE_URL=postgres://madar_app:$app_pw@postgres:5432/madar
WORKER_DATABASE_URL=postgres://madar_worker:$worker_pw@postgres:5432/madar

AUTH_SECRET=$(secret 48)
# Needed to register a new company through the app.
TENANT_SIGNUP_CODE=$(secret 20)

# Web Push keys: filled in by the first deploy.sh. Changing them drops every device.
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:$email
# Outbound proxy for browsers' push services, if the server cannot reach them directly.
PUSH_PROXY_URL=

# Attachments (ADR 0019): the files-data volume on this server, or set STORAGE_DRIVER=s3 and the
# S3_* values for an S3-compatible service (e.g. an Iranian cloud storage).
STORAGE_DRIVER=local
S3_ENDPOINT=
S3_REGION=us-east-1
S3_BUCKET=
S3_ACCESS_KEY=
S3_SECRET_KEY=
# Most Iranian S3 services and MinIO want path-style addresses.
S3_FORCE_PATH_STYLE=true

# Backups: nightly time (Tehran) and how many to keep; optional S3-compatible copy.
BACKUP_AT=03:30
BACKUP_KEEP_DAILY=7
BACKUP_KEEP_WEEKLY=4
BACKUP_S3_ENDPOINT=
BACKUP_S3_BUCKET=
BACKUP_S3_ACCESS_KEY=
BACKUP_S3_SECRET_KEY=
ENV

if [ "$demo" = --demo ]; then
  cat >> "$ENV_FILE" <<ENV

# Demo server: the demo company is seeded, and reset every night at DEMO_RESET_AT.
COMPOSE_PROFILES=demo
DEMO_MODE=true
DEMO_PASSWORD=$(secret 12)
DEMO_RESET_AT=05:00
ENV
fi

say "Wrote $ENV_FILE"
[ "$demo" = --demo ] && say "Demo password for every demo account: $(env_value DEMO_PASSWORD)"
say "Next: scripts/deploy/deploy.sh"
