# 0004 — Department modules as versioned config

- Status: Accepted
- Date: 2026-10-17

## Context
The brief requires any department to be launchable without code (department template), while four modules are deep in the MVP.

## Decision
- A department module is a JSONB config document in `module_configs`, validated by the Zod schema `ModuleConfig` in `packages/shared`. It defines vocabulary, fields, workflows (statuses with a category), work item types, project types, forms, approval flows, metrics, dashboard and views, plus a small closed set of automations.
- Every save creates a new version. Open approval requests keep a snapshot of their flow.
- Keys are immutable; labels are editable. Rows store `type_key`, `status_key` and a denormalized `status_category` (`todo`/`in_progress`/`done`/`canceled`) so cross-department reports never need to parse configs.
- Built-in modules are templates in code (`packages/shared/templates`) copied into the tenant on department creation, plus optional registered custom views in `apps/web/src/modules/`.
- "Config first, table last": a module-specific table needs its own ADR and the same RLS rules.
- Tasks have exactly one accountable `assignee_id` plus `task_collaborators` (collaborator/watcher). Mizito tasks with several assignees import as first assignee + collaborators.

## Alternatives considered
- Normalized config tables (statuses, fields, …): referential integrity in the DB, but harder versioning, template export/import and atomic changes.

## Consequences
- Integrity between rows and config is enforced by the API and the config editor (deleting a status requires a mapping).
- Config schema evolution needs `schemaVersion` and code migrations.
