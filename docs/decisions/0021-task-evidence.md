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
  - May this person pin this item? For a letter: they see it (`visibleLetters`), it was sent, and neither it nor any letter of its thread is confidential, because a reply may quote a confidential letter (otherwise `evidence_not_allowed`).
  - One SQL rule, `pinnableLetter()`, is applied on every path: pinning, summaries, bodies and file downloads. No path relies on another path's check, or only on the trigger that freezes sent letters (ADR 0020).
  - What is the read-only summary and body?
  - New kinds add a provider and an enum value; the table, routes and screens stay.
- **Who pins:** someone who sees the item and can edit the task (`canEditTask`: assignee, reporter, collaborator, department manager, owner). A plain viewer of the task cannot.
- **Who sees:** everyone who sees the task (`visibleTasks`) sees the pinned item read-only: the summary, the body, the copies and the files. They never see the rest of the thread, the referral route or notes, and `GET /api/letters/:id` stays 404 for them.
  - This is the one place where seeing one thing follows from seeing another. So it is explicit:
    - before pinning, `GET /api/tasks/:id/evidence/audience` names the people on the task and the groups that see it (project members, the department, company readers, everyone for a company-wide project), mirroring `visibleTasks`;
    - pins and unpins are audited (`task.evidence_pinned`, `task.evidence_unpinned`, without subject or body);
    - confidential letters are never pinned.
  - Attachment downloads of a letter accept a second path: the letter is pinned (actively) to a live task the person sees. Unpinning closes that path at once.
- **Read state** on the card is one flag: every main («to») recipient has opened it. Who read it is never shown (ADR 0020). With a single main recipient, the flag is in effect that person's read receipt; the product owner accepted this (plan question 3).
- **The sender is told.** Any party on a letter (including a copy or a referral) may pin it if they edit the task. So the sender's letter page shows how many active pins sit on tasks they cannot see (`pinnedElsewhere`, a count, never the tasks). Pins on tasks they see are listed in `pinnedTo`.
- **The audience note** names the assignee, the reporter, collaborators and watchers, and describes the rest as groups.
- **Unpin:** the pinner, or anyone who can edit the task.
- **Trail and notifications.**
  - The task history records `evidence_pinned` and `evidence_unpinned` with the letter number.
  - `task.evidence_pinned` notifies the assignee and the person who assigned or asked for the task (`source_member_id`, else the reporter), never the pinner, through `Notifier`.
  - Pins and unpins send the usual `work.changed` realtime hint.
- **Counts and lists.** Tasks carry `evidenceCount` (active pins), shown on `TaskCard`. `GET /api/tasks?editable=true` (SQL `editableTasks`, the twin of `canEditTask`) feeds the task picker on a letter, and a letter carries `pinnedTo` (only the tasks the viewer sees) and `can.pin`.
- **A removed source** (possible for minutes and messages later) shows as «این مورد دیگر در دسترس نیست»; sent letters are never removed.

## Messages as evidence (step 15c)

Plan: `docs/plans/phase-2-step-15c.md`. The product owner accepted pinning direct and group messages too, with the audience note.

- **Kind `message`:** a new `evidence_kind` value (migration `0021`); the table is unchanged.
- **Provider:** `evidence/message-provider.ts`.
  - **Who may pin:** someone who reads the message now (`visibleConversations`) and edits the task.
  - **The card:** where it was said, who said it, the start of the text with mentions as names, the file count and an «edited» mark.
  - **Direct conversations** are named by their kind only, so a task viewer does not learn who talked.
- **What a task viewer reaches:** only that message and its files, read-only, through an active pin on a visible task (`messagePinnedToVisibleTask` in `AttachmentsService`). The conversation and its other messages stay closed. A deleted message shows as «no longer available».
- **Making a task from a message** (`POST /api/messages/:id/task`):
  - `TasksService.createIn` and `EvidenceService.pinIn` run in one transaction.
  - The title comes from the message's first line.
  - The message text is never copied into the task: the pin is the only link.
- **The pin count on a message:** a message carries `pinnedCount` only, because the same payload goes live to every reader. `GET /api/messages/:id/tasks` lists the tasks that reader sees and counts the rest.
- **History and notifications** name a message by its kind only («یک پیام گفت‌وگو»), never its text.
- **One notification for a task made from a message:** its assignee gets the assignment, not also a pin notification.
- **Which department:** a task made in a project channel goes to that project. Otherwise it goes to the maker's own department, like any new task, and is not taken from the channel's department.
- **Known limit:** the page opened around a search result does not take live messages or pin counts; «رفتن به آخرین پیام‌ها» returns to the live view.

## Alternatives considered
- **Copying the letter into the task (a snapshot):** a second copy of sensitive text that the letter's own rules no longer govern. A live, read-only view through one checked path is safer.
- **Letting any task viewer pin:** anyone could attach their correspondence to other people's work. Pinning is a statement about the work, so it belongs to those who edit it.
- **A table per kind (`task_letters`, `task_minutes`, …):** three tables, three sets of routes and screens. The generic table with providers was planned in §10.4.
- **Showing who read the letter on the card:** it would expose read receipts beyond the sender and referrer, against ADR 0020.
