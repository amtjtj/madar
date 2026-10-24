# 0028 — Requests and approvals (leave, expense, general)

- Status: Accepted
- Date: 2026-10-24

## Context
Phase 3, step 17b (`docs/plans/phase-3-step-17b.md`): approval workflows are the last piece of the MVP core (`docs/brief.md`: «گردش تایید درخواست‌ها»). Mizito has them, and the department template (custom forms and flows) and gamification (leave never breaks a streak) both build on them. The product owner approved a 10M toman default threshold, both daily and hourly leave, and moving content approval to the department-template step.

## Decision
- **Three kinds, forms in code**: `leave` (daily `startsOn..endsOn` or hourly `on, from..to`), `expense` (`amountToman`, category, description, invoice files) and `general` (title and body). Each form is a Zod schema in `packages/shared/src/contracts/requests.ts`, stored in `approval_requests.data`. A custom form from the department template will use the same columns later.
- **Who approves** (`approvalChain` in shared): step 1 is the requester's direct manager, else a head or manager of their department, else the leadership (`leadsCompany`, ADR 0027). An expense over the company threshold (`tenants.settings.approvals.expenseThresholdToman`, default 10,000,000 toman, `PUT /api/settings/approvals` with `tenant.manage`) adds the leadership as step 2, unless step 1 already is the leadership. Nobody is ever their own approver. The approvers are worked out once at submission and kept in `snapshot`; a later change of manager does not move an open request. The form shows the route (`GET /api/requests/route`) before sending, and refuses to send with none (`no_approver`).
- **Who decides**: the current step's approver; the leadership stands in only when that approver is no longer active. Never the requester. A rejection needs a reason (`comment_required`). The request row is locked while deciding, and a closed request answers `request_closed`.
- **Who sees** (`visibleRequests` in `apps/api/src/requests/access.ts`): the requester, the approvers in the snapshot, the leadership and `approval` oversight; HR (`hr_manager` or `leave` oversight) also sees every leave. No other role is an exception: the `approval.read` and `leave.read` grants are not consulted, because the system administrator holds every grant and must not read people's leave and expenses. A custom HR role would need the `hr_manager` role or `leave` oversight until the department template brings custom roles to this rule. The same condition guards the detail, the boxes, the invoice files (`approval_request` branch of `AttachmentsService`, never removable), notifications and realtime hints.
- **Append-only**: `approval_steps` rows are only inserted; a restrictive RLS policy lets `approval_requests` change only while `pending` (`pending` → `approved` / `rejected` / `canceled`). Submit, decide and cancel are audited without the comment text (the amount is kept for expenses). Amounts are stored in rial as integers and shown in toman.
- **Leave**: the final approval writes a `leaves` row in the same transaction, after checking again for an overlapping approved leave (`leave_overlap`). Daily leave counts working days only (`leaveWorkingDays`, company holidays and days off excluded). The calendar shows approved leave as a new `leaves` layer (`--color-layer-leave`), with the viewer's request visibility; there is no separate `/api/leaves` endpoint.
- **Events and notifications**: `request.submitted`, `request.advanced`, `request.decided`, `request.canceled`; notification kinds `request_waiting` (to the approver) and `request_decided` (to the requester) through `Notifier`, with push strings; realtime hint `requests.changed` to the requester and approvers.
- **Screens**: `/requests` with three boxes (waiting on me, mine, decided by me) and a count in the nav, `/requests/new`, `/requests/:id` with `ApprovalTimeline` and optimistic approve or reject, the home card «منتظر تایید تو» on every home tab (only when something waits), and the threshold under «سازمان» → approvals. Components live in `@madar/ui` (`RequestRow`, `ApprovalTimeline`, `RequestKindBadge`, `RequestStatusBadge`, `AmountText`).

## Consequences
- Editing a sent request is not possible: cancel and send again.
- No leave balance or yearly quota yet; HR reads the `leaves` table for that later, and the streak step reads it to keep streaks unbroken.
- Parallel approval, conditional steps (`when`) and delegation in absence wait for the department template.
- Approving or rejecting gives and takes no XP.
- A manager change after submission leaves the old manager as approver; the leadership can step in only once that person is inactive, and such requests then wait in the leadership's «منتظر من» box and count.
- A department head is not shown a team member's leave on the team calendar unless they were an approver of it; whether heads should see their people's leave is left to the product owner.
- A leader standing in at step 1 who is also the step-2 approver decides both steps; with one CEO this is the expected outcome.
- One leave check runs per person at a time (an advisory transaction lock), so two overlapping leaves cannot both be approved.
