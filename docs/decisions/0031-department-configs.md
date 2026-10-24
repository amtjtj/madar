# 0031 — Department configs: work types, statuses and custom fields

- Status: Accepted
- Date: 2026-10-24

## Context
Phase 3, step 19a (`docs/plans/phase-3-step-19a.md`) starts «قالب دپارتمان» from the brief: an admin launches any department without code. ADR 0004 already chose a versioned JSONB config validated by Zod; this step builds its work half (vocabulary, statuses, work types, fields). Forms and approval flows come in 19b, metrics, dashboards and department badges in 19c. The product owner approved the plan as proposed (only company admins edit configs; six built-in templates).

## Decision
- **Storage.** `module_configs` holds append-only versions per department (`GRANT SELECT, INSERT`, unique `(tenant, department, version)`). The highest version is active. A department with no row runs on the general template (version 0), so no data migration was needed.
- **Schema.** `moduleConfig` (`packages/shared/src/module-config.ts`, `schemaVersion: 1`): `vocabulary`, `fields` (10 types: text, longtext, number, money in toman, date, select, multiselect, member, url, boolean), `workflows` (statuses with category and colour token), `workItemTypes` (icon, workflow, fields, default weight). It needs a `todo` and a `done` status in every workflow, unique keys, and the same category for a status key across workflows. Later steps add optional keys, so the schema version stays 1.
- **Templates.** Six templates in code (`packages/shared/src/templates.ts`): general, executive, engineering, marketing, support, hr. Labels are i18n keys (`templates.*`) resolved once by the API (`@madar/i18n`) when a department is made or a template applied; from then on the text is company data. Every template keeps the core keys `todo`, `in_progress`, `done` and `canceled`. «کار» (weight 1) comes first wherever a heavier type exists.
- **Keys and categories are immutable.** Admins never see keys; the editor makes them (`newConfigKey`). A kept status keeps its category (`invalid_config` otherwise) and a kept field keeps its type in the editor.
- **Removing a status or type in use** needs a mapping (`status_mapping_required`, `type_mapping_required`). A status moves only within its category, so completion times, XP, streaks and reports never change behind people's backs, and no task events are emitted.
- **Saving** locks the department row and needs the version the editor read (`config_version_conflict`). It is audited with versions and counts, never the whole document, and emits `department.config_changed` (realtime `module_config.changed` to the whole company, plus `work.changed`).
- **Tasks.** `tasks.custom_fields` (jsonb) holds values by field key, checked by `validateFieldValues` against the type's fields. Member values must be active members. Required fields are enforced when the request names the type or sends fields; a title-only quick capture may leave them for later, and the task page flags the empty ones. `statusCategory` in `PATCH /api/tasks/:id` goes to the workflow's first status of that category: the check, reopen, and recorded progress (first `in_progress`) all use it. No code outside the templates names a status key.
- **Default weight.** The type's default weight applies, except on one's own task for someone who may not set weights (XP follows weight, ADR 0029).
- **Reports** (dashboard, weekly report, calendar, XP, streak, assistant) keep reading `status_category` only.
- **Web.** Configs are read once (`useModuleConfigs`, `GET /api/module-configs`, readable by every member) and refresh on the hint. Status chips and type icons come from `@madar/ui`. A one-department board uses the department's statuses as columns; boards spanning several departments use the three categories. The editor lives at `/departments/:id/settings`.

## Alternatives considered
- Tables per status, type and field: integrity in the database, but no atomic save or easy history; rejected in ADR 0004.
- Letting a mapping change a status's category: it would complete or reopen work silently and move XP.
- Enforcing required fields on every create: quick capture from «امروز» would fail for any department with a required field.

## Consequences
- The integrity between rows and config is kept by the API (`configFor`, `requireStatus`, mappings) and the editor, not by foreign keys.
- Tasks never change department today; if that is added, the type and status must be re-mapped the same way.
- Several workflows per department are accepted by the schema but the editor builds one; a status left outside its type's workflow only appears when workflows multiply.
