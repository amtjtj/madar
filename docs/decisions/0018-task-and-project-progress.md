# 0018 — Percentage progress on tasks and projects

- Status: Accepted
- Date: 2026-10-19

## Context
Phase 2, step 10b (`docs/plans/phase-2-step-10b.md`), from the team review (`docs/feedback/1405-07-27-team-review.md`, section 3). A task such as «follow up the contract» is half done long before it is done, and managers asked to see that, with a line saying where it stands. A project's progress counted only finished tasks, so a project with every task at 80 % showed 0 %.

## Decision
- **Stored on the task.**
  - `tasks.progress` holds 0–100 in steps of 5. A database CHECK and Zod both enforce it.
  - `tasks.progress_mode` (`auto`/`manual`) matters only for tasks with subtasks.
- **What people see.** A finished task shows 100 % (`displayProgress`), and the stored value is left alone, so reopening the task brings back the last recorded value. A canceled task shows no progress.
- **Recording.**
  - `POST /api/tasks/:id/progress` takes `{ value, note?, version }`, with optimistic concurrency.
  - It writes one history row: verb `progress`, `{ progress: {from, to}, note }`.
  - The first progress above zero moves a «to do» task to «in progress».
  - 100 % does not close the task; the app asks «انجام‌شده علامت بخورد؟».
  - A closed task (`progress_closed`) is refused. So is a parent in auto mode (`progress_auto`).
- **Parents follow their subtasks.**
  - In `auto` mode, a parent's progress is the weighted average of what its subtasks show (`weightedProgress`, canceled left out), rounded to a step.
  - `recomputeParentProgress` stores it in the same transaction as any subtask change: progress, status, weight, create or delete. The parent's version is not bumped, because nobody edits a computed value.
  - A task whose progress was recorded by hand switches to `manual` when its first subtask arrives, so the value does not drop to 0.
  - «تغییر به دستی» and «برگشت به خودکار» switch the mode.
  - Migration `0014` starts existing parents from their subtasks.
- **Projects.**
  - Progress is the weighted average over the project's top-level tasks, with finished tasks at 100 and canceled ones left out.
  - It is computed in SQL on read and never stored.
  - The «at risk» rule uses it (ADR 0014, updated).
- **Telling the assigner.**
  - The `task.progress_updated` event creates a `task_progress` notification for `source_member_id`, but only when the source is `assigned` or `request` (ADR 0017).
  - The dedupe key `task_progress:{task}:{day}` limits it to one per task per day; the history has every entry.
  - It also sends device push and a realtime hint.
- **Slider.**
  - `Slider` in `@madar/ui` is a native `<input type="range">`, transparent, over a drawn track and thumb. Keyboard, touch and screen readers therefore come from the browser.
  - The native thumb is 44 px wide and the drawn track is inset by half of that, so a tap lands on the value shown.
  - It fills from the inline start (0 on the right in RTL), says the value in Persian (`aria-valuetext`), and vibrates for 10 ms on release where supported.
  - Percentage key-result check-ins use it too.
- **Observers.**
  - `project_role` gains `observer`.
  - Observers see the project, including a private one, and its tasks, and they comment.
  - In a private project they add no work: `usableProjects` in `work/access.ts` allows only owners and members, and the project's `can.createTask` mirrors that rule.
  - Changing a project's members after creation is audited as `project.members_updated`, because it changes who can open a private project.

## Alternatives considered
- **Progress only through subtasks:** most pilot tasks have none, and the team asked for a percentage on the task itself.
- **Storing project progress:** it would go stale on every task change. Computing it means one aggregate per project on read, which is cheap at pilot scale.
- **Closing the task automatically at 100 %:** people set 100 % to say «my part is done, waiting for review». Asking keeps that choice with them.
- **A slider library (Radix, dnd):** a native range already has the right accessibility and input behaviour. Only the look needed work.
- **Notifying on every record:** a person moving a slider several times a day would flood the manager. One notification a day per task, with the full history on the task, was the owner's choice.
