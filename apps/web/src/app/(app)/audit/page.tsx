'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { t, type MessageKey } from '@madar/i18n';
import { formatJalaliDate, formatTime, type AuditLogEntry } from '@madar/shared';
import { Avatar, Button, Card, EmptyState, Skeleton, cn } from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { useAuditLog } from '@/hooks/queries';
import { useMe } from '@/hooks/use-me';

function actionLabel(action: string): string {
  const key = `audit.actions.${action.replace(/\./g, '_')}` as MessageKey;
  try {
    return t(key);
  } catch {
    return action;
  }
}

export default function AuditPage() {
  const { data, isPending, fetchNextPage, hasNextPage, isFetchingNextPage } = useAuditLog();
  const entries = data?.pages.flat() ?? [];

  return (
    <>
      <PageHeader title={t('audit.title')} subtitle={t('audit.subtitle')} />
      <Card>
        {isPending ? (
          <div className="flex flex-col gap-4 p-5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <EmptyState title={t('audit.emptyTitle')} description={t('audit.emptyDescription')} />
        ) : (
          <ol className="divide-y divide-line" data-testid="audit-list">
            {entries.map((entry) => (
              <AuditRow key={entry.id} entry={entry} />
            ))}
          </ol>
        )}
      </Card>
      {hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="secondary"
            loading={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {t('audit.loadMore')}
          </Button>
        </div>
      )}
    </>
  );
}

function AuditRow({ entry }: { entry: AuditLogEntry }) {
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const when = new Date(entry.createdAt);
  const timezone = me?.tenant?.timezone;
  const hasDetails = entry.before != null || entry.after != null;
  const actor = entry.actor?.displayName ?? t('audit.system');
  return (
    <li className="px-4 py-3.5 sm:px-5">
      <div className="flex items-center gap-3">
        <Avatar name={actor} size="sm" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-bold text-ink">{actionLabel(entry.action)}</span>
          <span className="text-sm text-ink-muted">
            {actor} · {formatJalaliDate(when, 'long', timezone)} · {formatTime(when, timezone)}
          </span>
        </div>
        {hasDetails && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-ink-muted hover:bg-sunken [&_svg]:size-4"
          >
            {t('audit.details')}
            <ChevronDown aria-hidden className={cn('transition-transform', open && 'rotate-180')} />
          </button>
        )}
      </div>
      {open && hasDetails && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {(['before', 'after'] as const).map((side) =>
            entry[side] != null ? (
              <div key={side} className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-ink-subtle">{t(`audit.${side}`)}</span>
                <pre
                  dir="ltr"
                  className="overflow-x-auto rounded-lg bg-sunken p-3 text-xs text-ink"
                >
                  {JSON.stringify(entry[side], null, 2)}
                </pre>
              </div>
            ) : null,
          )}
        </div>
      )}
    </li>
  );
}
