# 0010 — Work core: tasks, projects and the daily plan

- Status: Accepted
- Date: 2026-10-17

## Context
Phase 1, step 5 (`docs/plans/phase-1-step-5.md`) adds the shared work core every department module builds on: projects, tasks, comments, history, «today» and domain events. It has to follow the visibility rules of ADR 0005, work for department templates later (ADR 0004) and stay calm, not pushy (ADR 0007).

## Decision
- **Visibility is computed in SQL** (`apps/api/src/work/access.ts`), on top of RLS. Everyone sees tasks they are involved in (assignee, reporter, collaborator); department members see their departments' tasks; project members see the project's tasks; company-wide projects are visible to all; `task.read` at tenant scope (system role or oversight department) sees everything **except private projects**, which only their members see. Tasks a member cannot see answer `404`, never `403`.
- **Editing:** involved people and the department's head or manager edit; only the head or manager (or the owner, via `task.manage`) sets the weight that will drive XP; the reporter, the head/manager and the owner delete.
- **Statuses** are a key plus a fixed category (`todo`, `in_progress`, `done`, `canceled`). Until department templates define their own workflows, the core default has one key per category. `completed_at` follows the category.
- **Due dates are calendar dates** (`date`), not instants; «today» and «overdue» use the tenant time zone (`calendarDateIn`).
- **Order** uses fractional keys (`fractional-indexing`), so a board move rewrites one row.
- **Concurrency:** `version` on tasks; an edit with a stale version gets `409 version_conflict` with the current task, and the UI refetches instead of overwriting.
- **History vs audit:** every change writes a user-visible `activities` row; only sensitive actions (task deletion, which is soft) also go to the audit log (ADR 0009).
- **Outbox:** `task.created|assigned|status_changed|completed|reopened|deleted`, `comment.created` and `daily_plan.updated` are written to `domain_events` in the same transaction. Nothing consumes them yet; the worker that publishes them comes with notifications and XP.
- **Today** is the member's own plan for their local day. Suggestions (from yesterday's plan, overdue, due today, in progress) are offered, never moved automatically.
- **Board drag and drop** uses `@dnd-kit` (mouse, touch, keyboard; Persian screen-reader announcements). The keyboard's ←/→ jump to the neighbouring column.

## Alternatives considered
- Filtering visibility in application code after loading: simpler, but pagination and counts would leak or be wrong.
- Integer positions for ordering: every move would renumber a column.
- Auto-rolling unfinished tasks into today (as many to-do apps do): rejected as pressure; the member decides.

## Consequences
- New permissions on system roles need a data migration for existing tenants (e.g. `0004_grant_task_manage.sql`), because role grants are copied when a tenant is created.
- When department templates arrive, `status_key` gains per-template workflows; `status_category` keeps reports and «today» working across modules.
- Subtasks are one level deep in the UI for now; the schema allows deeper nesting.
