# 0015 — Weekly reports and PDF export

- Status: Accepted
- Date: 2026-10-18

## Context
Phase 1, step 8b (`docs/plans/phase-1-step-8b.md`). The brief asks for an automatic weekly summary of each team and the whole company, so managers stop writing reports by hand. The CEO wants to take it to a board meeting as a PDF.

## Decision
- **One builder, two uses:** `apps/api/src/reports/builder.ts` (`buildWeeklyReport`) builds both the live «this week so far» view and the stored end-of-week snapshot. It uses the step 8 definitions (`dashboard-rules.ts`, `conditions.ts`, `at-risk.ts`). Weeks run Saturday to Friday in the tenant's time zone (`weekStartOf`, `weekEndOf`).
- **Snapshots:** `weekly_reports` holds one row per tenant, scope and week (unique, `NULLS NOT DISTINCT` on the department). The data is `jsonb` validated by the `weeklyReport` Zod contract (`version: 1`).
  - The table is append-only for the app role (SELECT and INSERT). The report a manager showed in a meeting never changes later, and "overdue at the end of the week" cannot be rebuilt afterwards anyway.
  - Forced RLS, composite foreign keys, and an isolation test like every data-plane table.
- **Shared view:** a report is read by several people, so it contains only what all its readers may see. That means no tasks of private projects, no individual goals (they feed the goal rollup but never appear), and no per-person counts. A department report counts only that department's tasks, even inside at-risk projects. Names appear only next to finished «highlights», as recognition; stuck work carries no names (the team dashboard shows owners to the manager).
- **The week as it ended:** a stored report describes the week at Friday 24:00 even though it is built later. A task finished after the week still counts as open (and overdue) at its end. Goal progress and its change are rebuilt from check-ins before and after the week, blending child goals the way `recomputeGoalChain` does.
- **Running week:** «this week so far» compares with the same stretch of last week, not all of it, so Saturday morning does not look like a collapse.
- **When:** the scheduler (every 15 minutes, next to reminders) stores last week's reports once the tenant's first working day of the week has started, using the step 6 working calendar and holidays. Then it sends `weekly_report_ready` through `Notifier`, so quiet hours, muting and Web Push apply.
  - Recipients: the owner and the «مدیریت ارشد» (executive) role get the company report. Each department's head and managers get their department's report. Oversight departments can read reports but get no notification.
  - Idempotent: existing rows are skipped before anything is built, plus `onConflictDoNothing` and dedupe key `weekly_report:{id}`. Each snapshot is validated with the Zod contract before it is stored, because the table is append-only.
  - Weeks missed while the worker was down, or a week that was all holidays (Nowruz), are filled in, up to 4 weeks back. Only the latest week notifies.
  - A tenant or department created after a week gets no report for it.
  - A push notification opens `/reports?report=<id>`; `GET /api/reports/weekly/:id/ref` turns the id into scope and week, for the report's readers only.
- **Access:** one rule, `readsReport()` in `work/access.ts`, used by the API and the notifier. The company report goes to anyone who sees the company dashboard. A department report goes to that department's head and managers, plus company readers. Past weeks are served from snapshots (404 when none exist), the current week is built live, and future weeks are rejected.
- **PDF = browser print:** «دریافت PDF» calls `window.print()`. Print CSS sets A4 pages, Persian page numbers (`counter(page, persian)`), hides the navigation and controls, adds a header with the company and the week, avoids breaking cards across pages, and forces the light theme on `beforeprint`.
  - Persian fonts, RTL and charts print exactly as on screen, and the server gains nothing to run or secure.

## Alternatives considered
- Server-side PDF (headless Chromium or a PDF library): a heavy dependency in the API image, a second layout to keep in sync, and font licensing on the server. Revisit if reports must be emailed on a schedule.
- Always computing reports live: simpler, but past weeks would drift as tasks change, and end-of-week overdue counts would be wrong.
- Per-reader snapshots that include private work: correct but multiplies storage and makes sharing the PDF risky. A shared view is simpler and safe to forward.
