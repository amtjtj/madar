# 0017 — Task source, automatic priority and personal order

- Status: Accepted
- Date: 2026-10-19

## Context
Phase 2, step 10a (`docs/plans/phase-2-step-10a.md`), from the team review (`docs/feedback/1405-07-27-team-review.md`, architecture section 10).

The team said two things:
- An employee cannot tell which of their tasks matter most.
- A task the CEO assigned looks like any other.

They want the list ordered for them, with a reason they can trust, and each person still free to arrange their own day.

## Decision
- **Source is decided once.** `tasks.source` is one of `personal`, `assigned`, `request` or `meeting`. It is set when the task gets its first assignee and never changes, even when the task is reassigned. The rule is `deriveTaskSource` in `packages/shared/src/task-priority.ts`, given whoever set that first assignee:
  - **personal:** the actor is the assignee.
  - **assigned + CEO:** the actor is the CEO, meaning they have no `manager_id` and hold the `owner` or `executive` role. The CEO is above everyone, also when the org chart is not filled in yet (found by the e2e: a new company has no managers set).
  - **assigned:** the actor is anywhere up the assignee's `manager_id` chain, or is a head or manager of the task's department.
  - **request:** anyone else.
  - **meeting:** reserved for step 13.

  `source_member_id` and `source_ceo` are a snapshot, so a later change to the org chart does not rewrite old assignments. Names and job titles are read from the current profile. Migration `0013` backfills existing tasks with the same rule, using the reporter as the actor.
- **Priority score.** `priorityScore` combines five contributions, each 0–1 times a weight:
  - due bucket (overdue > today > next working day > this week > later);
  - stored priority;
  - source (CEO > assigned > meeting > request > personal);
  - linked to a key result;
  - task weight (1–5).

  The default weights are 40/25/20/10/5. They are stored in `tenants.settings.priority`, and only the owner (`tenant.manage`) edits them, at `/org/priority`, with a live preview. Each edit is audited as `priority_weights.updated`. The score is computed in the API on every read, never stored, so weights and the calendar apply at once.
- **Reasons.** The two largest contributions become `rank.reasons`. These are i18n keys (`work.rank.reasons.*`), shown as «سررسید فردا و ابلاغ مدیرعامل» behind an info button on each card and in the task detail. They are never free text from the server.
- **Personal order lives beside the task, not in it.**
  - «Today»: `daily_plan_items.sort_key` is nullable. Null means «placed by score». Reordering writes keys for the whole day; «مرتب‌سازی خودکار» clears them.
  - «My tasks»: `member_task_order (member_id, task_id, sort_key)`, an RLS table private to the member.
  - In both, `mergeManualOrder` slots new or unordered tasks in by score, before the first ordered task with a lower score. An urgent new task from the CEO therefore still appears at the top, while the member's own arrangement is kept.
- **The board keeps one shared order** (`tasks.sort_key`): a board is team space, not a personal list.
- **Drag and drop** uses dnd-kit (`SortableList` in `@madar/ui`):
  - Mouse: drag the handle.
  - Touch: hold the handle for 180 ms, so a swipe still scrolls.
  - Keyboard: Space, arrows, Space.
  - Screen readers get Persian announcements.
  - Each reorder is optimistic and rolls back on error.
- **Filters.** `GET /api/tasks?source=` filters by source. The list views offer «همه / شخصی / ابلاغی / درخواست همکار».

## Alternatives considered
- **Storing the score on the task:** cheaper sorting, but stale whenever the date changes, a holiday is added or the weights change. Scoring at most 2000 visible open tasks per request is well under a millisecond each.
- **Inferring the source on every read from the current org chart:** it would rewrite history whenever someone changes manager, and it costs a recursive query per task.
- **One personal order per member for every list:** «today» and «my tasks» answer different questions, so a day plan reordered in the morning should not reshuffle the full backlog.
- **A learned ranking (AI):** opaque, and against the rule that a person can always see why. It may come later in the AI service, as a suggestion only.
