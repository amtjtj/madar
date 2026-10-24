# Madar (مدار)

Madar is a unified work operating system for companies: one shared core (tasks, projects, goals, approvals, reports, gamification) with a module for every department on top of it, plus a private AI layer. Benchmark for UX: Duolingo. Direct competitor: Mizito (Iranian). First customer (pilot): a ~200-person online-gold fintech startup that currently uses Mizito.

The full product brief lives in `docs/brief.md`. Read it before any planning task. The approved architecture is in `docs/architecture.md` and decisions in `docs/decisions/`.

Area-specific rules live next to the code: `apps/web/CLAUDE.md` (UI, fonts, digits, dates, `'use client'`) and `apps/api/CLAUDE.md` (data access, permissions, errors, audit). Read them before working in those areas.

## Golden rules

1. **Plan before code.** For any feature larger than a small fix, write a short plan first and wait for approval.
2. **Small steps.** One feature per change. Each change must leave the app runnable and all checks green.
3. **Tenant isolation is sacred.** No query, cache key, file path, job or AI call may ever mix data between companies.
4. **Persian-first, RTL-first.** Every screen is designed RTL from the start, never mirrored later.
5. **No foreign SaaS dependencies** that can be cut off by sanctions (no Clerk, Firebase, Auth0, Vercel-only features, runtime Google Fonts, external AI APIs for tenant data). Everything must run self-hosted with Docker on an Iranian cloud.
6. **Code and identifiers in English; all user-facing text in Persian**, stored in i18n files (never hardcoded in components).
7. When unsure about a library API, check current docs (Context7) instead of guessing.

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript (strict) everywhere except the AI service |
| Web | Next.js (App Router), Tailwind CSS, shadcn/ui |
| Motion | Framer Motion; Rive for character/celebration animations |
| API | NestJS (modular, one Nest module per domain module) |
| DB | PostgreSQL with Row-Level Security; Drizzle ORM |
| Cache / queues | Redis; BullMQ for background jobs |
| Realtime | WebSocket (Socket.IO via NestJS gateway) |
| Auth | Better Auth, self-hosted; MVP login is admin-issued username + password (phone + SMS OTP later); 2FA (TOTP) required for admins |
| Validation | Zod, schemas shared between web and API |
| AI service | Python, FastAPI, vLLM, pgvector (RAG) |
| Monorepo | Turborepo + pnpm |
| Tests | Vitest (unit), Playwright (e2e) |
| Deploy | Docker Compose (dev), Docker on Iranian cloud (prod) |

Use the latest stable version of each at setup time and record exact versions in `docs/decisions/0001-stack.md`.

## Repository layout

```
apps/
  web/        Next.js app (PWA, responsive, mobile + desktop)
  api/        NestJS API
  ai/         Python AI service (added in phase 3)
packages/
  db/         Drizzle schema, migrations, RLS policies, seed
  shared/     Zod schemas, types, constants, permission definitions
  ui/         Design system components and tokens
  i18n/       Persian strings
  config/     Shared tsconfig, ESLint and Prettier presets
docs/
  brief.md    Product brief (source of truth for scope)
  architecture.md  Approved architecture (read before structural changes)
  pilot-assumptions.md  Assumed facts about the pilot company until confirmed
  decisions/  Architecture decision records (one file per decision)
  feedback/   Approved feedback from team and pilot reviews (requirements and defaults for the next steps)
  plans/      Plan for each step (phase-<n>-step-<m>.md), written before code
  prompts/    The owner's prompts for each phase
```

## Architecture rules

**Multi-tenancy**
- Every tenant-owned table has `tenant_id` and an RLS policy. The API sets the tenant on each DB session; never filter by tenant manually as the only protection.
- Every new table needs an RLS test proving one tenant cannot read another tenant's rows.
- Design so a large tenant can later be moved to its own database without code changes.

**Core and modules**
- Core entities: `Tenant`, `Member`, `Department`, `Role`, `Task`, `Project`, `Goal` / `KeyResult`, `Approval`, `Form`, `Metric`, `Comment`, `Attachment`, `Notification`, `AuditLog`.
- A department module is mostly **configuration** on top of core entities: its own task types, statuses, form fields, approval flows, metrics and dashboard layout. Prefer config over new tables.
- The **department template** lets a tenant admin create a new department module from the UI with no code. Built-in modules (support, marketing, engineering, …) are just pre-made templates plus small custom views.
- Modules talk to each other through core entities and domain events (e.g. a support ticket becomes an engineering bug), never by importing each other's internals.

**Security**
- Role- and department-based permissions defined in `packages/shared`, enforced in the API (UI hiding is not security).
- Append-only `AuditLog` for sensitive actions (permission changes, approvals, exports, deletions).
- Validate every input with Zod. Rate-limit auth and AI endpoints. No secrets in code; use env files that are git-ignored.
- A tenant can be suspended (read-only or locked) for non-payment without deleting data.
- A tenant can export all of its data at any time.
- Implementation rules for data access, permissions, errors and audit: `apps/api/CLAUDE.md`. UI rules: `apps/web/CLAUDE.md`.

## Gamification rules

- Goal: a feeling of progress and recognition, not pressure.
- Mechanics: XP (weighted by managers), streaks (holidays and leave never break them), levels and badges, peer kudos.
- **Red lines:** no public individual ranking that shames the bottom; notifications off outside working hours by default; gamification scores are never wired to salary or firing decisions.

## AI rules

- All AI runs in our own AI service with open-source models. Tenant data never goes to an external AI API.
- RAG indexes are per tenant; retrieval must filter by tenant.
- Waste and automation analysis works at the process/role level, never as a ranking of individual people.

## Workflow for every feature

