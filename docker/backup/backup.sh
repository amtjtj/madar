#!/bin/sh
# Database backups (ADR 0016). Runs in the `backup` service (postgres image, same version as the
# database). Every night: pg_dump, keep KEEP_DAILY daily and KEEP_WEEKLY weekly copies, restore the
# new file into a scratch database and compare row counts, optionally copy it to S3.
#   backup.sh loop    run forever, once a day at BACKUP_AT (Asia/Tehran)
#   backup.sh now     one backup and its restore check
#   backup.sh check   restore check of the newest backup
set -eu
export PGOPTIONS="-c client_min_messages=warning"

DIR=/backups
BACKUP_AT=${BACKUP_AT:-03:30}
KEEP_DAILY=${KEEP_DAILY:-7}
KEEP_WEEKLY=${KEEP_WEEKLY:-4}
CHECK_DB=madar_restore_check
# Tables whose row counts must match after a restore.
TABLES="tenants members departments projects tasks comments goals key_results key_result_checkins notifications weekly_reports audit_logs"

log() { printf '{"time":"%s","service":"backup","message":"%s"}\n' "$(date -Iseconds)" "$*"; }

count_rows() { # database
  for t in $TABLES; do
    printf '"%s":%s,' "$t" "$(psql -d "$1" -Atqc "select count(*) from $t" 2>/dev/null || echo -1)"
  done | sed 's/,$//'
}

check() { # file
  file=$1
  dropdb --if-exists "$CHECK_DB"
  createdb "$CHECK_DB"
  ok=true
  pg_restore --exit-on-error --no-owner --no-privileges -d "$CHECK_DB" "$file" || ok=false
  live=$(count_rows "$PGDATABASE")
  restored=$(count_rows "$CHECK_DB")
  dropdb --if-exists "$CHECK_DB"
  # The live database may have grown since the dump; it must never have fewer rows.
  if [ "$ok" = true ]; then
    for t in $TABLES; do
      a=$(echo "$live" | tr ',' '\n' | grep "\"$t\":" | cut -d: -f2)
      b=$(echo "$restored" | tr ',' '\n' | grep "\"$t\":" | cut -d: -f2)
      if [ "$b" -lt 0 ] || [ "$b" -gt "$a" ]; then ok=false; fi
    done
  fi
  printf '{"time":"%s","file":"%s","bytes":%s,"ok":%s,"restored":{%s},"live":{%s}}\n' \
    "$(date -Iseconds)" "$(basename "$file")" "$(wc -c < "$file")" "$ok" "$restored" "$live" \
    > "$DIR/last-check.json"
  if [ "$ok" = true ]; then log "restore check passed for $(basename "$file")"; else
    log "ERROR restore check FAILED for $(basename "$file")"; return 1; fi
}

upload() { # file
  [ -n "${BACKUP_S3_BUCKET:-}" ] || return 0
  command -v aws >/dev/null 2>&1 || apk add --no-cache aws-cli >/dev/null
  AWS_ACCESS_KEY_ID=$BACKUP_S3_ACCESS_KEY AWS_SECRET_ACCESS_KEY=$BACKUP_S3_SECRET_KEY \
    aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "$1" "s3://$BACKUP_S3_BUCKET/$(basename "$1")" \
    --only-show-errors && log "copied $(basename "$1") to s3://$BACKUP_S3_BUCKET"
}

prune() { # dir keep
  ls -1t "$1"/*.dump 2>/dev/null | tail -n +"$(($2 + 1))" | xargs -r rm -f
}

backup() {
  mkdir -p "$DIR/daily" "$DIR/weekly"
  file="$DIR/daily/madar_$(date +%Y-%m-%d_%H%M).dump"
  pg_dump -Fc -f "$file.partial"
  mv "$file.partial" "$file"
  log "backup written: $(basename "$file") ($(wc -c < "$file") bytes)"
  # Fridays also go to the weekly set.
  if [ "$(date +%u)" = 5 ]; then cp "$file" "$DIR/weekly/"; fi
  prune "$DIR/daily" "$KEEP_DAILY"
  prune "$DIR/weekly" "$KEEP_WEEKLY"
  check "$file"
  upload "$file" || log "ERROR copy to S3 failed"
}

seconds_until() { # HH:MM, today or tomorrow
  now=$(date +%s)
  at=$(date -d "$1" +%s)
  [ "$at" -gt "$now" ] || at=$((at + 86400))
  echo $((at - now))
}

case "${1:-loop}" in
  now) backup ;;
  check) check "$(ls -1t "$DIR"/daily/*.dump | head -n 1)" ;;
  loop)
    log "nightly backups at $BACKUP_AT ($(date +%Z)), keeping $KEEP_DAILY daily and $KEEP_WEEKLY weekly"
    while true; do
      sleep "$(seconds_until "$BACKUP_AT")"
      backup || log "ERROR backup failed"
    done
    ;;
  *) echo "usage: backup.sh loop|now|check" >&2; exit 2 ;;
esac
