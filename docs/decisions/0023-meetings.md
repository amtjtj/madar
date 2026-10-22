# 0023 — Meetings, minutes and decisions

- Status: Accepted
- Date: 2026-10-22

## Context
Phase 2, step 13a (`docs/plans/phase-2-step-13a.md`), from the team review (`docs/feedback/1405-07-27-team-review.md`, section 8) and `docs/architecture.md` §10. The pilot company holds team meetings, OKR reviews and one-on-ones, and today loses what was decided: minutes live in chat files and decisions are never followed up. Step 13 is split: 13a (this record) covers single meetings, minutes and decisions; 13b adds weekly series, attendance replies, a reminder before the meeting and minutes as task evidence.

## Decision
- **A meeting is its own entity, not a kind of task** (§10.6 item 1). Four tables, all with forced RLS and composite `(tenant_id, …)` foreign keys:
  - `meetings`: type (`regular`, `okr_review`, `one_on_one`), title, `starts_at`/`ends_at` (a check keeps the end after the start; the API also caps a meeting at 24 hours), location, link, agenda, organizer, department, `canceled_at`.
    - The department is the organizer's primary department when the meeting is made. It decides where decision tasks go.
  - `meeting_participants`: everyone taking part, the organizer included.
  - `meeting_minutes`: one per meeting, with a `version` for optimistic concurrency. Its files are attachments with the new subject `minutes`.
  - `meeting_decisions`: text, optional `task_id` (unique) and `key_result_id`.
    - The task's link back to its meeting is this row. `tasks` gets no `meeting_id` column (the plan suggested one); one source of truth, and no import cycle between the schema files.
  - The app role cannot DELETE meetings or minutes; canceling is soft. Participants may be deleted (removed before the meeting starts). A restrictive policy allows deleting a decision only while it has no task.
- **Who sees a meeting.** One SQL condition, `visibleMeetings(actor)` in `apps/api/src/meetings/access.ts`:
  - the organizer and the participants (`takesPart`);
  - members of a department that oversees the new resource `meeting` (`OVERSIGHT_RESOURCES`), except for a one-on-one, which only its two people see.
  - No role is an exception, not even the owner (answer 2 of the plan). Everything else is 404.
  - The same condition is used by the list, the meeting page, minutes file downloads, the task back-link and `Notifier.canSee`.
- **Who does what.**
  - The organizer edits the time, place, link, agenda and people, and cancels. People are added at any time but removed only before the start (`meeting_started`), so nobody loses the minutes of a meeting they attended.
  - A one-on-one has exactly one other person (`one_on_one_needs_one`); its type never changes.
  - The people taking part write the minutes and decisions (answer 1). Oversight readers only read.
  - A canceled meeting is read-only (`meeting_canceled`).
  - Links are http(s) only (`meeting_link_invalid`); the page opens them with `rel="noopener noreferrer"`.
- **Minutes.** One shared lite text (ADR 0020), never HTML. Removing a minutes file audits only its size (like a draft letter's) and refreshes the meeting live. A save carries the version it started from; a stale one gets `minutes_version_conflict`, and the page offers to reload. The first save also races safely (`insert … on conflict do nothing`). Files: up to 10, bound with `bindUploads`; a file is removed with the attachment endpoint by anyone who may write the minutes.
- **Decision to task.**
  - `MeetingsService.convertDecision` calls `TasksService.createIn` in the same transaction, in the meeting's department, so the converter needs the usual right to create tasks there (`canCreateIn`).
  - `createIn` takes an `origin`: `{ meeting: true }` sets the source to `meeting` at creation (ADR 0017), even without an assignee, so a later assignment keeps it; `keyResultId` links the key result (checked with `requireLinkableKeyResult`, OKR reviews only).
  - One task per decision (`decision_has_task`). The decision then becomes fixed: no edit, no delete.
  - The task keeps its own access rules. A meeting page shows a decision's task title and assignee only to viewers who may see the task; others read only that a task exists. A task shows «از جلسه: …» with a link only when the viewer sees the meeting; otherwise the title alone, and for a one-on-one not even that (only «از یک جلسه یک‌به‌یک»).
- **Events, notifications and realtime.**
  - Events: `meeting.scheduled` (with the invited people), `meeting.updated` (`notify` when the time, place or link changed; `removedIds`), `meeting.canceled`, `meeting.minutes_recorded` (`first`), `meeting.decision_converted`.
  - Notification kinds: `meeting_invited` (deduplicated per meeting and person, so removing and adding someone again never invites twice), `meeting_changed`, `meeting_canceled`, `meeting_minutes` (first save only). Editing a meeting is rate-limited (60 an hour). Payload: the title and `startsAt`; the web words the date and time. Push stays content-free.
  - The decision's task notifies its assignee through the normal `task.assigned`.
  - Realtime hint `meetings.changed` to the personal rooms of the participants and anyone just removed.
- **Screens.** `/meetings` (upcoming grouped today / tomorrow / this week / later, past newest first; both paged with a `(starts_at, id)` cursor), `/meetings/new` (also `?edit=<id>`), `/meetings/[id]` (people, agenda, minutes, decisions, convert dialog), a «جلسه‌های امروز» card on the today screen (meetings the person takes part in, not oversight), and the task back-link. Desktop: «جلسه‌ها» in the sidebar. Phones: the today card and the «سازمان» hub, which is now always in the tab bar (answer 3). Times are picked from quarter-hour lists in Persian digits and stored as UTC instants built in the company's time zone (`zonedInstant`).

## Consequences
- A regular meeting's title is shown to task viewers who cannot open the meeting (the decision's context); a one-on-one's title never is.
- Minutes overwrites and deleting a decision without a task are not audited (only `updated_by` is kept); 13b may add minutes history.
- Oversight readers get no live refresh (hints go to participants only); their pages refresh on the next load.
- Decisions are ordered by creation, not by hand (the plan's manual order was left out).
- 13b builds on these tables: a `meeting_series` table, `meeting_participants.response`, a worker reminder, and an `evidence_kind` value `minutes` with its provider.
