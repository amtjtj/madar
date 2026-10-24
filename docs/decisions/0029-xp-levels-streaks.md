# 0029 — XP, levels and streaks

- Status: Accepted
- Date: 2026-10-24

## Context
Phase 3, step 18a (`docs/plans/phase-3-step-18a.md`): the first half of «گیمیفیکیشن پایه» from the brief, on the data model of `docs/architecture.md` §6 and the rules of ADR 0007. Badges and peer kudos follow in step 18b. The product owner approved the plan as proposed: XP and streak are visible to the person only, a working day without a plan counts as missed, and the pilot starts with it on.

## Decision
- **XP rules** (`packages/shared/src/gamification.ts`, shared by the worker, the seed and the web's «+XP» estimate):
  - Finishing a task pays its assignee 10 × the manager's weight (1–5), plus 5 × weight if it is done by the end of its due date.
  - A personal task (source `personal`, ADR 0017) with weight 1 pays 2.
  - The goal owner's first check-in of a key result in a Jalali week pays 5 (this stands in for the brief's «گزارش به‌موقع», since weekly reports are built by the system).
  - At most `dailyXpCap` (150) a day per person; reversals do not free room.
- **Ledger**: `xp_ledger` is insert-only (RLS) with `UNIQUE (tenant_id, reason, source_key)`; the key is the source, e.g. `task:<id>:<completed at>`, so a repeated event, a retried job or the seed never pays twice. Reopening or deleting finished work writes one negative `reversal` row per member for what the task still holds (keyed by the event); deleting also takes back what its subtasks held, since they are deleted with it. `member_stats` is a cache of the total and the streak.
- **Who writes**: only the worker. `GamificationConsumer` handles `task.completed`, `task.reopened`, `task.deleted`, `key_result.checked_in` and approved `request.decided`; `ledger.ts` (`grant`, `reverseTask`) holds a per-member advisory lock so two events cannot both slip under the cap. A level never reached before (`member_stats.best_level`) emits `member.level_up`, so finishing, reopening and finishing again near a threshold celebrates once; (notification `level_up`, to the member only, through `Notifier` and quiet hours); any change emits `member.progress_changed` (realtime hint `progress.changed` to the member's room).
- **Levels**: level L needs 50 × L × (L − 1) XP (`levelOf`); no table.
- **Streaks**: `StreakJob` (every 15 minutes, with the reminders) closes each finished day per active member into `streak_days` (primary key per member and day; at most 14 days back after downtime):
  - `completed` when «برنامه امروز» had at least one item and `completeDayPercent` (70) % were done by the end of the day;
  - `excused_holiday`, `off_day` or `excused_leave` (an approved daily leave);
  - otherwise `missed`.
  Excused and off days neither break nor extend the streak, and neither does a day that was never closed (before joining, after an outage longer than the backfill); days while the company has it off are `off_day`. The job and a late leave correction take a per-member advisory lock before touching the cached streak. A leave approved afterwards turns those `missed` days into `excused_leave` (the only change the restrictive RLS policy allows) and recounts the streak. Today never breaks the streak; once complete it already counts in `/api/me/progress`.
- **Only mine**: `/api/me/progress`, `/api/me/xp` and `/api/me/streak` take no member id and read `ctx.memberId` only; no role, oversight or manager sees anyone else's XP or streak, and nothing is ordered by XP. Settings live in `tenants.settings.gamification` (`enabled`, `completeDayPercent`, `dailyXpCap`), changed with `tenant.manage` and audited (not a separate table, unlike the architecture sketch).
- **Never an evaluation**: an ESLint rule keeps `xpLedger`, `streakDays` and `memberStats` inside `src/gamification` (the seed excepted), and a future `src/hr` may not import gamification at all. No report, dashboard, export or assistant input reads them.
- **Screens**: the «پیشرفت من» card on the home «امروز» tab (streak, level, what today still needs), the «+XP» chip on the check of my own tasks (`useXpFor`), a short level-up celebration once per new level per device, `/progress` (level, streaks, the last 12 weeks with `StreakMap`, XP history) and `/org/gamification`. Components: `StreakFlame`, `LevelBar`, `StreakMap`, `XpRow`, `LevelUpMark`.
- **Seed**: the demo company gets XP from its eight weeks of finished work through `grant`, three weeks of closed days, and its earlier events marked as handled so the worker neither pays twice nor sends level-up notifications at start.

## Consequences
- XP «for helping a colleague» and «for receiving kudos» arrive with kudos in step 18b, on the same ledger (new reasons).
- No «streak in danger» reminder: it is pressure, which the brief rules out.
- The «+XP» chip is an estimate (it ignores a partly full cap); the ledger is the truth.
- A day closed while the plan was empty counts as missed, so a person who never plans has no streak; the home card says so in the morning instead of nagging.
- Moving `completeDayPercent` affects only days not yet closed.
