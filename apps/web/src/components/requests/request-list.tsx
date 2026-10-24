'use client';

import { useRouter, useSearchParams } from 'next/navigation';

import { t } from '@madar/i18n';
import { formatNumber, formatRelativeTime, REQUEST_BOXES, type RequestBox } from '@madar/shared';
import { Badge, Button, EmptyState, RequestRow, Skeleton, cn } from '@madar/ui';

import { NextLink } from '@/components/next-link';
import { useRequestCounts, useRequests } from '@/hooks/requests';
import { requestTitle } from '@/lib/requests';

/** The approvals inbox (plan phase-3-step-17b): waiting on me, mine, and what I decided. */
export function RequestList() {
  const params = useSearchParams();
  const router = useRouter();
  const wanted = params.get('box') as RequestBox | null;
  const box: RequestBox = wanted && REQUEST_BOXES.includes(wanted) ? wanted : 'pending';
  const { data, isPending, hasNextPage, fetchNextPage, isFetchingNextPage } = useRequests(box);
  const { data: counts } = useRequestCounts();
  const items = data?.pages.flat() ?? [];

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label={t('requests.boxLabel')}>
        <ul className="grid w-full grid-cols-3 gap-1 rounded-lg bg-sunken p-1 sm:flex sm:w-max">
          {REQUEST_BOXES.map((b) => (
            <li key={b}>
              <NextLink
                href={b === 'pending' ? '/requests' : `/requests?box=${b}`}
                aria-current={b === box ? 'page' : undefined}
                className={cn(
                  'flex h-9 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors',
                  b === box ? 'bg-surface text-ink shadow-xs' : 'text-ink-muted hover:text-ink',
                )}
              >
                {t(`requests.boxes.${b}`)}
                {b === 'pending' && (counts?.pending ?? 0) > 0 && (
                  <Badge tone="warning">{formatNumber(counts?.pending ?? 0)}</Badge>
                )}
              </NextLink>
            </li>
          ))}
        </ul>
      </nav>

      {isPending ? (
        <div className="flex flex-col gap-2" aria-busy>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title={t(`requests.empty.${box}`)}
          description={t(`requests.empty.${box}Hint`)}
          action={
            box === 'mine' ? (
              <Button onClick={() => router.push('/requests/new')}>{t('requests.new')}</Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface p-1">
            {items.map((r) => (
              <li key={r.id}>
                <RequestRow
                  href={`/requests/${r.id}`}
                  Link={NextLink}
                  kind={r.kind}
                  title={requestTitle(r)}
                  status={r.status}
                  person={
                    box === 'mine' ? (r.waitingOn?.displayName ?? null) : r.requester.displayName
                  }
                  when={formatRelativeTime(new Date(r.createdAt))}
                  amountToman={r.amountToman}
                />
              </li>
            ))}
          </ul>
          {hasNextPage && (
            <Button
              variant="secondary"
              className="self-center"
              loading={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >
              {t('requests.more')}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
