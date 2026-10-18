#!/usr/bin/env bash
# Checks a running production stack (ADR 0016): published ports, the HTTPS smoke test at 360 and
# 1440 px with the demo accounts, a backup with its restore check, and optionally a restore drill.
#   scripts/deploy/smoke.sh [--restore]
# Needs the repo's dependencies (pnpm install) and Playwright's Chromium on the machine running it.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
require_env_file
cd "$ROOT"

domain=$(env_value MADAR_DOMAIN)
password=$(env_value DEMO_PASSWORD)
[ -n "$password" ] || fail "the smoke test signs in with the demo accounts: run it on a demo stack"

say "Only Caddy publishes ports"
extra=$(compose ps --format '{{.Service}} {{.Ports}}' | grep -v '^caddy ' | grep -E '(0\.0\.0\.0|\[::\]):[0-9]' || true)
[ -z "$extra" ] || fail "unexpected published ports: $extra"

health() { # [resolve-ip]
  curl -sk --max-time 10 ${1:+--resolve "$domain:443:$1"} "https://$domain/api/health"
}
# Some sandboxes cannot reach published ports; then talk to Caddy's container address.
host_ip=""
if ! health >/dev/null; then host_ip=$(compose exec -T caddy hostname -i | tr -d '\r '); fi

say "HTTPS smoke test"
(cd apps/web && SMOKE_BASE_URL="https://$domain" SMOKE_HOST_IP="$host_ip" SMOKE_PASSWORD="$password" \
  pnpm exec playwright test -c playwright.prod.config.ts)

say "Backup with restore check"
compose exec -T backup /bin/sh /scripts/backup.sh now
grep -q '"ok":true' backups/last-check.json || fail "restore check failed: $(cat backups/last-check.json)"

if [ "${1:-}" = --restore ]; then
  say "Restore drill"
  latest=$(ls -1t backups/daily/*.dump | head -n 1)
  MADAR_YES=1 "$ROOT/scripts/deploy/restore.sh" "$latest"
  health "$host_ip" | grep -q '"status":"ok"' || fail "unhealthy after the restore"
fi
say "Smoke test passed"
