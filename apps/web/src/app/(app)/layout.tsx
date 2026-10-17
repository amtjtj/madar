import type { ReactNode } from 'react';

import { AppGate } from '@/components/app-gate';
import { AppShell } from '@/components/app-shell';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AppGate>
      <AppShell>{children}</AppShell>
    </AppGate>
  );
}
