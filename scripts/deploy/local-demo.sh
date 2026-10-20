#!/usr/bin/env bash
# Madar on your own computer (docs/local-demo.md): the production stack with the demo company at
# https://localhost, a local certificate and its own settings file (.env.local-demo), so it never
# touches a developer's .env.
#   scripts/deploy/local-demo.sh            first run: build, start, seed the demo
#   scripts/deploy/local-demo.sh update     get the latest code, rebuild, refresh the demo data
#   scripts/deploy/local-demo.sh stop       stop (data stays)
#   scripts/deploy/local-demo.sh start      start again
#   scripts/deploy/local-demo.sh reset      fresh demo data
#   scripts/deploy/local-demo.sh remove     delete the containers and all their data
# Behind sanctions, set mirrors on the first run, e.g.:
#   MADAR_BASE_REGISTRY=<docker mirror>/library MADAR_NPM_REGISTRY=<npm mirror> scripts/deploy/local-demo.sh
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
export MADAR_ENV_FILE=${MADAR_ENV_FILE:-$ROOT/.env.local-demo}
export MADAR_PROJECT=${MADAR_PROJECT:-madar-local}
source "$ROOT/scripts/deploy/lib.sh"

command -v docker >/dev/null || fail "Docker is not installed (docs/local-demo.md, step 1)"
docker info >/dev/null 2>&1 || fail "Docker is not running: start Docker Desktop first"

show() {
  say "Ready: https://localhost  (the browser warns once about the local certificate: accept it)"
  echo "    version: $(git -C "$ROOT" log -1 --format='%h  %cd  %s' --date=format:'%Y-%m-%d %H:%M')"
  echo "    CEO: leila.sadeghi    manager: maryam.ahmadi    employee: ali.rezaei"
  echo "    password: $(env_value DEMO_PASSWORD)"
}

case "${1:-up}" in
  up)
    if [ ! -f "$ENV_FILE" ]; then
      "$ROOT/scripts/deploy/init-env.sh" localhost demo@localhost --demo
      sed -i.bak "s|^CADDY_TLS=.*|CADDY_TLS=tls internal|" "$ENV_FILE"
      [ -n "${MADAR_BASE_REGISTRY:-}" ] && sed -i.bak "s|^BASE_REGISTRY=.*|BASE_REGISTRY=$MADAR_BASE_REGISTRY|" "$ENV_FILE"
      [ -n "${MADAR_NPM_REGISTRY:-}" ] && sed -i.bak "s|^NPM_REGISTRY=.*|NPM_REGISTRY=$MADAR_NPM_REGISTRY|" "$ENV_FILE"
      rm -f "$ENV_FILE.bak"
    fi
    "$ROOT/scripts/deploy/deploy.sh" --no-pull
    show
    ;;
  update)
    # The code on disk is what runs: pull first, then build, then fresh demo data, so new
    # features also have their sample data (the demo is otherwise seeded only once).
    git -C "$ROOT" fetch origin main || fail "Could not reach GitHub to get the latest code"
    git -C "$ROOT" checkout main >/dev/null 2>&1 || fail "Could not switch to main (local changes? see git status)"
    git -C "$ROOT" pull --ff-only origin main ||
      fail "Could not update: there are local changes (git status). Keep them with 'git stash', or drop them with 'git checkout -- .'"
    "$ROOT/scripts/deploy/deploy.sh" --no-pull
    say "Refreshing the demo data for the new version"
    compose exec -T demo node dist/scripts/demo-reset.js
    show
    ;;
  stop) compose stop && say "Stopped. Start again with: scripts/deploy/local-demo.sh start" ;;
  start) compose up -d --wait && show ;;
  reset) compose exec -T demo node dist/scripts/demo-reset.js && show ;;
  remove)
    confirm "This deletes the local demo and all its data."
    compose --profile demo down -v
    rm -f "$ENV_FILE" "$ROOT/.deploy/demo-seeded"
    say "Removed."
    ;;
  *) fail "usage: local-demo.sh [up|update|stop|start|reset|remove]" ;;
esac
