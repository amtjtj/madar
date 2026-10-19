#!/bin/sh
# Database and attachment backups (ADR 0016, 0019). Runs in the `backup` service (postgres image,
# same version as the database). Every night: pg_dump plus an archive of the attachments
# (<name>.files.tar.gz next to the dump), keep KEEP_DAILY nightly and KEEP_WEEKLY weekly copies,
# restore the dump into a scratch database and compare row counts, check the archive reads back,
# optionally copy both to S3.
#   backup.sh loop    run forever, once a day at BACKUP_AT (Asia/Tehran), into daily/ (+ weekly/)
#   backup.sh now     one backup into manual/ (deploys, smoke tests, by hand) and its restore check
#   backup.sh check   restore check of the newest nightly backup
set -eu
export PGOPTIONS="-c client_min_messages=warning"
# Dumps hold every company's data: readable by the owner only.
umask 077

DIR=/backups
# The attachments volume (local file storage); empty when files live in S3.
FILES=/files
BACKUP_AT=${BACKUP_AT:-03:30}
KEEP_DAILY=${KEEP_DAILY:-7}
KEEP_WEEKLY=${KEEP_WEEKLY:-4}
KEEP_MANUAL=${KEEP_MANUAL:-5}
# One scratch database per run, so a nightly and a deploy backup never collide.
CHECK_DB=madar_restore_check_$$
# Tables whose row counts are compared after a restore.
TABLES="tenants members departments projects tasks comments goals key_results key_result_checkins notifications weekly_reports audit_logs"

log() { printf '{"time":"%s","service":"backup","message":"%s"}\n' "$(date -Iseconds)" "$*"; }

count_rows() { # database
  for t in $TABLES; do
    printf '"%s":%s,' "$t" "$(psql -d "$1" -Atqc "select count(*) from $t" 2>/dev/null || echo -1)"
  done | sed 's/,$//'
}

count_of() { # counts table
  echo "$1" | tr ',' '\n' | grep "\"$2\":" | cut -d: -f2
}

files_of() { # dump file -> its attachments archive
  echo "${1%.dump}.files.tar.gz"
}

archive_files() { # dump file
  [ -d "$FILES/tenants" ] || return 0
  tar -czf "$(files_of "$1").partial" -C "$FILES" tenants \
    && mv "$(files_of "$1").partial" "$(files_of "$1")"
}

check_files() { # dump file -> "true"/"false"; no archive is fine only while there are no files
  archive=$(files_of "$1")
  if [ ! -f "$archive" ]; then
    if [ -d "$FILES/tenants" ]; then echo false; else echo true; fi
    return
  fi
  if tar -tzf "$archive" >/dev/null 2>&1; then echo true; else echo false; fi
}

check() { # file
  file=$1
  dropdb --if-exists "$CHECK_DB"
  createdb "$CHECK_DB"
  ok=true
  # The same restore as scripts/deploy/restore.sh (owners and grants included).
  pg_restore --exit-on-error -d "$CHECK_DB" "$file" || ok=false
  files_ok=$(check_files "$file")
  [ "$files_ok" = true ] || ok=false
  live=$(count_rows "$PGDATABASE")
  restored=$(count_rows "$CHECK_DB")
  dropdb --if-exists "$CHECK_DB"
  if [ "$ok" = true ]; then
    for t in $TABLES; do
      a=$(count_of "$live" "$t")
      b=$(count_of "$restored" "$t")
      # The live database may have grown since the dump, never shrunk; an empty dump of a
      # database with companies is a failure.
      if [ "$b" -lt 0 ] || [ "$b" -gt "$a" ]; then ok=false; fi
      if [ "$t" = tenants ] && [ "$a" -gt 0 ] && [ "$b" -eq 0 ]; then ok=false; fi
    done
  fi
  # The summary has no data in it: readable by status.sh without sudo.
  (umask 022 && printf '{"time":"%s","file":"%s","bytes":%s,"ok":%s,"files":%s,"restored":{%s},"live":{%s}}\n' \
    "$(date -Iseconds)" "$(basename "$file")" "$(wc -c < "$file")" "$ok" "$files_ok" "$restored" "$live" \
    > "$DIR/last-check.json")
  if [ "$ok" = true ]; then log "restore check passed for $(basename "$file")"; else
    log "ERROR restore check FAILED for $(basename "$file")"; return 1; fi
}

