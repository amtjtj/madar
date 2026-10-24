# 0016 — Production deployment on an Iranian cloud server

- Status: Accepted
- Date: 2026-10-18

## Context
Phase 1, step 9 (`docs/plans/phase-1-step-9.md`). The pilot company must see Madar on their own phones before phase 2 is prioritised. That means a real HTTPS server, on an Iranian cloud, set up by someone who may be doing it for the first time.

Constraints:
- Docker Hub and npm may be blocked from the server.
- Browsers' push services are abroad.
- Nothing may depend on a foreign SaaS (golden rule 5).

## Decision
- **One VM, Docker Compose.** `docker/compose.prod.yml` runs:
  - postgres 18 and redis 8, internal only;
  - a one-shot `migrate`;
  - `api`, `worker` and `web`;
  - `backup`;
  - `caddy`, the only service with published ports (80, 443 TCP/UDP);
  - `demo`, in the `demo` profile.

  Every service restarts unless stopped and rotates its logs (5 × 10 MB). The recommended server is 4 vCPU, 8 GB RAM, 80 GB SSD and Ubuntu 24.04, in a domestic datacenter. Shared hosting cannot run it.
- **Images:**
  - `madar-api` serves api, worker and migrate with three commands. It holds only the API's production dependencies, via `pnpm deploy --prod`. better-auth's optional peers (Next.js, React, Vitest) resolve to the workspace copies, so they are deleted from the image; the API never imports them. Size went from 1.3 GB to 510 MB.
  - `madar-web` is the Next.js standalone server (336 MB), with the fonts baked in. The licensed Abar files are installed on the server before the build and never committed.

  Both images are multi-stage, `node:24-alpine`, run as a non-root user, and carry healthchecks. Images are tagged with the commit so `deploy.sh --rollback` can start the previous one.
- **Sanctions:**
  - The base image registry (`BASE_REGISTRY`) and the npm registry (`NPM_REGISTRY`) are build arguments, pointed at the provider's domestic mirrors.
  - A proxy's CA can be passed as a build secret (`MADAR_BUILD_CA`), and outbound proxy variables are forwarded to the build.
  - `docker save` / `docker load` covers a server with no registry at all.
  - Images are built on the server, so nothing is pulled from abroad at run time.
