'use client';

import { CalendarClock } from 'lucide-react';

import { t } from '@madar/i18n';
import { Card, CardContent, MeetingRow } from '@madar/ui';

import { NextLink } from '@/components/next-link';
import { useTodayMeetings } from '@/hooks/meetings';
import { useMe } from '@/hooks/use-me';
import { isLive, meetingTime } from '@/lib/meetings';

/** «جلسه‌های امروز» on the today screen; nothing when there are none. */
export function TodayMeetings() {
  const { data } = useTodayMeetings();
  const { data: me } = useMe();
  if (!data?.length) return null;
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 pt-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-bold text-ink [&_svg]:size-5 [&_svg]:text-primary-ink">
            <CalendarClock aria-hidden />
            {t('meetings.todayCard.title')}
          </h2>
          <NextLink
            href="/meetings"
            className="text-sm font-semibold text-primary-ink hover:underline"
          >
            {t('meetings.todayCard.all')}
          </NextLink>
        </div>
        <ul className="-mx-2 flex flex-col">
          {data.map((m) => (
            <li key={m.id}>
              <MeetingRow
                href={`/meetings/${m.id}`}
                Link={NextLink}
                title={m.title}
                type={m.type}
                time={meetingTime(m, me?.tenant?.timezone)}
                participantCount={m.participantCount}
                hasMinutes={m.hasMinutes}
                canceled={false}
                live={isLive(m)}
              />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
