'use client';

import { PenLine } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Suspense } from 'react';

import { t } from '@madar/i18n';
import { Button } from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { LetterList } from '@/components/letters/letter-list';

export default function LettersPage() {
  const router = useRouter();
  return (
    <>
      <PageHeader
        title={t('letters.title')}
        subtitle={t('letters.subtitle')}
        action={
          <Button icon={<PenLine aria-hidden />} onClick={() => router.push('/letters/new')}>
            {t('letters.new')}
          </Button>
        }
      />
      <Suspense>
        <LetterList />
      </Suspense>
    </>
  );
}
