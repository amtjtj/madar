#!/usr/bin/env bash
# Builds and (re)starts Madar (docs/deploy.md). Safe to run again for every update.
#   scripts/deploy/deploy.sh               pull the code, back up, build, migrate, start
#   scripts/deploy/deploy.sh --no-pull     deploy the code as it is on disk
#   scripts/deploy/deploy.sh --rollback    start the images of the previous deployment again
set -euo pipefail
source "$(dirname "$0")/lib.sh"
require_env_file
cd "$ROOT"

pull=1
case "${1:-}" in
  --no-pull) pull=0 ;;
  --rollback)
    previous=$(cat .deploy/previous 2>/dev/null || true)
    [ -n "$previous" ] || fail "no previous deployment recorded"
    say "Rolling back to $previous (migrations are not undone; restore a backup if needed)"
    MADAR_TAG=$previous compose up -d --wait
    cp .deploy/previous .deploy/current
    exit 0
    ;;
  "") ;;
  *) fail "unknown option: $1" ;;
esac

if [ "$pull" = 1 ] && [ -d .git ]; then
  say "Fetching the latest code"
  git pull --ff-only
fi
tag=$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M)

# Back up before touching anything, if the stack is already running.
if compose ps --status running --services 2>/dev/null | grep -qx backup; then
  say "Backing up before the deployment"
  compose exec -T backup /bin/sh /scripts/backup.sh now
fi

registry=$(env_value BASE_REGISTRY)
npm_registry=$(env_value NPM_REGISTRY)
build_args=(--build-arg "BASE_REGISTRY=${registry:-docker.io/library}"
  --build-arg "NPM_REGISTRY=${npm_registry:-https://registry.npmjs.org/}"
  --build-arg "APP_VERSION=$tag")
# A proxy's CA certificate, if builds go through one.
[ -n "${MADAR_BUILD_CA:-}" ] && build_args+=(--secret "id=ca,src=$MADAR_BUILD_CA")
[ -n "${MADAR_BUILD_NETWORK:-}" ] && build_args+=(--network "$MADAR_BUILD_NETWORK")
# An outbound proxy for the build, if the server needs one.
for var in HTTPS_PROXY HTTP_PROXY NO_PROXY; do
  [ -n "${!var:-}" ] && build_args+=(--build-arg "$var=${!var}")
done

say "Building images ($tag)"
docker build "${build_args[@]}" -f docker/api.Dockerfile -t "madar-api:$tag" -t madar-api:latest .
docker build "${build_args[@]}" -f docker/web.Dockerfile -t "madar-web:$tag" -t madar-web:latest .

# First deployment: our own Web Push keys.
if [ -z "$(env_value VAPID_PUBLIC_KEY)" ]; then
  say "Generating Web Push (VAPID) keys"
  keys=$(docker run --rm "madar-api:$tag" node dist/scripts/vapid.js)
  pub=$(echo "$keys" | grep VAPID_PUBLIC_KEY | cut -d= -f2-)
  priv=$(echo "$keys" | grep VAPID_PRIVATE_KEY | cut -d= -f2-)
  sed -i "s|^VAPID_PUBLIC_KEY=.*|VAPID_PUBLIC_KEY=$pub|; s|^VAPID_PRIVATE_KEY=.*|VAPID_PRIVATE_KEY=$priv|" "$ENV_FILE"
fi

mkdir -p .deploy backups
[ -f .deploy/current ] && cp .deploy/current .deploy/previous
say "Starting (migrations run first)"
MADAR_TAG=$tag compose up -d --wait --remove-orphans
echo "$tag" > .deploy/current

if [ "$(env_value DEMO_MODE)" = true ] && [ ! -f .deploy/demo-seeded ]; then
  say "Seeding the demo company"
  compose exec -T demo node dist/scripts/demo-reset.js && touch .deploy/demo-seeded
fi

"$ROOT/scripts/deploy/status.sh"
