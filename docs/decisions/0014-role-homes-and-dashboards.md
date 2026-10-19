# 0014 — Role homes, dashboards and charts

- Status: Accepted
- Date: 2026-10-18

## Context
Phase 1, step 8 (`docs/plans/phase-1-step-8.md`). The brief gives each role a home that answers one question:
- The CEO: where is the company and where is it stuck? Within 30 seconds.
- A department manager: what is my team doing and who needs help?
- An employee: what do I do today? Within 10 seconds.

The brief also forbids ranking people.

## Decision
- **Home tabs:** «امروز من», «تیم من» and «شرکت», each shown only to those allowed.
  - Default: tenant-wide readers of work and goals (owner, executives, oversight departments) land on «شرکت». Department heads and managers land on «تیم من» (owner's decision). Everyone else gets Today plus a «my goals» card.
  - The last choice is remembered per device. `?tab=team&department=…` opens a department from the company view.
- **One request per dashboard:** `GET /api/dashboard/company` and `GET /api/dashboard/departments/:id`.
  - No new tables. Counts are computed from `tasks`, `projects`, `goals` and `comments` through the same visibility conditions as the lists (a private project's tasks never reach someone outside it).
  - The `tasks (tenant_id, completed_at)` index serves the 8-week «done per week» trend.
  - With the demo data each dashboard answers in about 35 ms (median).
- **Definitions** live in `packages/shared/src/dashboard-rules.ts`, fixed until per-company settings come after the demo:
  - **Stuck:** in progress and untouched (no change or comment) for 5 working days, or more than 2 working days past due.
  - **Department behind:** goals trail the season by more than 15 points, or more than 20 % of open tasks are overdue.
  - **Project at risk:** done share trails elapsed time by more than 20 points, or has overdue tasks. *Updated in step 10b (ADR 0018):* the weighted progress of the project's top-level tasks replaces the done share.
  - **Might need help:** at least 3 overdue tasks, any stuck task, or more than 15 open tasks.
- **Cards match lists:** the SQL for overdue and stuck (`apps/api/src/dashboard/conditions.ts`) and for projects at risk (`at-risk.ts`) is shared with the `due=overdue`, `stuck=true` and `risk=true` list filters. A tile and the list it opens always show the same rows. Filters live in the address, so drill-downs can be shared and survive going back.
- **People:** workload is alphabetical and «might need help» shows names with reasons, never a score or rank.
  - That list goes only to the department's own head and managers. Company-wide readers see the team numbers without it.
- **Charts:** small components in `@madar/ui` (`StatTile`, `BarList`, `StackedBarList`, `ColumnChart`) instead of a chart library.
  - Four shapes cover the MVP. Libraries such as Recharts or ECharts add 100 to 300 KB and fight RTL and our tokens.
  - Rules: one axis, thin rounded marks, tooltips on hover and focus, and a hidden table for screen readers. Text never takes the series color.
  - Two chart tokens (`--chart-1`, `--chart-2`) were checked with a palette validator for colorblind separation and contrast against both surfaces; dark mode has its own steps.
  - Time runs left to right on time axes, as charts usually do; everything else is RTL.

## Alternatives considered
- A chart library: faster to start, but heavier and harder to keep RTL and on-token. Revisit if dashboards need many more chart types (department modules may).
- Pre-aggregated tables or a cache: unnecessary at pilot scale (tens of ms). A short Redis cache, with the viewer in the key, can come later.
- Ranking teams or people by output: forbidden by the brief's red lines.

## Consequences
- The thresholds are product guesses; the demo will tell whether «stuck» and «behind» feel right.
- The trend counts tasks marked done. Reopened tasks drop out of the week they were finished in, which is the honest picture.
- The «goal badge» on task cards (deferred from step 7) shipped here.

## Update, step 10b (2026-10-19)
Tasks now carry percentage progress (ADR 0018). «Project at risk» compares the **weighted progress** of a project's top-level tasks with the share of time elapsed, instead of the share of tasks done:
- the weight is the task weight (1–5);
- a finished task counts as 100 %, and canceled tasks are left out;
- the 20-point gap and the overdue rule stay as they were.

The dashboard tile, the `risk=true` list filter and the weekly report all use `atRiskProjects`, so they changed together. Stored weekly reports keep the definition they were built with (append-only).
