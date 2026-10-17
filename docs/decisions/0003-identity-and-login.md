# 0003 — Identity and login

- Status: Accepted
- Date: 2026-10-17

## Context
The product owner wants accounts created by company admins (username + password handed to employees) for the MVP, with phone number + SMS code login later. Admins need 2FA.

## Decision
- Better Auth, self-hosted inside `apps/api`, used **only for identity** (users, sessions, accounts, verification, two-factor). Tenants, members and roles are our own tables. The organization plugin is not used.
- Global identity (`users`, control plane) + per-tenant membership (`members`, data plane). Session stores `active_tenant_id`.
- MVP login: **username + password**. Usernames are globally unique and lowercase; when an admin creates a member the UI suggests `firstname.lastname` and appends a short tenant code if taken.
- Admin creates the account with an initial password; `must_change_password` forces a change on first login. Admin password resets are audited.
- Rate limiting and temporary lockout on failed logins. Password hashing with Better Auth's default (scrypt) or argon2.
- 2FA (TOTP) is mandatory for members with `owner` or `admin` roles; without it the session can only reach the 2FA setup page.
- Later: phone + SMS OTP through a domestic SMS provider behind a `Messenger` interface. `users.phone` exists from day one. Email/link invitations are deferred.

## Alternatives considered
- Email + password with invitations: emails to Iranian corporate inboxes are unreliable, and the owner prefers admin-issued credentials.
- Separate accounts per tenant: simpler per-tenant usernames, but one person in two companies needs two accounts.

## Consequences
- Login page has two fields (username, password); no tenant field. A user in several tenants picks the active tenant after login.
