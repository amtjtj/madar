'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { z } from 'zod';

import { ToastProvider } from '@madar/ui';

import { useServiceWorker } from '@/hooks/pwa';

// No `new Function` in the browser: Zod's JIT probe would trip the Content-Security-Policy
// (no 'unsafe-eval', docker/caddy/Caddyfile). Validation works the same without it.
z.config({ jitless: true });

export function Providers({ children }: { children: ReactNode }) {
  useServiceWorker();
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
