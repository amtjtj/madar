'use client';

import { useQuery } from '@tanstack/react-query';

import { t } from '@madar/i18n';
import { toPersianDigits } from '@madar/shared';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@madar/ui';

import { fetchHealth } from '@/lib/api';

export function HealthStatus() {
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ['health'],
    queryFn: () => fetchHealth(),
  });

  return (
    <Card aria-labelledby="health-title" aria-busy={isPending}>
      <CardHeader>
        <CardTitle id="health-title">{t('health.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="flex flex-col gap-3" aria-label={t('health.checking')}>
            <Skeleton className="h-6 w-44" />
            <Skeleton className="h-6 w-32" />
          </div>
        ) : isError ? (
          <div className="flex items-center justify-between gap-3">
            <Badge tone="danger" size="md" dot>
              {t('health.apiDown')}
            </Badge>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void refetch()}
              loading={isFetching}
            >
              {t('health.retry')}
            </Button>
          </div>
        ) : (
          <ul className="flex flex-col items-start gap-2.5" data-testid="health-result">
            <li>
              <Badge tone="success" size="md" dot>
                {t('health.apiUp')}
              </Badge>
            </li>
            <li>
              <Badge
                tone={data.dependencies.database === 'up' ? 'success' : 'danger'}
                size="md"
                dot
              >
                {`${t('health.database')}: ${t(
                  data.dependencies.database === 'up' ? 'health.up' : 'health.down',
                )}`}
              </Badge>
            </li>
            <li className="text-sm text-ink-subtle">
              {t('health.version', { version: toPersianDigits(data.version) })}
            </li>
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
