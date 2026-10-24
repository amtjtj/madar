'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { use } from 'react';

import { t } from '@madar/i18n';
import { Card, EmptyState, Skeleton } from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { ConfigEditor } from '@/components/departments/config-editor';
import { useConfigDetail } from '@/hooks/module-config';
import { useCan, useDepartments } from '@/hooks/queries';

/** A department's statuses, work types and fields, edited without code (plan phase-3-step-19a). */
export default function DepartmentSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const { data: departments } = useDepartments();
  const { data: detail, isPending, isError } = useConfigDetail(id);
  const name = departments?.find((d) => d.id === id)?.name ?? '';
  const canEdit = can('department.manage');

  return (
    <>
      <Link
        href="/departments"
        className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-ink-muted hover:text-ink [&_svg]:size-4"
      >
        <ArrowRight aria-hidden />
        {t('departmentConfig.back')}
      </Link>
      <PageHeader
        title={t('departmentConfig.title', { name })}
        subtitle={canEdit ? t('departmentConfig.subtitle') : t('departmentConfig.readOnly')}
      />
      {isError ? (
        <Card>
          <EmptyState title={t('departmentConfig.notFound')} />
        </Card>
      ) : isPending || !detail ? (
        <div className="flex flex-col gap-4" aria-busy>
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : (
        // A newer version (saved here or elsewhere) starts a fresh draft.
        <ConfigEditor key={detail.version} detail={detail} canEdit={canEdit} />
      )}
    </>
  );
}
