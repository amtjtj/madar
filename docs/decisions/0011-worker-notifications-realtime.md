# 0011 — Worker, notifications, quiet hours and realtime

- Status: Accepted
- Date: 2026-10-18

## Context
Phase 1, step 6 (`docs/plans/phase-1-step-6.md`) turns the outbox from step 5 into something useful: in-app notifications, due-date reminders and live updates. ADR 0006 fixed the shape (worker entrypoint, outbox relay, BullMQ, Socket.IO with Redis); this ADR records the details and the tenant-isolation rules around them. The brief requires notifications to stay quiet outside working hours by default.

## Decision
- **Relay:** `apps/api/src/worker.ts` locks unpublished events of every tenant with `app.lock_unpublished_events` (SECURITY DEFINER, minimal columns, `FOR UPDATE SKIP LOCKED` inside the caller's transaction), enqueues one BullMQ job per interested consumer (job id = consumer + event) and calls `app.mark_events_published` in the same transaction. A crash before commit releases the locks, so delivery is at least once. Tests can limit a relay to their own tenants.
- **Consumers:** every job carries `tenantId` and is rejected without a valid one. It runs inside `withTenant(tenantId)` in the same transaction as its `processed_events` row, so a redelivered event has no effect and a failed attempt rolls back completely.
- **Notifications** are rows per recipient with a `dedupe_key`. The notifier never notifies the actor, skips inactive members and anyone who cannot see the subject (same SQL visibility as the API), and honours muted kinds.
- **Quiet hours:** a per-tenant `work_calendars` row (per-day hours, so the pilot's Thursday half day fits; holidays; no row = product default). Each notification gets `deliver_after`: now during working hours or with the member's off-hours opt-in, otherwise the next working start. The in-app list shows it at once; interrupting channels (Web Push, step 6b) wait for `deliver_after`.
- **Reminders:** a BullMQ job scheduler runs every 15 minutes. Once the tenant's working day has started it creates «due soon» (due before the next working day) and «overdue» notifications for the assignee once per due date. When a task is N working days overdue (owner setting, default 2), the department's head and managers are told once, never about private-project tasks they cannot see.
- **Realtime:** the Socket.IO gateway (`/api/socket`, no trailing slash so it works through the web proxy) accepts a socket only with a valid session, an active membership, a non-locked tenant and no pending security step. The server joins it to `t:{tenant}:m:{member}`, `t:{tenant}:d:{department}` and `t:{tenant}:p:{project}` rooms; clients cannot join rooms. The worker emits through `@socket.io/redis-emitter`. Messages carry **no data** (`work.changed`, `today.changed`, `notifications.changed`); the client refetches through the API, which checks access. Private-project tasks never reach the department room. New project members join the project room live; suspending a member disconnects their sockets.

## Alternatives considered
- Sending task data over the socket: fewer requests, but every message would need a per-recipient visibility check, and one mistake would leak data across people. Content-free hints make leaks impossible at the cost of a refetch.
- Holding notifications back from the in-app list at night: hides information the member chose to look at; only interruptions are deferred.
- Cron in the API process: runs once per API instance; a BullMQ scheduler runs once per cluster.

## Consequences
- Department membership changes reach live rooms on the next connection (page load); project membership changes are live.
- Web Push (step 6b) only needs a channel that sends notifications whose `deliver_after` has passed.
- Running several worker processes is safe: relays skip locked rows and consumers are idempotent.
