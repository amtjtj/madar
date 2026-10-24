'use client';

import { Inbox } from 'lucide-react';

import { t } from '@madar/i18n';
import { formatRelativeTime } from '@madar/shared';
import { Card, CardContent, RequestRow } from '@madar/ui';

import { NextLink } from '@/components/next-link';
import { useRequests } from '@/hooks/requests';
import { requestTitle } from '@/lib/requests';

/** «منتظر تایید تو» on the home page: only when something waits on me (ADR 0028). */
export function WaitingRequestsCard() {
  const { data } = useRequests('pending');
  const items = data?.pages.flat() ?? [];
  if (items.length === 0) return null;
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-bold text-ink [&_svg]:size-5 [&_svg]:text-primary-ink">
            <Inbox aria-hidden />
            {t('requests.homeCard.title')}
          </h2>
          <NextLink
            href="/requests"
            className="text-sm font-semibold text-primary-ink hover:underline"
          >
            {t('requests.homeCard.all')}
          </NextLink>
        </div>
        <ul className="-mx-2 flex flex-col">
          {items.slice(0, 3).map((r) => (
            <li key={r.id}>
              <RequestRow
                href={`/requests/${r.id}`}
                Link={NextLink}
                kind={r.kind}
                title={requestTitle(r)}
                status={r.status}
                person={r.requester.displayName}
                when={formatRelativeTime(new Date(r.createdAt))}
                amountToman={r.amountToman}
              />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