upload() { # file
  [ -n "${BACKUP_S3_BUCKET:-}" ] || return 0
  # Needs the Alpine package mirror once; see docs/deploy.md.
  command -v aws >/dev/null 2>&1 || apk add --no-cache aws-cli >/dev/null
  AWS_ACCESS_KEY_ID=$BACKUP_S3_ACCESS_KEY AWS_SECRET_ACCESS_KEY=$BACKUP_S3_SECRET_KEY \
    aws ${BACKUP_S3_ENDPOINT:+--endpoint-url "$BACKUP_S3_ENDPOINT"} s3 cp "$1" \
    "s3://$BACKUP_S3_BUCKET/$(basename "$1")" --only-show-errors \
    && log "copied $(basename "$1") to s3://$BACKUP_S3_BUCKET"
}

prune() { # dir keep (a dump and its attachments archive go together)
  ls -1t "$1"/*.dump 2>/dev/null | tail -n +"$(($2 + 1))" | while read -r old; do
    rm -f "$old" "$(files_of "$old")"
  done
}

backup() { # set: daily | manual
  set_dir="$DIR/$1"
  mkdir -p "$set_dir" "$DIR/weekly"
  chmod 700 "$set_dir" "$DIR/weekly"
  file="$set_dir/madar_$(date +%Y-%m-%d_%H%M).dump"
  pg_dump -Fc -f "$file.partial" || { rm -f "$file.partial"; log "ERROR pg_dump failed"; return 1; }
  mv "$file.partial" "$file"
  # Without its attachments archive the backup is incomplete: the check below then fails it.
  archive_files "$file" || { log "ERROR attachments archive failed"; rm -f "$(files_of "$file").partial"; }
  log "backup written: $1/$(basename "$file") ($(wc -c < "$file") bytes)"
  # A dump that does not restore is kept aside and never replaces a good one.
  check "$file" || {
    mv "$file" "$file.failed"
    if [ -f "$(files_of "$file")" ]; then mv "$(files_of "$file")" "$(files_of "$file").failed"; fi
    return 1
  }
  if [ "$1" = daily ]; then
    # Fridays also go to the weekly set.
    if [ "$(date +%u)" = 5 ]; then
      cp "$file" "$DIR/weekly/"
      if [ -f "$(files_of "$file")" ]; then cp "$(files_of "$file")" "$DIR/weekly/"; fi
    fi
    prune "$DIR/daily" "$KEEP_DAILY"
    prune "$DIR/weekly" "$KEEP_WEEKLY"
  else
    prune "$DIR/manual" "$KEEP_MANUAL"
  fi
  upload "$file" || log "ERROR copy to S3 failed"
  if [ -f "$(files_of "$file")" ]; then
    upload "$(files_of "$file")" || log "ERROR copy of attachments to S3 failed"
  fi
}

seconds_until() { # HH:MM, today or tomorrow
  now=$(date +%s)
  at=$(date -d "$1" +%s)
  [ "$at" -gt "$now" ] || at=$((at + 86400))
  echo $((at - now))
}

case "${1:-loop}" in
  now) backup manual ;;
  check) check "$(ls -1t "$DIR"/daily/*.dump | head -n 1)" ;;
  loop)
    log "nightly backups at $BACKUP_AT ($(date +%Z)), keeping $KEEP_DAILY nightly and $KEEP_WEEKLY weekly"
    while true; do
      sleep "$(seconds_until "$BACKUP_AT")"
      backup daily || log "ERROR nightly backup failed"
    done
    ;;
  *) echo "usage: backup.sh loop|now|check" >&2; exit 2 ;;
esac
