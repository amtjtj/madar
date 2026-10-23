# 0024 — Personal calendar

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
- **Past due appears once.** An open task whose due date has passed is not repeated on its old day; it is listed once in `overdue` (only when today is inside the range, at most 100), shown above today.
- **Bounded requests.** A range is at most 42 days (six whole weeks, the largest month grid); the agenda loads 14 days at a time. Each layer stops at 500 rows and names itself in `truncated`, and the page says some items are hidden.
- **Days are company days.** «Today» and meeting days use the company time zone (`loadWorkCalendar`), like reminders and the daily plan.
- **Screens.**
  - `/calendar`, in the sidebar after meetings; on phones in the «سازمان» hub and as a link on the today screen's meetings card (answer 3). The tab bar keeps five tabs.
  - Phones open on the agenda (from today, only days with something, plus today), wide screens on the month; `?view=` overrides. The view is chosen after mount (`matchMedia`) to avoid a hydration mismatch.
  - The month is `CalendarMonth` in `@madar/ui`: whole Saturday-to-Friday weeks (`monthRange`), dots on narrow screens, three labels and «+n» on wide ones; a day opens beside the month on desktop and in a sheet on phones.
  - Layers are colours from design tokens (`--color-layer-*`), toggled with `LayerToggle`; the choice is a per-device convenience in `localStorage` (`madar.calendar.layers`), wrapped in try/catch, never sent to the server.
  - Live refresh: the existing `work`, `today` and `meetings` realtime hints also invalidate the calendar queries. No new hint.
- **Read-only.** Nothing is created or changed from the calendar in 14a; an item opens its own page.

## Consequences
- No migration and no RLS change: isolation comes from the tables the calendar reads, each already under forced RLS. The integration test still checks that another company sees nothing.
- Adding a layer means a contract value, one query using that resource's visibility condition, a token colour and an i18n string.
- A project or a goal period has only an end date in the calendar; spans (start to end bars) wait for the week view in 14b.
- Shared work (my department's tasks, my team's meetings) is not in a personal calendar; team calendars are 14b.
