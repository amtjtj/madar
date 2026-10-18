#!/usr/bin/env bash
# One backup now, with its restore check (also run by deploy.sh before every deployment).
set -euo pipefail
source "$(dirname "$0")/lib.sh"
require_env_file
compose exec -T backup /bin/sh /scripts/backup.sh now
