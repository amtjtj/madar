---
description: Verify, review and close the current Madar step
argument-hint: <base commit or branch where the step started, optional>
---

Close the current Madar step. Base for the review: $ARGUMENTS (if empty, use the commit of the step's plan in `docs/plans/`).

1. Make sure Postgres and Redis are running and migrated (`pnpm db:migrate`), then run `pnpm check` and `pnpm test:e2e` (set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` if Playwright cannot download its browser). Fix anything red. Run the full test suite twice; if a test passes only sometimes, find the cause (shared DB state, ordering, timing) and fix it instead of retrying.
2. Reseed (`pnpm db:reset && pnpm db:seed`), run a production build (`pnpm build`, then start api and web; production catches hydration errors dev hides) and, with the Playwright MCP (or a Playwright script with a local Chromium if the MCP browser is unavailable), open every screen this step added or changed at 360px and 1440px, light and dark. Watch the console for errors. Fix layout, RTL and overflow problems. Note anything that looks generic or unfinished.
3. Run the `madar-reviewer` subagent on the diff since the base. Fix every blocker and every "should fix" unless you have a clear reason not to; list those reasons.
4. Update docs: plan status → «پیاده‌سازی شد», new ADR if an architectural choice was made, `CLAUDE.md` rules or commands if the workflow changed, seed data if new screens would look empty in a demo.
5. Commit in small green commits and push, then check CI on the pushed commit and fix it if red.
6. Finish with a short Persian report for the product owner:
   - what a user can now do (in plain words, no code terms)
   - what to test by hand, as a numbered checklist with the seed usernames to use (password `SEED_PASSWORD`, default `madar-demo-1234`; e.g. `ali.rezaei` employee, `maryam.ahmadi` support head, `kian.nouri` engineering, `shiva.kazemi` marketing, `reza.karimi` owner with 2FA)
   - known limitations and what the next step should be
