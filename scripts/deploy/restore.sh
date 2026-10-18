#!/usr/bin/env bash
# Replaces the live database with a backup file (docs/deploy.md, «بازگردانی»).
#   scripts/deploy/restore.sh backups/daily/madar_2026-10-18_0330.dump
set -euo pipefail
source "$(dirname "$0")/lib.sh"
require_env_file

file=${1:-}
[ -n "$file" ] && [ -f "$file" ] || fail "usage: restore.sh <backup file>"
user=$(env_value POSTGRES_USER)
db=$(env_value POSTGRES_DB)
db=${db:-madar}

confirm "This replaces ALL data in the live database with $(basename "$file")."
say "Stopping the app (the database stays up)"
compose stop caddy web api worker backup
say "Recreating the database"
compose exec -T postgres dropdb -U "$user" --force --if-exists "$db"
compose exec -T postgres createdb -U "$user" "$db"
say "Restoring $(basename "$file")"
compose exec -T postgres pg_restore -U "$user" -d "$db" --exit-on-error < "$file"
say "Starting the app (migrations run first)"
compose up -d --wait
say "Restored. Check the app, then: scripts/deploy/status.sh"
