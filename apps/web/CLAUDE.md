# Web app (apps/web)

Rules for the Next.js app and the design system. The root `CLAUDE.md` (golden rules, stack, workflow, commands) still applies.

@AGENTS.md

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
- Dates: `formatJalaliDate`, `formatTime`, `formatRelativeTime` from `@madar/shared` (tenant timezone, default `Asia/Tehran`). Calendar dates (due dates, plan days) are `YYYY-MM-DD` strings: `calendarDateIn`, `formatCalendarDate`, `addDays`, `dueStatus`.
- Never put `·` right next to a number in UI text: in Persian fonts it looks like the digit zero (۰). Use «،» or parentheses. Numbers: `formatNumber`, `formatPercent`, `toPersianDigits`; normalize user input with `toLatinDigits`. The font does **not** convert digits.
- A `'use client'` file exports only components, hooks and types. Constants, helpers and `cva` variants go in a plain module, because server components receive client-module values as references, not values (this caused a production-only hydration error once).
- Next.js 16 docs ship inside `node_modules/next/dist/docs/` (see `apps/web/AGENTS.md`); check them before using an unfamiliar Next API.
- ESLint forbids physical Tailwind classes (`ml-*`, `left-*`, `text-right`, …) in web code.
- PWA (ADR 0012): the service worker is built from `src/lib/service-worker.ts` and served by `app/sw.js/route.ts`; it must never cache pages or API responses. New public files the browser fetches without a session (icons, manifest) need an exclusion in `src/proxy.ts`. Regenerate icons after a logo change with `node scripts/icons.mjs`.
