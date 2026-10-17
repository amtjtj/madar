# 0007 — Gamification data and streak rules

- Status: Accepted
- Date: 2026-10-17

## Decision
- XP is an append-only ledger (`xp_ledger`) with `UNIQUE (source_event_id, reason)`; reopening a task writes a reversal row. `member_stats` is a rebuildable cache.
- XP = base × manager-set weight (1–5), with on-time bonus, small XP for helping and receiving kudos, and a daily cap. Self-created, self-closed tasks without a manager weight earn minimal XP.
- **Complete day (streak):** the member has a "today plan" (`daily_plan_items`) with at least one item and completes at least 70% of its items by end of day in the tenant timezone. The percentage is a tenant setting.
- `streak_days` records each day as `completed`, `missed`, `excused_holiday`, `excused_leave` or `off_day`. Excused and off days neither break nor extend a streak.
- Default work week: Saturday–Wednesday full days, Thursday half day, Friday off; configurable per tenant. Iranian official holidays are seeded per Jalali year.
- Kudos have a weekly allowance per Jalali week (Saturday start).
- Levels are computed from XP by a formula in `packages/shared` (no table).
- Red lines: no endpoint returns a tenant-wide individual ranking; the HR module may not import from the gamification module (lint rule); gamification notifications respect quiet hours.
