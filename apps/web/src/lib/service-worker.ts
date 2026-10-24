import { createHash } from 'node:crypto';

import { t, type MessageKey } from '@madar/i18n';
import { NOTIFICATION_KINDS } from '@madar/shared';

/**
 * The service worker's source (served at /sw.js by `app/sw.js/route.ts`). Strings come from the
 * i18n file. Deliberately small: it never caches API responses or pages (shared phones), only the
 * offline page and the icons; navigations that fail show the offline page.
 */
export function serviceWorkerScript(): string {
  const messages = {
    title: t('app.name'),
    many: t('pwa.pushMessages.many'),
    test: t('pwa.pushMessages.test'),
    kinds: Object.fromEntries(
      NOTIFICATION_KINDS.map((kind) => [kind, t(`pwa.pushMessages.kinds.${kind}` as MessageKey)]),
    ),
  };
  const body = `
const MESSAGES = ${JSON.stringify(messages)};
const OFFLINE_HTML = ${JSON.stringify(offlinePage())};
const PRECACHE = ['/icons/icon-192.png', '/icons/badge-96.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(
        () => new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
      ),
    );
    return;
  }
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
  }
});

function persianDigits(value) {
  return String(value).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}

function messageFor(data) {
  if (data.kind === 'test') return MESSAGES.test;
  if (data.count > 1) return MESSAGES.many.replace('{count}', persianDigits(data.count));
  return MESSAGES.kinds[data.kind] || MESSAGES.many.replace('{count}', persianDigits(1));
}

function urlFor(data) {
  if (data.count === 1 && data.subject && /^[0-9a-f-]{36}$/i.test(data.subject.id)) {
    if (data.subject.type === 'report') return '/reports?report=' + data.subject.id;
    const base = { project: '/projects/', goal: '/goals/', letter: '/letters/', conversation: '/chat/', meeting: '/meetings/', request: '/requests/' }[data.subject.type] || '/tasks/';
    return base + data.subject.id;
  }
  return '/notifications';
}

self.addEventListener('push', (event) => {
  let data = { kind: 'many', count: 1, subject: null };
  try {
    data = Object.assign(data, event.data ? event.data.json() : {});
  } catch (error) {
    // Unreadable payload: still tell the user something arrived.
  }
  const shown = self.registration.showNotification(MESSAGES.title, {
    body: messageFor(data),
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    lang: 'fa',
    dir: 'rtl',
    tag: 'madar',
    renotify: true,
    data: { url: urlFor(data) },
  });
  event.waitUntil(shown);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === target.origin);
      if (!open) return self.clients.openWindow(target.href);
      // navigate() is refused for a window this worker does not control yet: open a new one then.
      return open
        .focus()
        .then((w) => (w || open).navigate(target.href))
        .catch(() => self.clients.openWindow(target.href));
    }),
  );
});
`;
  // The cache name follows the content, so a changed worker replaces the old cache.
  const version = createHash('sha256').update(body).digest('hex').slice(0, 12);
  return `'use strict';\nconst CACHE = 'madar-${version}';\n${body}`;
}

/**
 * Self-contained offline page (inline styles, no scripts from the app): it must render with no
 * network at all. Colors mirror the theme tokens (canvas, ink, primary) for light and dark.
 */
function offlinePage(): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escape(t('pwa.offline.title'))} · ${escape(t('app.name'))}</title>
<style>
:root{color-scheme:light dark;--canvas:#fbfaf6;--surface:#ffffff;--ink:#1d2433;--muted:#5d6577;--line:#e6e3da;--primary:#0f8a6a;--on-primary:#fbfffd}
@media (prefers-color-scheme:dark){:root{--canvas:#0f1420;--surface:#171e2c;--ink:#eef0f5;--muted:#a3abbc;--line:#2a3344;--primary:#3fbf94;--on-primary:#06231a}}
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:var(--canvas);color:var(--ink);font-family:AbarLow,Vazirmatn,Tahoma,system-ui,sans-serif}
main{width:100%;max-width:420px;display:flex;flex-direction:column;align-items:center;gap:16px;text-align:center;background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:32px 24px}
h1{margin:0;font-size:1.35rem;font-weight:800}
p{margin:0;line-height:1.9;color:var(--muted)}
button{font:inherit;font-weight:700;border:0;border-radius:12px;padding:12px 24px;min-height:44px;background:var(--primary);color:var(--on-primary);cursor:pointer}
</style></head>
<body><main>
<svg width="72" height="72" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#0f8a6a"/><ellipse cx="32" cy="32" rx="25" ry="10" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="3" stroke-dasharray="6 5" transform="rotate(-24 32 32)"/><circle cx="32" cy="32" r="11" fill="#fff"/></svg>
<h1>${escape(t('pwa.offline.title'))}</h1>
<p>${escape(t('pwa.offline.description'))}</p>
<button type="button" onclick="location.reload()">${escape(t('pwa.offline.retry'))}</button>
</main>
<script>addEventListener('online',function(){location.reload()})</script>
</body></html>`;
}
