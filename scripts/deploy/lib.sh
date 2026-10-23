# Shared helpers for the deploy scripts (sourced, not run).
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
ENV_FILE=${MADAR_ENV_FILE:-$ROOT/.env}
PROJECT=${MADAR_PROJECT:-madar}
# The settings file is the only source of these: compose lets a variable of the calling shell win
# over --env-file, so one exported by a CI job or a developer's shell would point the stack at the
# wrong database or secrets.
unset DATABASE_URL APP_DATABASE_URL WORKER_DATABASE_URL REDIS_URL AUTH_SECRET VAPID_PUBLIC_KEY \
  VAPID_PRIVATE_KEY AI_SERVICE_URL AI_SERVICE_TOKEN
# PostgreSQL with pgvector (docker/postgres.Dockerfile); keep in step with docker/compose.prod.yml.
POSTGRES_IMAGE=madar-postgres:18-pgvector0.8.1
# Compose runs the images of the current deployment, never whatever was built last.
export MADAR_TAG=${MADAR_TAG:-$(cat "$ROOT/.deploy/current" 2>/dev/null || echo latest)}

compose() {
  docker compose --env-file "$ENV_FILE" -f "$ROOT/docker/compose.prod.yml" -p "$PROJECT" "$@"
}

# Reads one variable from the env file without executing it; empty (not an error) when missing,
# so `x=$(env_value KEY)` never stops a script running with `set -e -o pipefail`.
env_value() {
  { grep -E "^$1=" "$ENV_FILE" 2>/dev/null || true; } | tail -n 1 | cut -d= -f2-
}

# The assistant's `ai` profile is on (COMPOSE_PROFILES in .env, comma-separated).
ai_enabled() {
  case ",$(env_value COMPOSE_PROFILES)," in *,ai,*) return 0 ;; *) return 1 ;; esac
}

say() { printf '\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[31mError: %s\033[0m\n' "$*" >&2; exit 1; }

confirm() {
  [ "${MADAR_YES:-}" = 1 ] && return 0
  read -r -p "$1 Type 'yes' to continue: " answer
  [ "$answer" = yes ] || fail "cancelled"
}

require_env_file() {
  [ -f "$ENV_FILE" ] || fail "$ENV_FILE not found. Run scripts/deploy/init-env.sh first."
}
