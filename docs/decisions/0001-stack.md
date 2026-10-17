# 0001 — Stack and exact versions

- Status: Accepted
- Date: 2026-10-17

## Context
CLAUDE.md fixes the stack; this records the exact versions chosen when the monorepo was scaffolded, and the deviations from "latest" with their reason.

## Versions

| Area | Package | Version | Note |
|---|---|---|---|
| Runtime | Node.js | 22.12+ (24 LTS recommended, `.nvmrc` = 24) | ESM everywhere (`"type": "module"`) |
| Package manager | pnpm | 10.28.0 | `packageManager` field |
| Monorepo | turbo | 2.11.9 | |
| Language | typescript | 6.0.3 | **Not 7.x**: typescript-eslint supports `<6.1` |
| Web | next | 16.4.2 | App Router, Turbopack, `output: 'standalone'` |
| Web | react / react-dom | 19.3.1 | |
| Web | tailwindcss / @tailwindcss/postcss | 4.3.3 | |
| Web | @tanstack/react-query | 5.104.3 | Optimistic UI and caching |
| API | @nestjs/core, common, platform-express, testing | 12.1.3 | ESM; built with plain `tsc` |
| API | reflect-metadata / rxjs | 0.2.2 / 7.8.2 | |
| DB | drizzle-orm / drizzle-kit | 0.45.4 / 0.31.11 | |
| DB | pg | 8.23.1 | |
| Validation | zod | 4.6.7 | Shared contracts in `@madar/shared` |
| Unit tests | vitest | 5.0.5 | `unplugin-swc` 2.0.0 + `@swc/core` 1.16.18 for Nest decorator metadata |
| API tests | supertest | 7.3.1 | |
| E2E | @playwright/test | 1.64.1 | Projects: mobile 360px, desktop 1440px |
| Lint | eslint | 9.39.5 | **Not 10.x**: eslint-config-next's plugins (react, import, jsx-a11y) declare `eslint <=9` |
| Lint | typescript-eslint | 8.71.2 | `strict` preset |
| Lint | eslint-config-next | 16.4.2 | core-web-vitals |
| Format | prettier | 3.9.10 | Markdown excluded |
| Dev services | postgres / redis images | 18-alpine / 8-alpine | Any Postgres 16+ works locally |
| Claude Code MCP | @upstash/context7-mcp / @playwright/mcp | 4.4.2 / 0.0.83 | `.mcp.json` |

Better Auth (1.7.x at time of writing), BullMQ, Socket.IO, shadcn/ui, Framer Motion and Vazirmatn are added in the step that first needs them and recorded here.

## Decisions taken during scaffolding
- **No Nest CLI.** `@nestjs/cli` 12 requires Node ≥ 22.22.3 and adds webpack/schematics we do not need; the API builds with `tsc` and runs dev with `tsc --watch` + `node --watch` (via `concurrently`).
- **Internal packages are built** to `dist/` (ESM + `.d.ts`) instead of exporting TS sources, so both Node (API) and Next consume the same artifacts. Turbo builds dependencies before `dev`, `typecheck`, `lint` and `test`.
- **Contract binding:** for now controllers return types from `@madar/shared` and the web validates responses with the same Zod schemas. Choosing ts-rest vs nestjs-zod is deferred to the first endpoint with a request body (phase 1, step 4).
- **Telemetry off** (`NEXT_TELEMETRY_DISABLED`, `TURBO_TELEMETRY_DISABLED`): no calls to foreign services.
- **Dev proxy:** Next rewrites `/api/*` to the API in dev/e2e; Caddy does it in production. Rewrites are resolved at build time.
- **RTL guard:** an ESLint rule rejects physical Tailwind direction utilities in web code.

## Consequences
- Upgrade TypeScript to 7 and ESLint to 10 when typescript-eslint and eslint-config-next support them.
