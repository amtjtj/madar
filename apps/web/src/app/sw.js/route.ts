import { serviceWorkerScript } from '@/lib/service-worker';

// Built once; the browser re-checks it on every navigation (no HTTP caching of the worker).
export const dynamic = 'force-static';

export function GET(): Response {
  return new Response(serviceWorkerScript(), {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Service-Worker-Allowed': '/',
    },
  });
}
