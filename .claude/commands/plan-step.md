---
description: Write the plan for the next Madar step and stop for approval
argument-hint: <step number and goal, e.g. "6 notifications and realtime">
---

We are starting Madar step: $ARGUMENTS

1. Read `CLAUDE.md` (and `apps/api/CLAUDE.md`, `apps/web/CLAUDE.md`), the relevant parts of `docs/brief.md` and `docs/architecture.md`, the ADRs this step touches, `docs/pilot-assumptions.md`, and the previous plan in `docs/plans/` to match its format.
2. Look at the current code for anything this step builds on. Do not assume; open the files.
3. Write `docs/plans/phase-<phase>-step-<n>.md` in Persian, in the same structure as the previous plan:
   - goal (one paragraph, from the user's point of view)
   - scope table: in this step / left for later
   - data model (tables, columns, RLS, isolation tests)
   - permissions
   - API endpoints
   - screens (mobile-first, RTL), empty and loading states
   - tests (unit, integration with cross-tenant check, e2e at 360px and 1440px)
   - work order: numbered stages, each one a green commit
   - decisions I made (table), and open questions for the product owner
4. Keep the step small enough to finish in one session. If it is too big, split it and say so.
5. Commit the plan alone (`docs: plan for step <n>`) and push, then **stop**. Show me a short Persian summary: what will be built, the decisions, and the questions. Do not write any code until I approve.