- **Caddy, one domain (ADR 0006):**
  - automatic HTTPS, or the operator's own certificate (`CADDY_TLS`), or `tls internal` for local tests;
  - HTTP/2 and HTTP/3, zstd/gzip;
  - HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` and `Permissions-Policy`;
  - a Content-Security-Policy, report-only at first and enforced since 2026-10-24 once the main screens ran without violations (Zod runs `jitless` in the browser, so no `unsafe-eval` is needed);
  - a request id passed to the API;
  - a JSON access log without query strings.
- **Configuration:** `scripts/deploy/init-env.sh` writes `.env` with random passwords for the owner, app and worker roles, plus the auth secret and signup code. The first `deploy.sh` adds our own VAPID keys. In production the API and worker refuse to start with development secrets, an http origin, no signup code or a development database password.
- **Migrations:** the `migrate` service runs before api and worker start (`service_completed_successfully`). Migrations are forward-only. `deploy.sh` takes a backup before every deployment.
- **Backups:** the `backup` service uses the postgres image, so `pg_dump` matches the server version.
  - It runs nightly at 03:30 Tehran and keeps 7 daily and 4 weekly copies.
  - Every new dump is restored into a scratch database and its row counts are compared with the live one. The result goes to `backups/last-check.json`, which `status.sh` shows.
  - It can optionally copy each dump to S3-compatible storage at the provider.
  - Deploy-time and manual dumps go to `manual/` (last 5), so they never push out the nightly copies. A dump that fails its restore check is kept aside as `.failed` and never replaces a good one.
  - `restore.sh` takes a safety dump, restores into a separate database, and swaps it in only after a complete restore; the old database stays as `<db>_before_restore`.
- **Monitoring without external services:**
  - `/api/health` reports database, Redis and worker. The worker refreshes a heartbeat key in Redis every 30 s.
  - Container healthchecks cover api, worker and web.
  - Logs are JSON with request ids; secrets, cookies and query strings are never logged.
  - `status.sh` gives one screen of state.
  - `smoke.sh` checks a running demo stack: only Caddy publishes ports, a Playwright smoke test over HTTPS at 360 and 1440 px (three roles, a live WebSocket hint, the weekly report), a backup with its restore check, and with `--restore` a full restore drill. CI runs it on every push against images built from that commit.
- **Sign-in rate limit:** 20 attempts per minute per IP, up from 5. A whole office signs in from one address around 9:00; the smoke test hit the old limit exactly that way. A per-account limit or backoff (against slow guessing of one account) is a phase 2 follow-up.
- **Hardening:** app containers run as `node` with `no-new-privileges`. Postgres and Redis sit on a `data` network that the web container is not on. Dumps are readable by root only. The demo reset also refuses inside the database if any company other than the demo one exists, so a demo flag left in a real server's `.env` cannot empty it.
  - Alerts (SMS or a messenger) are left for phase 2, as the owner decided.
- **Demo mode** (`DEMO_MODE=true`, `COMPOSE_PROFILES=demo`):
  - the demo company may be seeded in production, with its own random `DEMO_PASSWORD`;
  - the `demo` service empties the data tables and seeds again every night at 05:00 Tehran, so dates stay relative to today and every meeting starts clean (owner's decision);
  - `demo-reset.js` refuses to run without demo mode.

## Measurements (production build, demo data, 360 px, CPU slowed 4×, service worker off)

| Home screen ready | 4G (9 Mbps, 60 ms) | 3G (1.6 Mbps, 300 ms) |
|---|---|---|
| CEO, first visit | 1.9 s | 5.1 s |
| CEO, repeat visit | 0.9 s | 1.9 s |
| Employee, first visit | 2.1 s | 5.2 s |
| Employee, repeat visit | 0.9 s | 1.8 s |

The brief's target (under 2 s) holds on 4G and on repeat visits. A first visit on slow 3G is the follow-up: a smaller JavaScript bundle per route and pre-caching the app shell's static files in the service worker.

## Alternatives considered
- **Kubernetes or a PaaS** (for example a domestic managed container platform): more moving parts than a 200-person pilot needs. The images run there unchanged if that is ever wanted.
- **Nginx with certbot:** two tools and more configuration where Caddy is one, with automatic renewal.
- **Building images in CI and pulling them:** GitHub's registry may be unreachable from Iranian servers. Building on the server with domestic mirrors avoids that; `docker save` is the fallback.
- **WAL archiving / point-in-time recovery:** better recovery points, but more to operate. Nightly dumps with a verified restore are enough for the pilot. Revisit before real customer data grows.
- **Hosted monitoring** (Sentry, Grafana Cloud): foreign SaaS. A self-hosted stack such as Uptime Kuma or Grafana can come later behind the same Caddy.

## Update (production readiness pass, 2026-10-24)
- `docker/caddy` and `docker/backup` are mounted as folders, not single files: `git pull` replaces files, and a single-file bind mount keeps showing the old file until the container is recreated. `deploy.sh` now reloads Caddy (graceful) and restarts the backup loop after every deployment, so a changed `Caddyfile` or `backup.sh` takes effect.
- The Content-Security-Policy is enforced (it was report-only); the web app runs Zod `jitless` so no `unsafe-eval` is needed.
- `docker/postgres.Dockerfile` trusts `MADAR_BUILD_CA` for `apk` too (only for that build step; the image keeps the stock bundle).
- `.env.production.example` documents every production variable; `init-env.sh` still writes the real `.env`.
- Verified end to end on a fresh clone: install, build, deploy, signup with 2FA, files, update with a pre-deploy backup, backup and restore, crash and Docker-restart recovery, rollback.
