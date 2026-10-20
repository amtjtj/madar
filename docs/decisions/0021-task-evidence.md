# 0021 — Task evidence («شاهد کار»)

- Status: Accepted
- Date: 2026-10-20

## Context
Phase 2, step 12b (`docs/plans/phase-2-step-12b.md`), from the team review (`docs/feedback/1405-07-27-team-review.md`, section 7) and `docs/architecture.md` §10.4. A task like «پیگیری قرارداد» is often proven by a letter someone wrote. Managers and the CEO should see that proof from the task, although letters are visible only to their parties (ADR 0020). Meeting minutes (step 13) and chat messages (step 15) will need the same mechanism.

## Decision
- **One generic table.** `task_evidence` has `task_id`, `kind` (enum `evidence_kind`, `letter` for now), the polymorphic `subject_id`, `pinned_by`, `created_at`, `unpinned_at` and `unpinned_by`.
  - It has forced RLS and composite FKs to `tasks` and `members`. The API checks the subject exists in the same company.
  - A partial unique index allows one active pin per `(task, kind, subject)`. Unpinning is soft (the app role has no DELETE), so the same item can be pinned again later and the trail stays.
- **Providers.** Each kind has a provider (`apps/api/src/evidence/letter-provider.ts` for letters) that answers two things:
  - May this person pin this item? For a letter: they see it (`visibleLetters`), it was sent, and it is not confidential (otherwise `evidence_not_allowed`).
  - What is the read-only summary and body?
  - New kinds add a provider and an enum value; the table, routes and screens stay.
- **Who pins:** someone who sees the item and can edit the task (`canEditTask`: assignee, reporter, collaborator, department manager, owner). A plain viewer of the task cannot.
- **Who sees:** everyone who sees the task (`visibleTasks`) sees the pinned item read-only: the summary, the body, the copies and the files. They never see the rest of the thread, the referral route or notes, and `GET /api/letters/:id` stays 404 for them.
  - This is the one place where seeing one thing follows from seeing another. So it is explicit:
    - before pinning, `GET /api/tasks/:id/evidence/audience` names the people on the task and the groups that see it (project members, the department, company readers, everyone for a company-wide project), mirroring `visibleTasks`;
    - pins and unpins are audited (`task.evidence_pinned`, `task.evidence_unpinned`, without subject or body);
    - confidential letters are never pinned.
  - Attachment downloads of a letter accept a second path: the letter is pinned (actively) to a live task the person sees. Unpinning closes that path at once.
- **Read state** on the card is one flag: every main («to») recipient has opened it. Who read it is never shown (ADR 0020).
- **Unpin:** the pinner, or anyone who can edit the task.
- **Trail and notifications.**
  - The task history records `evidence_pinned` and `evidence_unpinned` with the letter number.
  - `task.evidence_pinned` notifies the assignee and the person who assigned or asked for the task (`source_member_id`, else the reporter), never the pinner, through `Notifier`.
  - Pins and unpins send the usual `work.changed` realtime hint.
- **Counts and lists.** Tasks carry `evidenceCount` (active pins), shown on `TaskCard`. `GET /api/tasks?editable=true` (SQL `editableTasks`, the twin of `canEditTask`) feeds the task picker on a letter, and a letter carries `pinnedTo` (only the tasks the viewer sees) and `can.pin`.
- **A removed source** (possible for minutes and messages later) shows as «این مورد دیگر در دسترس نیست»; sent letters are never removed.

## Alternatives considered
- **Copying the letter into the task (a snapshot):** a second copy of sensitive text that the letter's own rules no longer govern. A live, read-only view through one checked path is safer.
- **Letting any task viewer pin:** anyone could attach their correspondence to other people's work. Pinning is a statement about the work, so it belongs to those who edit it.
- **A table per kind (`task_letters`, `task_minutes`, …):** three tables, three sets of routes and screens. The generic table with providers was planned in §10.4.
- **Showing who read the letter on the card:** it would expose read receipts beyond the sender and referrer, against ADR 0020.
