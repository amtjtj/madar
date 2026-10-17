# 0009 — Append-only, hash-chained audit log

- Status: Accepted
- Date: 2026-10-17

## Context
The pilot is a fintech. Changes to roles, permissions, credentials and structure must be traceable, and the trail itself must be trustworthy even against someone with database access.

## Decision
- One `audit_logs` table (data plane, forced RLS). The application role has **SELECT only**; rows are added exclusively through `app.append_audit(...)` (SECURITY DEFINER).
- Each tenant has its own chain: `seq` 1, 2, 3, … and `hash = sha256(prev_hash | tenant | seq | actor | action | subject | before | after | time)` computed by `app.audit_hash`. A per-tenant advisory lock serializes appends so the chain never forks.
- The actor (user and member) comes from the transaction's `app.user_id` / `app.member_id`, set by `withTenant`; IP and user agent are passed by the API.
- `app.verify_audit_chain()` returns the first broken link (gap, wrong `prev_hash`, or contents that no longer match the hash).
- Writes happen in the same transaction as the change, never through the event outbox, so no sensitive change commits without its entry.
- Recorded actions (step 4): `tenant.created`, `member.created|updated|roles_changed|departments_changed|password_reset|two_factor_reset|suspended|activated`, `department.created|updated|archived|oversight_changed`.

## Consequences
- Tampering is detectable but not preventable by a superuser; a periodic export of chain heads to write-once storage is planned.
- Action names are dotted (`member.created`); UI labels live under `audit.actions.member_created` because `t()` treats dots as nesting.
