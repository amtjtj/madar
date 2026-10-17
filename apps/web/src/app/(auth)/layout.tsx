import type { ReactNode } from 'react';

import { t } from '@madar/i18n';
import { OrbitIllustration, ThemeToggle } from '@madar/ui';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-8 sm:justify-center sm:py-12">
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="flex items-center gap-3">
          <OrbitIllustration className="h-11" />
          <span className="text-2xl font-black text-ink">{t('app.name')}</span>
        </div>
        <main className="flex flex-col gap-6 rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
          {children}
        </main>
        <div className="flex justify-center">
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}
