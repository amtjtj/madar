#!/usr/bin/env bash
# One command on a fresh Ubuntu 24.04 server: prepares it and deploys Madar (docs/deploy.md, «راه سریع»).
#   git clone https://github.com/amtjtj/madar.git ~/madar && cd ~/madar
#   scripts/deploy/install.sh demo.example.ir you@example.com --demo   # demo company, nightly reset
#   scripts/deploy/install.sh app.example.ir you@example.com           # a real company, no sample data
# Safe to run again: every step checks whether it is already done.
# Overrides: MADAR_DOCKER_MIRROR=https://… MADAR_NPM_REGISTRY=https://… (skip the mirror search).
set -euo pipefail
source "$(dirname "$0")/lib.sh"
cd "$ROOT"

domain=${1:-}
email=${2:-}
mode=${3:-}
[ -n "$domain" ] || read -r -p "Domain (e.g. demo.example.ir): " domain
[ -n "$email" ] || read -r -p "Email for certificate notices: " email

SUDO=""
[ "$(id -u)" = 0 ] || SUDO=sudo
grep -q 'ID=ubuntu' /etc/os-release 2>/dev/null || fail "this script expects Ubuntu (24.04 recommended)"

# --- 1. Packages ------------------------------------------------------------------------------
say "Installing Docker and basic tools (from the provider's Ubuntu mirror)"
$SUDO apt-get update -y
$SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y git curl ufw ca-certificates \
  docker.io docker-compose-v2 docker-buildx
$SUDO systemctl enable --now docker
docker_cmd() { if docker info >/dev/null 2>&1; then docker "$@"; else $SUDO docker "$@"; fi; }
docker_cmd compose version >/dev/null || fail "docker compose is missing; use Ubuntu 24.04"
docker_cmd buildx version >/dev/null || fail "docker buildx is missing; use Ubuntu 24.04"
if [ "$(id -u)" != 0 ] && ! id -nG | grep -qw docker; then
  $SUDO usermod -aG docker "$USER"
fi

# --- 2. Swap (builds need more memory than running) --------------------------------------------
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$mem_mb" -lt 7500 ] && ! swapon --show | grep -q .; then
  say "Adding a 4 GB swap file (the server has ${mem_mb} MB of memory)"
  $SUDO fallocate -l 4G /swapfile
  $SUDO chmod 600 /swapfile
  $SUDO mkswap /swapfile >/dev/null
  $SUDO swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | $SUDO tee -a /etc/fstab >/dev/null
fi

# --- 3. Firewall: SSH and the web only ---------------------------------------------------------
say "Firewall: allowing SSH, 80 and 443 only"
ssh_port=$(echo "${SSH_CONNECTION:-}" | awk '{print $4}')
$SUDO ufw allow "${ssh_port:-22}/tcp" >/dev/null
$SUDO ufw allow 22/tcp >/dev/null
$SUDO ufw allow 80/tcp >/dev/null
$SUDO ufw allow 443/tcp >/dev/null
$SUDO ufw allow 443/udp >/dev/null
$SUDO ufw --force enable >/dev/null

# --- 4. Docker Hub, or a domestic mirror -------------------------------------------------------
# A reachable registry answers /v2/ with 200 or 401; a sanctioned one with 403 or nothing.
registry_ok() {
  local code
  code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$1/v2/" || true)
  [ "$code" = 200 ] || [ "$code" = 401 ]
}
mirror=${MADAR_DOCKER_MIRROR:-}
if [ -z "$mirror" ] && ! registry_ok https://registry-1.docker.io; then
  say "Docker Hub is not reachable; looking for a domestic mirror"
  for candidate in https://docker.arvancloud.ir https://mirror-docker.runflare.com \
    https://docker.iranserver.com https://registry.docker.ir; do
    if registry_ok "$candidate"; then
      mirror=$candidate
      break
    fi
  done
  [ -n "$mirror" ] || fail "no Docker mirror answered. Ask your provider for one and run again with MADAR_DOCKER_MIRROR=https://…"
fi
if [ -n "$mirror" ]; then
  if [ -s /etc/docker/daemon.json ] && ! grep -q "$mirror" /etc/docker/daemon.json; then
    fail "/etc/docker/daemon.json already has settings; add \"registry-mirrors\": [\"$mirror\"] to it by hand and run again"
  fi
  if ! grep -q "$mirror" /etc/docker/daemon.json 2>/dev/null; then
    say "Using the Docker mirror $mirror"
    echo "{ \"registry-mirrors\": [\"$mirror\"] }" | $SUDO tee /etc/docker/daemon.json >/dev/null
    $SUDO systemctl restart docker
  fi
fi

# --- 5. npm, or a domestic mirror --------------------------------------------------------------
npm_ok() { curl -sf -m 10 -o /dev/null "${1%/}/pnpm"; }
npm=${MADAR_NPM_REGISTRY:-}
if [ -z "$npm" ]; then
  if npm_ok https://registry.npmjs.org; then
    npm=https://registry.npmjs.org/
  else
    say "npm is not reachable; looking for a mirror"
    for candidate in https://mirror-npm.runflare.com https://registry.npmmirror.com; do
      if npm_ok "$candidate"; then
        npm=$candidate/
        break
      fi
    done
    [ -n "$npm" ] || fail "no npm mirror answered. Run again with MADAR_NPM_REGISTRY=https://…"
  fi
fi

# --- 6. Settings -------------------------------------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  if [ "$mode" = --demo ]; then
    scripts/deploy/init-env.sh "$domain" "$email" --demo
  else
    scripts/deploy/init-env.sh "$domain" "$email"
  fi
else
  say "Keeping the existing $ENV_FILE"
fi
sed -i "s|^NPM_REGISTRY=.*|NPM_REGISTRY=$npm|" "$ENV_FILE"

# Licensed fonts, if they were copied to ~/abar (optional; Vazirmatn otherwise).
if ls "$HOME"/abar/AbarLow-*.woff2 >/dev/null 2>&1; then
  mkdir -p apps/web/public/fonts/abar
  cp "$HOME"/abar/AbarLow-*.woff2 apps/web/public/fonts/abar/
  say "Abar fonts installed"
fi

# --- 7. Deploy ---------------------------------------------------------------------------------
server_ip=$(curl -s -m 10 https://api.ipify.org || hostname -I | awk '{print $1}')
dns_ip=$(getent hosts "$domain" | awk '{print $1}' | head -n 1)
if [ -n "$server_ip" ] && [ "$dns_ip" != "$server_ip" ]; then
  printf '\033[33mWarning: %s points to %s, not to this server (%s). HTTPS will work once the DNS A record is right.\033[0m\n' \
    "$domain" "${dns_ip:-nothing}" "$server_ip"
fi

say "Building and starting Madar (the first build takes 5 to 15 minutes)"
if docker info >/dev/null 2>&1; then
  scripts/deploy/deploy.sh --no-pull
else
  # The docker group applies from the next login; use it for this run already.
  sg docker -c "scripts/deploy/deploy.sh --no-pull"
fi

say "Done: https://$domain"
[ "$mode" = --demo ] && say "Demo accounts: leila.sadeghi, maryam.ahmadi, ali.rezaei; password: $(env_value DEMO_PASSWORD)"
say "Keep a copy of $ENV_FILE outside the server (it holds every password)."
say "Later updates: scripts/deploy/deploy.sh  ·  health: scripts/deploy/status.sh"
