# Madar (مدار)

Madar is a unified work operating system for companies: one shared core (tasks, projects, goals, approvals, reports, gamification) with a module for every department on top of it, plus a private AI layer. Benchmark for UX: Duolingo. Direct competitor: Mizito (Iranian). First customer (pilot): a ~200-person online-gold fintech startup that currently uses Mizito.

The full product brief lives in `docs/brief.md`. Read it before any planning task. The approved architecture is in `docs/architecture.md` and decisions in `docs/decisions/`.

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
- All tenant data access goes through `withTenant()` from `@madar/db` (API: `TenantDb.run(ctx, …)`); raw `pg` imports are lint errors in the API.
- New data-plane tables: composite `(tenant_id, x)` foreign keys and `select app.enable_tenant_rls('<table>')` in the migration (the catalog meta-test enforces it).
- Sensitive changes call `TenantDb.audit()` inside the same transaction (ADR 0009).
- API errors carry codes only (`{ error: { code } }`); the web maps them to Persian in `apps/web/src/lib/errors.ts` and `errors.*` strings.

## UI and UX rules

- Mobile-first; every screen must work at 360px width and on desktop.
- RTL with Tailwind logical utilities (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`). Never use `ml-*`, `mr-*`, `left-*`, `right-*` for layout.
- Jalali (Shamsi) calendar for all dates shown to users; store UTC in the DB.
- Persian digits in the UI; Latin digits in code and data.
- Font: **Abar Low** (Fontiran, licensed; weights 100/300/400/700/900), self-hosted from `apps/web/public/fonts/abar/`. The font files are **never committed** (commercial license, public repo): install them per environment with `pnpm fonts:install <dir>`. Without them the UI falls back to Vazirmatn (open license, in git).
- Optimistic UI for user actions; skeletons instead of spinners; a designed empty state for every list.
- Animations must be short (under 400ms for UI feedback) and never block input.
- Light and dark themes via design tokens; no hardcoded colors in components.
- Home screen per role: an employee knows what to do today within 10 seconds; a CEO understands company status within 30 seconds.
- Build screens from `@madar/ui` (see `/design-system` and `docs/decisions/0008-design-system.md`). Colors only through tokens (`bg-surface`, `text-ink`, `bg-primary`, …); add a token before adding a color.
- Dates: `formatJalaliDate`, `formatTime`, `formatRelativeTime` from `@madar/shared` (tenant timezone, default `Asia/Tehran`). Numbers: `formatNumber`, `formatPercent`, `toPersianDigits`; normalize user input with `toLatinDigits`. The font does **not** convert digits.
- A `'use client'` file exports only components, hooks and types. Constants, helpers and `cva` variants go in a plain module, because server components receive client-module values as references, not values (this caused a production-only hydration error once).
- Next.js 16 docs ship inside `node_modules/next/dist/docs/` (see `apps/web/AGENTS.md`); check them before using an unfamiliar Next API.

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
| Dev (web :3000, api :4000) | `pnpm dev` |
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
| Seed the demo company «زرین‌مدار» (20 people; password `SEED_PASSWORD`) | `pnpm db:seed` |
| Install the licensed Abar Low fonts (git-ignored) | `pnpm fonts:install <dir-with-AbarLow-files>` |
| One package only | `pnpm --filter @madar/<name> <script>` (e.g. `pnpm --filter @madar/api test`) |

Notes:
- Internal packages are consumed from their built `dist/`; turbo builds dependencies first. If an import from `@madar/*` looks stale, run `pnpm build`.
- One `.env` at the repo root serves all apps and the DB package. `DATABASE_URL` is the owner (migrations, seed); `APP_DATABASE_URL` is the RLS-bound app role used by the API and tests.
- Integration tests (db, api) need a migrated database; they are skipped when `APP_DATABASE_URL` is missing.
- Without Docker, any local Postgres 16+ and Redis 7+ work; point `DATABASE_URL`/`REDIS_URL` at them.
- If Playwright cannot download its browser, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to a local Chromium.
- Markdown files are not formatted by Prettier (Persian tables); keep them tidy by hand.
- ESLint forbids physical Tailwind classes (`ml-*`, `left-*`, `text-right`, …) in web code.
