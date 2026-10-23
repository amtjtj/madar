# 0024 — Calendar (personal and team)

- Status: Accepted
- Date: 2026-10-23

## Context
Phase 2, step 14a (`docs/plans/phase-2-step-14a.md`). Dates already live in several places: task due dates, the daily plan, meetings, project end dates, goal periods and the company's work calendar (holidays and days off). The pilot company has no single place to see «what is coming for me». Step 14 is split: 14a (this record) is a read-only personal calendar with an agenda and a Jalali month view; 14b adds week and day views, drag to reschedule and team calendars.

## Decision
- **An aggregate, not a table.** `GET /api/calendar?from&to&layers` (`apps/api/src/calendar/`) reads existing data; there is no calendar table, no copy of events and no sync job. Nothing can drift out of step with its source.
- **Every layer reuses its own visibility condition.** The calendar never shows what the item's own page would not:
  - tasks: open (`todo`/`in_progress`), assigned to me, `visibleTasks`; due inside the range;
  - plan: my `daily_plan_items` joined with `visibleTasks`; a task planned and due on the same day is one item (`due` and `planned` both true);
  - meetings: an inner join on my `meeting_participants` row, plus `takesPart` and `visibleMeetings`. What oversight lets me read is not in my calendar (answer 1 of the plan: a personal calendar);
  - projects: active, `visibleProjects`, and I am the owner or in `project_members`; the end date only;
  - goal periods: the end of each period, shown to everyone (answer 2);
  - holidays and days off: from the company's work calendar (`hoursOn` without holidays decides «off»).
- **Past due appears once.** An open task whose due date has passed is not repeated on its old day (the tasks query starts at today); it is listed once in `overdue` (only when today is inside the range, at most 100, with `tasks` in `truncated` beyond that), shown above today. A late task already on today's plan shows only there, tagged both «برنامه امروز» and «گذشته».
- **Bounded requests.** A range is at most 42 days (six whole weeks, the largest month grid); the agenda loads 14 days at a time. Each layer stops at 500 rows and names itself in `truncated`, and the page says some items are hidden.
- **Days are company days.** «Today» and meeting days use the company time zone (`loadWorkCalendar`), like reminders and the daily plan.
- **Screens.**
  - `/calendar`, in the sidebar after meetings; on phones in the «سازمان» hub and as a link on the today screen's meetings card (answer 3). The tab bar keeps five tabs.
  - Phones open on the agenda (from today, only days with something, plus today), wide screens on the month; `?view=` overrides. The view is chosen after mount (`matchMedia`) to avoid a hydration mismatch.
  - The month is `CalendarMonth` in `@madar/ui`: whole Saturday-to-Friday weeks (`monthRange`), dots on narrow screens, three labels and «+n» on wide ones; a day opens beside the month on desktop and in a sheet on phones.
  - Layers are colours from design tokens (`--color-layer-*`), toggled with `LayerToggle`; the choice is a per-device convenience in `localStorage` (`madar.calendar.layers`), wrapped in try/catch, never sent to the server.
  - Live refresh: the existing `work`, `today` and `meetings` realtime hints also invalidate the calendar queries. No new hint.
- **Read-only.** Nothing is changed from the calendar in 14a; an item opens its own page. The one shortcut is «جلسه تازه» on a selected day (today or later), which opens the meeting form on that day (`/meetings/new?date=`, 09:00 for a later day).
- **Accessibility.** The month is a plain table of buttons (no `role="grid"`, so no arrow-key promise); today carries `aria-current="date"`, the selected day `aria-pressed`, and each day's name says how many items it has and whether it is a holiday or a day off. A weekday column is red only when the company does not work it.

## Step 14b: week and day views, moving due dates, team calendars
Plan `docs/plans/phase-2-step-14b.md`, with the proposed answers (no «busy» blocks; oversight is not a team; dropping on a past day is allowed).
- **Views.** Wide screens: «هفته» (default), «روز», «ماه», «فهرست زمانی». Phones: «فهرست زمانی» (default), «روز», «ماه»; a `?view=week` on a phone becomes the day view. The view, the day (`?date=`) and the person (`?member=`) live in the address.
  - `WeekGrid` (`@madar/ui`): a header, an all-day row and an hour grid. The hours are the company's working hours on the shown days, widened for any meeting outside them (`timeGridSpan`); each day's `hours` comes with the range. Overlapping meetings sit side by side (`layoutOverlaps`); a meeting past midnight stays on its first day. A red «اکنون» line marks the time on today.
  - The day view is a `DayStrip` (the week, busy days dotted), the day's all-day items at full width, and the hour grid only when there are meetings. It reads the same week range as the week view, so the two share a cache.
- **Moving a due date** is the existing `PATCH /api/tasks/:id` with `version` and `dueOn`. There is no new write path, so permissions, events, notifications and the task's activity stay as they were.
  - Each task item carries `version` and `editable`, computed with `editableTasks(viewer)` in the same query. Only open, editable tasks with a due date (or past due) move; a plan-only item, a meeting, a project or a period never does.
  - Drag and drop with dnd-kit (`CalendarDnd`, `DragItem`, `DropDay`): mouse, touch hold, and keyboard (Space on the handle, arrows jump between days by their position on screen, Space to drop), announced in Persian. The days of the week row, the month cells and the day strip are drop targets.
  - «تغییر سررسید» (a `DatePicker` in a dialog) does the same for phones and keyboards, on every view including the agenda.
  - The move is optimistic in every cached range (`moveDueInRange`): the due item leaves its day or the past-due list (a plan item stays, no longer due) and lands on the new day, or in the past-due list if the day is past. An error rolls it back; a version conflict says the task changed meanwhile. A toast offers «برگرداندن». A day off or holiday asks for confirmation first; a past day is allowed, as on the task page.
- **Team calendars.** `GET /api/calendar?member=` and `GET /api/calendar/people`, both through one condition, `calendarPeople(actor)` in `apps/api/src/calendar/access.ts`:
  - myself; the active members of departments I head or manage; everyone, for a role granting tenant-wide `task.read` (role grants only: oversight reads pages, not people's calendars);
  - anyone else, or anyone from another company, is a plain 404 (`not_found`).
  - Only «whose» changes (assignee, participant, project member). Every layer still uses the **viewer's** visibility: `visibleTasks(me)`, `visibleMeetings(me)` (so another person's one-on-ones stay out), `visibleProjects(me)`. Someone else's daily plan and meeting replies are never returned; the layers dialog drops the plan layer for them and says why.
  - Seeing a colleague's calendar is not a sensitive action (ADR 0009) and is not audited; moving a due date is the task's normal activity.
  - The people picker is a native select, names sorted alphabetically, with no counts or ranking (gamification red lines).

## Consequences
- No migration and no RLS change: isolation comes from the tables the calendar reads, each already under forced RLS. The integration test still checks that another company sees nothing.
- Adding a layer means a contract value, one query using that resource's visibility condition, a token colour and an i18n string.
- A project or a goal period has only an end date in the calendar; spans (start to end bars) are not drawn.
- A manager sees one person at a time; a combined team view, «busy» blocks for meetings they cannot see, and moving meetings by drag are left for later.
- `editable` is computed on read; if task edit rules change, `editableTasks` and `canEditTask` must stay twins.
