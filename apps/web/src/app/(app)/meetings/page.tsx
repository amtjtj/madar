'use client';

import { CalendarPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Suspense } from 'react';

import { t } from '@madar/i18n';
import { Button } from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { MeetingList } from '@/components/meetings/meeting-list';

export default function MeetingsPage() {
  const router = useRouter();
  return (
    <>
      <PageHeader
        title={t('meetings.title')}
        subtitle={t('meetings.subtitle')}
        action={
          <Button icon={<CalendarPlus aria-hidden />} onClick={() => router.push('/meetings/new')}>
            {t('meetings.new')}
          </Button>
        }
      />
      <Suspense>
        <MeetingList />
      </Suspense>
    </>
  );
}
