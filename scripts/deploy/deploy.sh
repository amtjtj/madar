#!/usr/bin/env bash
# Builds and (re)starts Madar (docs/deploy.md). Safe to run again for every update.
#   scripts/deploy/deploy.sh                 pull the code, back up, build, migrate, start
#   scripts/deploy/deploy.sh --no-pull       deploy the code as it is on disk
#   scripts/deploy/deploy.sh --no-build TAG  start images loaded with `docker load` (docs §9)
#   scripts/deploy/deploy.sh --rollback      start the images of the previous deployment again
set -euo pipefail
source "$(dirname "$0")/lib.sh"
require_env_file
cd "$ROOT"

pull=1
build=1
tag=""
case "${1:-}" in
  --no-pull) pull=0 ;;
  --no-build)
    pull=0
    build=0
    tag=${2:-latest}
    ;;
  --rollback)
    previous=$(cat .deploy/previous 2>/dev/null || true)
    [ -n "$previous" ] || fail "no previous deployment recorded"
    say "Rolling back to $previous (migrations are not undone; restore a backup if needed)"
    MADAR_TAG=$previous compose up -d --wait
    cp .deploy/current .deploy/previous
    echo "$previous" > .deploy/current
    exit 0
    ;;
  "") ;;
  *) fail "unknown option: $1" ;;
esac

if [ "$pull" = 1 ] && [ -d .git ]; then
  say "Fetching the latest code"
  git pull --ff-only
  # The pull may have changed this script: continue with the new version.
  exec "$0" --no-pull
fi

if [ "$build" = 1 ]; then
  docker buildx version >/dev/null 2>&1 \
    || fail "Docker BuildKit (buildx) is missing: sudo apt install docker-buildx (docs/deploy.md §2)"
  if [ -d .git ]; then
    tag=$(git rev-parse --short HEAD)
    # Local edits get their own tag, so they never overwrite the image of a clean commit.
    git diff --quiet HEAD || tag="$tag-dirty-$(date +%H%M%S)"
  else
    # A downloaded copy (ZIP) has no git history; on macOS even asking git would pop up an installer.
    tag=build-$(date +%Y%m%d%H%M%S)
  fi
else
  docker image inspect "madar-api:$tag" "madar-web:$tag" "$POSTGRES_IMAGE" >/dev/null \
    || fail "images madar-api:$tag, madar-web:$tag and $POSTGRES_IMAGE are not loaded (docker load)"
  if ai_enabled; then
    docker image inspect "madar-ai:$tag" >/dev/null 2>&1 \
      || fail "image madar-ai:$tag is not loaded (docker load), or remove ai from COMPOSE_PROFILES"
  fi
fi

# Back up before touching anything, if the stack is already running.
if compose ps --status running --services 2>/dev/null | grep -qx backup; then
  say "Backing up before the deployment"
  compose exec -T backup /bin/sh /scripts/backup.sh now
fi

if [ "$build" = 1 ]; then
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
  # PostgreSQL with pgvector (ADR 0026): its tag is its version, so it is built once and the
  # database is restarted only when that version changes.
  if ! docker image inspect "$POSTGRES_IMAGE" >/dev/null 2>&1; then
    say "Building $POSTGRES_IMAGE"
    docker build "${build_args[@]}" -f docker/postgres.Dockerfile -t "$POSTGRES_IMAGE" .
  fi
  say "Building images ($tag)"
  docker build "${build_args[@]}" -f docker/api.Dockerfile -t "madar-api:$tag" .
  docker build "${build_args[@]}" -f docker/web.Dockerfile -t "madar-web:$tag" .
  if ai_enabled; then
    pip_index=$(env_value PIP_INDEX_URL)
    docker build "${build_args[@]}" --build-arg "PIP_INDEX_URL=${pip_index:-https://pypi.org/simple}" \
      -f docker/ai.Dockerfile -t "madar-ai:$tag" .
  fi
fi

# First deployment: our own Web Push keys.
if [ -z "$(env_value VAPID_PUBLIC_KEY)" ]; then
  say "Generating Web Push (VAPID) keys"
  keys=$(docker run --rm "madar-api:$tag" node dist/scripts/vapid.js)
  pub=$(echo "$keys" | grep VAPID_PUBLIC_KEY | cut -d= -f2-)
  priv=$(echo "$keys" | grep VAPID_PRIVATE_KEY | cut -d= -f2-)
  # -i.bak works with both GNU (Linux) and BSD (macOS) sed.
  sed -i.bak "s|^VAPID_PUBLIC_KEY=.*|VAPID_PUBLIC_KEY=$pub|; s|^VAPID_PRIVATE_KEY=.*|VAPID_PRIVATE_KEY=$priv|" "$ENV_FILE"
  rm -f "$ENV_FILE.bak"
fi

mkdir -p .deploy backups
say "Starting (migrations run first)"
MADAR_TAG=$tag compose up -d --wait --remove-orphans
# Only a deployment that came up healthy becomes current (and `latest`).
current=$(cat .deploy/current 2>/dev/null || true)
if [ "$current" != "$tag" ]; then
  [ -n "$current" ] && echo "$current" > .deploy/previous
  echo "$tag" > .deploy/current
fi
docker tag "madar-api:$tag" madar-api:latest
docker tag "madar-web:$tag" madar-web:latest
ai_enabled && docker tag "madar-ai:$tag" madar-ai:latest

if [ "$(env_value DEMO_MODE)" = true ] && [ ! -f .deploy/demo-seeded ]; then
  say "Seeding the demo company"
  compose exec -T demo node dist/scripts/demo-reset.js && touch .deploy/demo-seeded
fi

# Keep the images of the current and previous deployments (and one more); free old build cache.
keep=$(printf '%s\n' "$tag" "$(cat .deploy/previous 2>/dev/null || true)" latest)
for repo in madar-api madar-web madar-ai; do
  docker image ls "$repo" --format '{{.Tag}}' | grep -vxF "$keep" | tail -n +2 \
    | xargs -r -I{} docker image rm "$repo:{}" >/dev/null 2>&1 || true
done
docker builder prune -f --filter until=168h >/dev/null 2>&1 || true

"$ROOT/scripts/deploy/status.sh"
