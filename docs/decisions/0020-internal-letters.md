# 0020 — Internal letters

- Status: Accepted
- Date: 2026-10-19

## Context
Phase 2, step 12a (`docs/plans/phase-2-step-12a.md`), from the team review (`docs/feedback/1405-07-27-team-review.md`, section 6) and `docs/architecture.md` §10. The pilot company writes formal internal letters in Mizito: numbered, with a Jalali date, attachments, copies and referrals («ارجاع»). Letters often carry sensitive matters (salaries, contracts), so access must be tighter than for tasks. Letters are internal only (answer 1 in §10.8).

## Decision
- **Three tables.**
  - `letters` holds the subject, the body, the sender, urgency, the confidential flag, `thread_id` and `reply_to_id`.
    - It also holds the number (`number`, `jalali_year`, `sequence`), `sent_at`, `sender_archived_at` and `deleted_at`.
    - A check constraint keeps the number and `sent_at` together (all null for a draft).
    - Only a draft can be deleted (soft).
  - `letter_recipients` holds one row per person: `to`, `cc` or `referral`.
    - A referral row carries `referred_by` and a note.
    - Each row also has `read_at` and `archived_at`, per person.
  - `letter_counters` holds the last number per company and Jalali year.
  - All three tables have forced RLS and composite `(tenant_id, …)` foreign keys.
  - The app role cannot DELETE letters.
  - On `letter_recipients`, a restrictive policy allows a DELETE only while the letter is a draft. Editing a draft replaces its recipients; a sent letter's list is fixed at the database level.
  - A `BEFORE UPDATE` trigger (`app.letters_keep_sent`) refuses any change to a sent letter's content, sender, urgency, confidentiality, thread or number. Per-person state (archive) still changes.
  - Editing, deleting, sending and referring lock the letter row (`FOR UPDATE`), and so does deleting a draft's file. A concurrent send therefore finishes first and the edit is refused with `letter_sent`; parallel referrals of the same person get `already_recipient`.
  - Sending first removes draft recipients who were deactivated since the draft was saved, so the stored list matches who was notified and audited.
- **Who sees a letter.** One SQL condition, `visibleLetters` in `apps/api/src/letters/access.ts`: the sender, plus everyone on `letter_recipients` once the letter is sent.
  - No role or permission is an exception: not a manager, an admin or the owner.
  - The same condition is used by the list, the letter page, the thread, attachment downloads and `Notifier.canSee`.
  - Anything else is "not found" (404), including for other companies (RLS).
- **Numbers.**
  - Sending upserts the company's `letter_counters` row for the Jalali year of the send time, in the tenant's time zone. The upsert takes a row lock until the send commits.
  - The number is `«year»/«five-digit sequence»` (`1405/00042`, shown with Persian digits).
  - Numbers are gap-free: a failed send rolls back its number. Ten parallel sends get 1–10 (integration test).
  - A draft has no number.
- **Body format.** The body is `{ format: 'lite', text }`: plain text with three marks.
  - A line starting with «- » is a list item.
  - `**…**` is bold.
  - An empty line starts a new paragraph.
  - `parseLiteText` (shared) turns it into blocks. `LiteText` (ui) renders them as React elements only, so no HTML is ever parsed and `<script>` shows as typed.
  - The toolbar only inserts the same marks. `format` leaves room for a richer format later.
- **Replies and threads.**
  - A reply is a new letter with `reply_to_id`, and `thread_id` is the thread's first letter.
  - «پاسخ» goes to the sender. «پاسخ به همه» goes to everyone on the letter except the replier.
  - The letter page lists the other letters of the thread the viewer may open. A referred person therefore sees the referred letter, not the rest of the thread.
- **Referral.**
  - Anyone who sees a sent letter may refer it to active colleagues, with a note of up to 500 characters.
  - Someone already on the letter cannot be referred again (`already_recipient`).
  - The referral route («مریم ← رضا» and the note) shows to everyone on the letter.
  - Referring a confidential letter is allowed and audited, like every referral.
- **Read state.**
  - A recipient's first open sets `read_at`.
  - Only the sender, and whoever referred that person, see when others read. Recipients don't see each other's read state.
- **Archive** is per person: `letter_recipients.archived_at`, or `letters.sender_archived_at` for the sender. A new reply in a thread arrives as its own row, so it lands in the inbox again.
- **Folders.**
  - The inbox is ordered by when the letter reached the person: a referral arrives after the send.
  - Paging is a keyset cursor on `(sort time, id)` with microseconds, so letters that arrive at the same moment are never skipped.
  - Search covers the subject (as typed, and with Latin digits) and the number (Latin digits). `%` and `_` are taken literally.
- **Attachments** use ADR 0019 with the subject `letter`.
  - A draft binds its sender's uploads when it is saved.
  - Downloads check `visibleLetters` on every request.
  - A sent letter's files cannot be deleted; a draft's files can be deleted by the sender.
  - Files of a deleted draft are purged by the cleanup job.
- **Audit.** Recorded as `letter.sent` (number, recipient count), `letter.referred`, and `letter.confidential_opened` (each person's first open). The body is never written to the audit log, and neither is the name of a deleted draft file.
- **Read-only company** (ADR 0003): sending, editing and referring are refused (`tenant_read_only`). Opening a letter still records `read_at`, the confidential-open audit row and a realtime event. That is a record of reading, not a change of company data.
- **Events and notifications.**
  - `letter.sent` notifies `to` and `cc`, but not referrals added before the worker ran.
  - `letter.referred` notifies the referred people.
  - Both go through `Notifier`, so quiet hours, muted kinds and dedupe apply.
  - A confidential letter's notification has an empty title. Its text reads «نامه محرمانه‌ای از … رسید», without the subject.
  - Push stays content-free.
  - Realtime: the `letters.changed` hint goes to the sender and everyone on the letter. For a first read it goes only to the sender and referrers.
- **UI.**
  - `/letters` shows the folders, `/letters/[id]` the letter, and `/letters/new` the composer (new, `?replyTo=…&all=1`, `?draft=…`).
  - Desktop has a sidebar item with the unread count.
  - Phones get an envelope next to the bell, because the tab bar is full.
  - On phones, the letter actions sit in a bar above the tab bar.

## Alternatives considered
- **A rich-text editor (TipTap/ProseMirror) with HTML bodies:** heavy, and HTML from users needs sanitizing on every render. Plain text with three marks covers formal letters, and `format` allows an upgrade.
- **A sequence per company (`CREATE SEQUENCE`):** sequences leave gaps on rollback, and a formal register must not.
- **Letting managers or the owner read their department's letters (like tasks):** rejected by §10.5. Letters are between their parties.
- **Draft recipients in a JSON column:** keeps DELETE off `letter_recipients` entirely, but loses the composite FKs on draft recipients. The restrictive draft-only policy keeps both.
