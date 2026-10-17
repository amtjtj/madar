import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { t } from '@madar/i18n';
import { Button, OrbitIllustration, ThemeToggle } from '@madar/ui';

import { HealthStatus } from '@/components/health-status';

export const metadata: Metadata = { title: t('health.title') };

/** Public status page: is the API (and its database) reachable? */
export default function StatusPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-10">
      <header className="flex flex-col items-start gap-3">
        <OrbitIllustration className="h-20" />
        <h1 className="text-4xl font-black text-ink">{t('app.name')}</h1>
        <p className="text-lg text-ink-muted">{t('app.tagline')}</p>
      </header>
      <HealthStatus />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="secondary">
          <Link href="/design-system">
            {t('health.designSystemLink')}
            <ArrowLeft aria-hidden />
          </Link>
        </Button>
        <ThemeToggle />
      </div>
    </main>
  );
}
