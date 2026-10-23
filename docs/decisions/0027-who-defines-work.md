# 0027 — Who defines goals, projects and work; sub-goals

- Status: Accepted
- Date: 2026-10-24

## Context
Phase 3, step 17a (`docs/plans/phase-3-step-17a.md`): corrections from the product owner after using the app. Until now any member created projects, set their own personal goals and gave tasks to any colleague. The owner wants goals and projects to come from managers and the CEO, work inside a project to flow between everyone on it, work outside projects to flow down to subordinates only, and goals to break into sub-goals. A calendar preview on the home page was asked for in the same round.

## Decision
- **Leadership** (`leadsCompany` in `apps/api/src/work/access.ts`, mirrored in `apps/web/src/lib/roles.ts`): owners (`task.manage` at tenant scope) and executives (`goal.manage` at tenant scope). No new role and no permission migration.
- **Manager of someone**: a head or manager of one of that person's departments, or anyone above them in the reporting line (`members.manager_id`, the same chain `sourceFor` reads).
- **Goals**: created only by the leadership (any level) or a department's managers (that department's goals and its people's personal goals); employees create none. Defining a goal (title, owner, parent, key results, archive) is `canDefineGoal`; recording progress is `canCheckIn` (the owner too). The API returns both as `can.edit` and `can.checkIn`.
- **Sub-goals**: a parent at the same level or above (`PARENT_LEVELS`), same period, visible and active; no cycles (checked by walking up from the new parent), and the chain is at most `GOAL_DEPTH_MAX` = 5 levels (the roll-up's bound). Errors are `goal_parent_invalid`.
- **Projects**: created by a department's managers in that department, or by the leadership (who alone may create one without a department). Existing projects are unchanged.
- **Tasks in a project**: anyone who may add work to it (`usableProjects`, unchanged) creates its tasks, in the project's department, even from another department, and may give them to anyone who sees the project (`projectReachableBy`, the `visibleProjects` rule evaluated for another member in SQL).
- **Tasks outside a project**: a member creates them in their own departments for themselves or unassigned; giving one to someone else needs the leadership or being that person's manager. `PATCH` applies the same rule to a new assignee and to a task moving into or out of a project (a task given inside a project cannot leave it with a peer on it). Refusals are `assignee_not_allowed`. `GET /api/tasks/assignees?projectId=` lists who the form may offer.
- **Home calendar card** (`CalendarPreview`): the next seven days from `GET /api/calendar` with the device's layers, a day strip with a dot per busy day, up to five rows for the chosen day, and «تقویم کامل». It adds no endpoint and no visibility of its own.

## Consequences
- A colleague's request (task source `request`, ADR 0017) now happens inside a shared project; outside one, work flows only down the organisation.
- Meeting decisions and tasks made from messages follow the same assignee rule, because they go through `TasksService.createIn`.
- A department head of a parent department does not manage the people of its child departments unless the reporting line says so (open question 1 of the plan).
- The membership list for the goal owner and the assignee lists (task fields, «تبدیل به کار», task from a message, the assistant's breakdown) are hints; the API checks every write again.
- The depth check locks the moved goal and its new parent only; two concurrent moves in one chain could together pass five levels, which only stops the roll-up early. Acceptable at pilot scale.
- Private-project observers count as «seeing» the project, so work may be given to them even though they add none themselves.
