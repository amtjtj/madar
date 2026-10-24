'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { t } from '@madar/i18n';
import { REQUEST_KINDS, type RequestKind } from '@madar/shared';

import { PageHeader } from '@/components/app-shell';
import { RequestForm } from '@/components/requests/request-form';

export default function NewRequestPage() {
  return (
    <Suspense>
      <NewRequest />
    </Suspense>
  );
}

function NewRequest() {
  const kind = useSearchParams().get('kind') as RequestKind | null;
  return (
    <>
      <Link
        href="/requests?box=mine"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink [&_svg]:size-4"
      >
        <ArrowRight aria-hidden />
        {t('requests.title')}
      </Link>
      <PageHeader title={t('requests.newTitle')} />
      <RequestForm initialKind={kind && REQUEST_KINDS.includes(kind) ? kind : null} />
    </>
  );
}
