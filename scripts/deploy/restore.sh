#!/usr/bin/env bash
# Replaces the live database with a backup file (docs/deploy.md, «بازگردانی»).
#   scripts/deploy/restore.sh backups/daily/madar_2026-10-18_0330.dump
# Safe by construction: a fresh backup is taken first, the file is restored into a separate
# database, and only a complete restore is swapped in. The old database is kept as
# <db>_before_restore until the next restore.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
require_env_file
cd "$ROOT"

file=${1:-}
[[ "$file" == *backups/* ]] || fail "usage: restore.sh backups/<daily|weekly|manual>/<file>.dump"
# Dumps are readable by root only; the backup container reads them at /backups.
inside="/backups/${file#*backups/}"
compose exec -T backup test -f "$inside" || fail "no such backup: $file"
db=$(env_value POSTGRES_DB)
db=${db:-madar}
sql() { compose exec -T backup psql -d postgres -v ON_ERROR_STOP=1 -Atqc "$1"; }

confirm "This replaces ALL data in the live database with $(basename "$file")."
say "Safety backup of the current data first"
compose exec -T backup /bin/sh /scripts/backup.sh now

trap 'printf "\033[31mRestore failed. The live database \"%s\" was not replaced.\nStart the app again with: docker compose --env-file .env -f docker/compose.prod.yml -p %s up -d\033[0m\n" "$db" "$PROJECT" >&2' ERR

say "Restoring $(basename "$file") into a separate database"
compose exec -T backup dropdb --if-exists "${db}_restoring"
compose exec -T backup createdb "${db}_restoring"
compose exec -T backup pg_restore --exit-on-error -d "${db}_restoring" "$inside"

say "Stopping the app (the database stays up)"
compose stop caddy web api worker demo
say "Swapping the restored database in"
sql "drop database if exists ${db}_before_restore"
sql "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$db' and pid <> pg_backend_pid()" >/dev/null
sql "alter database $db rename to ${db}_before_restore"
sql "alter database ${db}_restoring rename to $db"
trap - ERR

say "Starting the app (migrations run first)"
compose up -d --wait
say "Restored. The previous data is kept in the database ${db}_before_restore until the next restore."
