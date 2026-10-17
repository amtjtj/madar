import { t } from '@madar/i18n';

import { HealthStatus } from '@/components/health-status';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold">{t('app.name')}</h1>
        <p className="text-muted">{t('app.tagline')}</p>
      </header>
      <HealthStatus />
    </main>
  );
}