1. Read the relevant part of `docs/brief.md`.
2. Propose a short plan (data model changes, API, screens, tests). Wait for approval.
3. Write or update tests.
4. Implement.
5. Run typecheck, lint, unit tests and e2e tests. Fix until green.
6. Check the screens in a browser (Playwright MCP) at mobile and desktop widths, in RTL, light and dark.
7. If an architectural choice was made, add a file to `docs/decisions/`.
8. Summarize what changed and what to test manually.

## Commands

Requirements: Node 22.12+ (24 LTS recommended), pnpm 10 (`corepack enable`), Docker for Postgres/Redis.

| Task | Command |
|---|---|
| First setup | `cp .env.example .env && pnpm install && pnpm db:up && pnpm db:migrate && pnpm db:seed` |
| Dev (web :3000, api :4000, worker) | `pnpm dev` |
| Worker only (outbox relay, notifications, reminders, device push, realtime fan-out) | `pnpm --filter @madar/api worker` |
| Build everything | `pnpm build` |
| Typecheck | `pnpm typecheck` |
| Lint | `pnpm lint` |
| Format / check format | `pnpm format` / `pnpm format:check` |
| Unit tests (Vitest) | `pnpm test` |
| E2E tests (Playwright, 360px + 1440px) | `pnpm test:e2e` |
| Everything CI runs before e2e | `pnpm check` |
| Start / stop Postgres + Redis | `pnpm db:up` / `pnpm db:down` |
| Generate a migration from the Drizzle schema | `pnpm db:generate` |
| Apply migrations (also creates the `madar_app` role) | `pnpm db:migrate` |
| Drop everything and re-migrate (development only) | `pnpm db:reset` |
| Seed the demo company «زرین‌مدار» (20 people, 5 projects, ~240 tasks with 8 weeks of history, 9 goals, a few internal letters with a referral, a reply, a confidential letter, a draft and one letter pinned to a task as evidence, chat in a department channel, a project channel (with a screenshot, a PDF, a mention, reactions and a task made from a message), a direct conversation and a group, meetings (today's, a one-on-one, an OKR review with minutes and a decision turned into a task with the minutes pinned to it, a canceled one, and a weekly meeting with replies), requests (an approved leave, an 18M headset expense approved by the manager and waiting on the CEO, an open general request and a rejected one); password `SEED_PASSWORD`) | `pnpm db:seed` |
| Attachments in development | stored in `.data/files` (git-ignored); `STORAGE_DRIVER=s3` with `S3_*` for an S3-compatible service |
| Install the licensed Abar Low fonts (git-ignored) | `pnpm fonts:install <dir-with-AbarLow-files>` |
| Generate Web Push (VAPID) keys for `.env` (after a build) | `pnpm --filter @madar/api vapid:generate` |
| Production: fresh Ubuntu server in one command (`docs/deploy.md` §0) | `scripts/deploy/install.sh <domain> <email> [--demo]` |
| Production: first settings / deploy or update / health (on the server; `docs/deploy.md`) | `scripts/deploy/init-env.sh <domain> <email> [--demo]` / `scripts/deploy/deploy.sh` / `scripts/deploy/status.sh` |
| Production: backup now / restore / smoke-test a demo stack | `scripts/deploy/backup-now.sh` / `scripts/deploy/restore.sh <file>` / `scripts/deploy/smoke.sh [--restore]` |
| The production stack on your own computer, with the demo company at https://localhost (`docs/local-demo.md`) | `scripts/deploy/local-demo.sh [update\|stop\|start\|reset\|remove]` (after new commits: `update`) |
| AI service (apps/ai, Python; needs `uv`): run with the fake model / checks | `pnpm --filter @madar/ai dev:ai` (set `AI_SERVICE_URL=http://localhost:4200`) / its `test`, `lint`, `typecheck` run with `pnpm check` |
| One package only | `pnpm --filter @madar/<name> <script>` (e.g. `pnpm --filter @madar/api test`) |

Notes:
- Internal packages are consumed from their built `dist/`; turbo builds dependencies first. If an import from `@madar/*` looks stale, run `pnpm build`.
- One `.env` at the repo root serves all apps and the DB package. `DATABASE_URL` is the owner (migrations, seed); `APP_DATABASE_URL` is the RLS-bound app role used by the API and tests.
- Integration tests (db, api) need a migrated database; they are skipped when `APP_DATABASE_URL` is missing.
- Without Docker, any local Postgres 16+ and Redis 7+ work; point `DATABASE_URL`/`REDIS_URL` at them.
- If Playwright cannot download its browser, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to a local Chromium.
- Markdown files are not formatted by Prettier (Persian tables); keep them tidy by hand.
- The assistant (ADR 0025) is off unless `AI_SERVICE_URL` is set and the company turns it on; `pnpm dev` does not start the AI service. In production it is the compose profile `ai` plus `llm-cpu` or `llm-gpu` (`docs/deploy.md` §11).
- PostgreSQL needs the pgvector extension (ADR 0026): production and `pnpm db:up` build `madar-postgres:18-pgvector0.8.1` from `docker/postgres.Dockerfile`; a local Postgres needs its pgvector package (Ubuntu: `postgresql-16-pgvector`). With the AI service on, the worker indexes each company every minute (`knowledge-index` queue); `AI_ASK_MAX_DISTANCE=0.9` suits the fake embedding, 0.6 suits bge-m3.
- Production (ADR 0016): `docker/compose.prod.yml` behind Caddy, images from `docker/*.Dockerfile`. A new environment variable the API reads also goes into the `x-app-env` block there, `.env.example` and `scripts/deploy/init-env.sh`. The demo script for the pilot meeting is `docs/demo-script.md`.
