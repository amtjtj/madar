#!/usr/bin/env bash
# One screen of health: containers, API health, last backup and its restore check, disk, errors.
set -uo pipefail
source "$(dirname "$0")/lib.sh"
require_env_file

say "Containers"
compose ps --format 'table {{.Service}}\t{{.Status}}'

say "API health"
compose exec -T api node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>r.json()).then(b=>console.log(b.status, JSON.stringify(b.dependencies), 'version', b.version)).catch(e=>{console.log('unreachable', e.message);process.exit(1)})" \
  || echo "API is not answering"

say "Last backup"
if [ -f "$ROOT/backups/last-check.json" ]; then
  sed 's/,"restored".*/}/' "$ROOT/backups/last-check.json"
else
  echo "No backup yet (the first one runs at $(env_value BACKUP_AT || echo 03:30) Tehran time)."
fi

say "Disk"
df -h "$ROOT" | tail -n 1
du -sh "$ROOT/backups" 2>/dev/null

say "Errors in the last 24 hours"
for s in api worker web backup; do
  n=$(compose logs --since 24h --no-log-prefix "$s" 2>/dev/null | grep -cE '"level":"(error|fatal)"|ERROR' || true)
  printf '%-8s %s\n' "$s" "$n"
done
