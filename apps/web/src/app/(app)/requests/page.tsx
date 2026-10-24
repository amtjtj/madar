'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Suspense } from 'react';

import { t } from '@madar/i18n';
import { Button } from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { RequestList } from '@/components/requests/request-list';

export default function RequestsPage() {
  const router = useRouter();
  return (
    <>
      <PageHeader
        title={t('requests.title')}
        subtitle={t('requests.subtitle')}
        action={
          <Button icon={<Plus aria-hidden />} onClick={() => router.push('/requests/new')}>
            {t('requests.new')}
          </Button>
        }
      />
      <div className="pb-20 md:pb-0">
        <Suspense>
          <RequestList />
        </Suspense>
      </div>
    </>
  );
}
