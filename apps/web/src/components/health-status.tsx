'use client';

import { useQuery } from '@tanstack/react-query';

import { t } from '@madar/i18n';
import { cx, Skeleton } from '@madar/ui';

import { fetchHealth } from '@/lib/api';

export function HealthStatus() {
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ['health'],
    queryFn: () => fetchHealth(),
  });

  return (
    <section
      aria-labelledby="health-title"
      aria-busy={isPending}
      className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 shadow-sm"
    >
      <h2 id="health-title" className="text-lg font-semibold">
        {t('health.title')}
      </h2>

      {isPending ? (
        <div className="flex flex-col gap-3" aria-label={t('health.checking')}>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-28" />
        </div>
      ) : isError ? (
        <div className="flex items-center justify-between gap-3">
          <StatusLine ok={false} label={t('health.apiDown')} />
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {t('health.retry')}
          </button>
        </div>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="health-result">
          <li>
            <StatusLine ok label={t('health.apiUp')} />
          </li>
          <li>
            <StatusLine
              ok={data.dependencies.database === 'up'}
              label={`${t('health.database')}: ${t(
                data.dependencies.database === 'up' ? 'health.up' : 'health.down',
              )}`}
            />
          </li>
          <li className="text-sm text-muted">{t('health.version', { version: data.version })}</li>
        </ul>
      )}
    </section>
  );
}

function StatusLine({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className={cx('size-2.5 rounded-full', ok ? 'bg-success' : 'bg-danger')} />
      {label}
    </span>
  );
}
