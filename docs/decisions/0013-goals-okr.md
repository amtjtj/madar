# 0013 — Goals (OKR) in three levels

- Status: Accepted
- Date: 2026-10-18

## Context
Phase 1, step 7 (`docs/plans/phase-1-step-7.md`). The brief asks for company, department and personal goals aligned to each other, with key results and regular progress updates, and a CEO who understands company status at a glance. ADR 0005 already lets oversight departments read goals company-wide; this ADR fixes the rest of the visibility, who may create what, and how progress is computed.

## Decision
- **Periods** are Jalali seasons (`goal_periods`: year, quarter, start and end date). The current and next season are created on demand (idempotent), so nobody has to set them up. The UI names them from i18n («پاییز ۱۴۰۵»), not the database.
- **Goals** have a level (`company`, `department`, `individual`), a department (none for company goals, enforced by a CHECK), an owner and an optional parent. The parent must be active, in the same period and exactly one level up (personal goals may also hang directly under a company goal). Cycles are therefore impossible. Goals and key results are archived, never deleted. Archived ones leave their parent's progress.
- **Key results** are `number` (start, target, current, unit; a decreasing target such as 24 h to 4 h works), `percent` (0 to 100) or `boolean`, each weighted 1 to 5. **Check-ins** record value, status (`on_track`, `at_risk`, `off_track`) and an optional note. They are append-only: the app has no UPDATE or DELETE grant on them.
- **Progress** is never entered by hand:
  - A key result: `(current − start) ÷ (target − start)`, clamped to 0..1.
  - A goal: the weighted mean of its key results plus its active child goals (weight 1 each).
  - A goal's status: the worst latest status among its key results.
  - Every check-in or structural change recomputes the goal and walks up the parent chain in the same transaction, locking rows (`FOR UPDATE`).
  - The first time a goal reaches 100 % it gets `completed_at` and a `goal.completed` event. That happens once only, so gamification cannot farm it.
- **Visibility** (SQL in `apps/api/src/goals/access.ts`):
  - Company goals: everyone in the company. Alignment needs them.
  - Department goals: members of that department, oversight departments, and roles with `goal.read` at tenant scope.
  - Personal goals: the owner, the department's head and managers, oversight and tenant-wide readers; not peers, so nobody is compared or pressured.
  - Lists, details, parents, child counts, key result pickers and links all use the same condition.
- **Creating and editing:**
  - Company goals need the new permission `goal.manage` (owner and executive roles; a data migration grants it in existing companies; admin does not get it, being system administration, not content).
  - Department goals: the department's head or manager, or `goal.manage`.
  - Personal goals: the member in their own department, or their head or manager.
  - The goal's owner may edit and check in. Company goal changes and every archive are audited.
- **Links:** tasks and projects carry an optional `key_result_id` (composite FK). Only someone who may edit the task or project, and who can see the key result, may set it. Linked work is shown under the key result, filtered by the viewer's task and project visibility. It does not drive progress (owner's decision).
- **Weekly reminder:** a notification kind `key_result_checkin_due`, subject `goal`. The 15-minute reminder job sends it once per Saturday-based week, after the working day starts, to the owner of a current-season goal that is at least a week old and has a key result without a check-in for seven days. Quiet hours, muting and push work as for every other kind.
- **Events:** `goal.created`, `key_result.checked_in`, `goal.completed` (ids only) for the gamification step.

## Alternatives considered
- Progress typed in by hand per goal: drifts from the key results and invites optimism. Computed progress keeps the tree honest.
- Personal goals visible to the whole department (common in OKR tools): more transparency, but turns into peer comparison, which the brief's red lines rule out. It can become a per-company setting later.
- Key result progress from linked tasks: easy to game and rarely what a key result measures. It may come back as a fourth kind.
- Several parents per goal: real but rare. The single chain keeps rollup and the tree simple.

## Consequences
- Each check-in rewrites a handful of rows up the chain (at most three levels). That is cheap at pilot scale.
- A season's goals stay in their period. Carrying a goal into the next season means creating it again; a «copy to next season» action can come later.
- Moving a person between departments does not move their personal goals; their old department's managers keep seeing them until the season ends.
