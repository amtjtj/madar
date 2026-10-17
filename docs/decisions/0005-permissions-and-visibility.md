# 0005 — Permissions and visibility

- Status: Accepted
- Date: 2026-10-17

## Context
Product owner decision: everyone sees only their own department, except special departments such as executive management or HR.

## Decision
- Permissions are `action` + `scope` (`tenant`, `department_tree`, `department`, `own`), defined in `packages/shared/permissions.ts`.
- Tenant roles (`owner`, `admin`, `executive`, `hr_manager`, `finance_approver`, `member`) map to grants in `role_grants`. Department roles (`head`, `manager`, `member`, `viewer`) give fixed grants within that department.
- Default visibility: own department(s) + anything the member is involved in (assignee, collaborator, project member) + projects with `visibility = tenant`.
- **Oversight departments:** a department can carry an `oversight` setting granting its members tenant-wide **read** on specific resources:
  - Executive management: tasks, projects, goals, metrics, approvals.
  - HR: members, departments, org chart, leaves — not other departments' work content.
  Only `owner` can change oversight; every change is audited.
- Enforcement in the API: `can()` for single resources, `scopeFilter()` producing Drizzle conditions for lists. UI uses `can()` only for hiding. RLS stays tenant-only.
- Own small engine; no CASL.

## Consequences
- Every list endpoint must use `scopeFilter()`; covered by tests per role.
