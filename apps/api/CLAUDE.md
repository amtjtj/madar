# API (apps/api) and database (packages/db)

Implementation rules for the NestJS API and the Drizzle schema. The root `CLAUDE.md` (golden rules, multi-tenancy and security principles, workflow, commands) still applies.

## Data access and tenant isolation
- All tenant data access goes through `withTenant()` from `@madar/db` (API: `TenantDb.run(ctx, …)`); raw `pg` imports are lint errors in the API.
- New data-plane tables: composite `(tenant_id, x)` foreign keys and `select app.enable_tenant_rls('<table>')` in the migration (the catalog meta-test enforces it).
- Sensitive changes call `TenantDb.audit()` inside the same transaction (ADR 0009).
- API errors carry codes only (`{ error: { code } }`); the web maps them to Persian in `apps/web/src/lib/errors.ts` and `errors.*` strings.
- System-role grants are copied into each tenant at signup: adding a permission to `SYSTEM_ROLE_GRANTS` also needs a data migration for existing tenants (see `0004_grant_task_manage.sql`).
- Work visibility (who sees which task/project) lives in `apps/api/src/work/access.ts` as SQL conditions; reuse them, never filter in memory (ADR 0010). Goal visibility and edit rules live in `apps/api/src/goals/access.ts` (ADR 0013).
- Dashboard counts and the list filters they link to share their SQL (`apps/api/src/dashboard/conditions.ts`, `at-risk.ts`); change both together (ADR 0014).
- Weekly reports (ADR 0015) are built by one function, `apps/api/src/reports/builder.ts`, for both the live week and stored snapshots. Snapshots are a shared view: never add private-project work, individual goals or per-person counts to them. `weekly_reports` is append-only.
- Task source (ADR 0017) is set once, by `sourceFor()` in `apps/api/src/work/ranking.ts`, when a task first gets an assignee; never update it afterwards. The priority score is computed on read (`loadRanking` + `rankOf`), never stored. Personal orders (`daily_plan_items.sort_key`, `member_task_order`) are merged with `mergeManualOrder` from `@madar/shared`; the board keeps the shared `tasks.sort_key`.
- Task progress (ADR 0018) is written only by `TasksService.setProgress`; after any change to a subtask's progress, status, weight or existence, call `recomputeParentProgress()` (`work/progress.ts`) in the same transaction. Show `displayProgress` (finished = 100). Project progress and «at risk» use the weighted SQL in `projects.service.ts` and `dashboard/at-risk.ts`; keep them in step. Where work may be added to a project is `usableProjects` (observers of a private project add none).
- Attachments (ADR 0019): bytes only through `FileStorage` (`files/storage.ts`) with keys from `objectKeyFor()`; never build a path from a file name. A new subject type (letter, message, minutes) adds its enum value, a bind step with `bindUploads()` and a branch in `AttachmentsService.taskOf`/visibility, so downloads keep checking the subject on every request. Serve the MIME type from `FILE_TYPES`, never the client's.
- Letters (ADR 0020): who sees a letter is `visibleLetters()` in `apps/api/src/letters/access.ts` (sender, plus recipients once sent; no role is an exception). Use it everywhere a letter or its file is reached, including notifications. Numbers come only from `LettersService.send` (the `letter_counters` upsert in the send transaction); never number a draft. A sent letter and its recipient list never change (a restrictive RLS policy allows deleting draft recipients only). Never put a confidential letter's subject in a notification or log, and never write a letter body to the audit log.
- Goal progress is computed, never written by hand: after any change to key results, check-ins or the goal tree, call `recomputeGoalChain()` in the same transaction.

## Events, worker and realtime (ADR 0011)
- Emit domain events with `emitEvent(tx, …)` in the same transaction as the change. A new consumer implements `EventConsumer` and is registered in `events/events.module.ts`; it runs inside `withTenant(event.tenantId)` with its `processed_events` row, so it must do all its writes through the given `tx`.
- Create notifications only through `Notifier.notify()` (skips the actor, checks visibility, muted kinds, quiet hours, dedupe). Each new kind needs `NOTIFICATION_KINDS`, a `notifications.kinds.*` and a `notificationSettings.kinds.*` string.
- Realtime messages carry no data; add a hint name to `REALTIME_EVENTS` and let the web refetch. Rooms come from `realtime/rooms.ts` and are always built from the event's tenant; only the server joins sockets to rooms.
- The worker reads across tenants only through the platform functions (`lock_unpublished_events`, `mark_events_published`, `list_active_tenants`).
- Device push (ADR 0012) is driven by `notification.created`; never send a push directly from a feature. Push payloads are `{ v, kind, count, subject }` only (no titles or names); the service worker words them from `pwa.pushMessages.*`. A new notification kind therefore also needs a `pwa.pushMessages.kinds.*` string.
