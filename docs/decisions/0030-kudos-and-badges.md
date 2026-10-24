# 0030 — Kudos and badges

- Status: Accepted
- Date: 2026-10-24

## Context
Phase 3, step 18b (`docs/plans/phase-3-step-18b.md`): the second half of «گیمیفیکیشن پایه» in the brief, «قدردانی همکار به همکار» and «سطح و نشان», on the XP ledger of ADR 0029. The product owner approved the plan as proposed: 5 thanks a week, six fixed value tags, public thanks visible to the whole company.

## Decision
- **Kudos** (`kudos` table): one colleague, one value tag (`teamwork`, `help`, `quality`, `speed`, `learning`, `initiative`), a 3–280 character message and optionally a task. Rules, all checked in `KudosService.give` under a per-giver advisory lock:
  - `kudosPerWeek` (5) per Jalali week, in the company's time zone (`kudos_limit`);
  - at most two to the same person a week (`kudos_same_person`);
  - never yourself (`kudos_self`, also a check constraint);
  - the task must be visible to the giver;
  - refused while gamification is off (`gamification_off`).
  Kudos are never edited or deleted. The receiver may hide one from their profile (`hidden_at`), the only change a restrictive RLS policy allows, and only to the receiver.
- **Who reads** (`visibleKudos`): a public thanks, everyone in the company; a private one, only its giver and receiver. A task title is shown only to readers who see the task. Lists are by time only; no endpoint counts, compares or orders people by kudos or badges.
- **XP**: receiving a thanks pays 5 (`kudos_received`), giving pays nothing so nobody trades thanks. Finishing work a colleague asked for in a shared project (source `request`) pays 5 more (`helped`), taken back with the task like the rest.
- **Badges**: 15 ready-made badges defined in code (`BADGES` in `packages/shared/src/gamification.ts`), each a counter and a threshold. The counters are:
  - finished tasks and on-time tasks;
  - best streak and best level;
  - kudos received and kudos given;
  - goal check-ins on one's own goals.
  `refreshCounters()` recounts them from their sources whenever one may have moved (task completed, reopened or deleted, kudos, check-in, a longer best streak, a new level) and caches them in `member_counters`. Counting from the source means a capped, reopened or deleted task can never leave a counter wrong. A badge reached is inserted once into `member_badges` (insert-only) and kept for good, even if its counter falls later. `member.badge_earned` notifies the member.
- **Profiles** (`/members/:id`): name, departments, earned badges and public kudos received. Never XP, level or streak (ADR 0029); locked badges and counters are shown only to their owner (`/api/me/badges`).
- **Notifications**: `kudos_received` (to the receiver, without the message, so push never carries it) and `badge_earned`, through `Notifier` with quiet hours. Realtime hint `kudos.changed` to the two people, and to the whole company for a public thanks (the home card).
- **Screens**:
  - `ThankDialog` (from a finished task's assignee, a profile and the home card);
  - the «قدردانی‌های تازه» card on every home tab;
  - badges and received kudos on «پیشرفت من»;
  - `kudosPerWeek` under «گیمیفیکیشن» settings.
  Components: `KudosCard`, `ValueTagPicker`, `BadgeGrid`.

## Consequences
- No `badge_definitions` table yet: custom and department badges (like «حل ۱۰۰ تیکت») come with the department template.
- `member_counters` joins the lint rule that keeps gamification data inside `src/gamification`. Kudos and badges are public recognition, but they are not an evaluation input either; no report or HR view reads them.
- Hidden kudos still count towards the receiver's badges (the thanks happened).
- The value tags are fixed until companies can set their own.
