'use client';

import { useEffect } from 'react';

/** Registers the service worker (offline page, push). Safe to call on every page. */
export function useServiceWorker(): void {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch(() => undefined);
  }, []);
}
