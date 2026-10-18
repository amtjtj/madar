# 0012 — Installable app (PWA) and Web Push

- Status: Accepted
- Date: 2026-10-18

## Context
Phase 1, step 6b (`docs/plans/phase-1-step-6b.md`). The brief rules out native apps: Madar must install from the browser and still reach people when it is closed. The product owner accepted Web Push as «better than nothing», with generic text only, because a push message always passes through the browser vendor's push service (Google for Chrome and Android, Apple for Safari and iPhone, Mozilla, Microsoft). That service may be slow or cut off from Iran; Madar must keep working without it.

## Decision
- **Manifest and icons:** `app/manifest.ts` (Persian, `dir: rtl`, standalone, shortcuts). Icons are rendered from the SVG logo by `apps/web/scripts/icons.mjs` with the local Chromium and committed; no online generator.
- **Service worker:** hand-written, served by the route `app/sw.js/route.ts` so its strings come from the i18n file. It never caches pages or API responses (phones are shared, and company data must not stay on a device after sign-out). A failed navigation gets a self-contained offline page, inline in the worker, and only the icons are pre-cached. The cache name is a hash of the worker's content. No Workbox or next-pwa.
- **Keys:** our own VAPID key pair in `.env` (`pnpm --filter @madar/api vapid:generate`). Without keys `GET /api/push/config` reports push as off, subscriptions are refused (`push_disabled`) and the rest of the app works. An optional `PUSH_PROXY_URL` covers servers that need a proxy to reach the push services. Library: `web-push`, which only does the encryption and VAPID signing in Node.
- **Subscriptions:** table `push_subscriptions` (tenant_id, forced RLS, composite FK to members), one row per browser endpoint and company (unique `(tenant_id, endpoint)`, upsert). A member registers and removes only their own device; registering a browser another member of the same company used before takes it over (endpoints are secret URLs only that browser knows). Endpoints must be `https` on the default port at a known push service host (`isAllowedPushEndpoint` in shared, checked on subscribe and again before sending), so a subscription cannot make the worker call an arbitrary address (SSRF).
- **Shared phones:** signing out deletes the device's subscription on the server and in the browser. If someone signs in without the previous person having signed out (expired session, other company), the app shell notices that the subscription was made for someone else and renews it in the browser; the old endpoint then answers «gone» and every company drops it.
- **Delivery:** `notification.created` now carries the notification id. The worker's `push` consumer schedules a delayed BullMQ job per recipient and time slot (`PUSH_BATCH_MS`, default 10 s), set by the notification's `deliver_after`. Bursts, and everything held back by quiet hours, become one push. A notification for a member with no device is marked pushed at once, so it is never part of a later pile.
- **The delivery job** runs inside `withTenant(tenantId)`:
  - It claims the member's unread notifications that are due and not yet pushed (`FOR UPDATE`, sets `pushed_at`), so nothing is pushed twice.
  - Notifications older than 12 hours are marked and never pushed; push services drop messages after the same time.
  - It sends after that transaction commits (push services can be slow) and records the outcome in a second one. Success resets the failure count, 404/410 deletes the subscription at once, and five failures in a row delete it.
  - If every device failed, the claim is released and the job throws, so BullMQ retries it with backoff (at least once within the 12-hour window).
  - Inactive members and locked companies get nothing. Notifications that already existed before this step were marked as pushed.
- **Content:** a push carries `{ v, kind, count, subject }` only. The service worker builds a generic Persian sentence from the kind and count («یک کار تازه به تو سپرده شد», «۳ اعلان تازه در مدار»). No task titles, names or company text leave our servers. A tap opens the task or project (one notification) or the notification list.
- **UI:** the permission prompt appears only after the member taps «turn on». Install guidance shows the browser's dialog on Android/Chrome and Add to Home Screen steps on iPhone, where push works only in the installed app. Phones that have not installed the app see a one-time, dismissible card on Today.

## Alternatives considered
- Our own push channel (a long-lived socket from the installed app): impossible while the app is closed, and mobile browsers do not keep background connections.
- Sending titles in the push for richer notifications: rejected. Push services and lock screens would see company data.
- Offline reading of Today (caching API data): deferred. It needs a decision about data at rest on shared phones (encryption, wipe on sign-out).

## Consequences
- In Iran, push may arrive late or not at all when a vendor's service is blocked. The in-app bell and realtime remain the reliable channels.
- Rotating the VAPID keys invalidates every subscription. Members re-enable push on their devices (the settings card notices a changed key and subscribes again).
- The offline page lives inside the service worker with its own colors, copied from the theme tokens; a token change must be copied there by hand (`apps/web/src/lib/service-worker.ts`).
- No app icon badge for now: a correct number would need the total unread count in every push.
- The rate-limited test push (`POST /api/push/test`) is sent from the API process. Everything else is sent by the worker.
