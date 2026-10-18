'use client';

import { FileDown } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';

import { t } from '@madar/i18n';
import { formatCalendarDate, weekEndOf, type ReportScope } from '@madar/shared';
import { Button, Card, EmptyState, SelectField, Skeleton } from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { WeeklyReportView } from '@/components/reports/weekly-report-view';
import { useDepartments } from '@/hooks/queries';
import { useReportWeeks, useWeeklyReport } from '@/hooks/reports';
import { useMe } from '@/hooks/use-me';

export default function ReportsPage() {
  return (
    <Suspense>
      <Reports />
    </Suspense>
  );
}

/** Weekly reports; scope, department and week live in the address (links from notifications). */
function Reports() {
  const search = useSearchParams();
  const router = useRouter();
  const { data: me } = useMe();
  const { data: departments } = useDepartments();
  const member = me?.member;
  const seesCompany =
    member?.permissions['task.read'] === 'tenant' && member?.permissions['goal.read'] === 'tenant';
  const managed = (member?.departments ?? [])
    .filter((d) => d.deptRole === 'head' || d.deptRole === 'manager')
    .map((d) => d.id);
  const departmentChoices = (departments ?? []).filter(
    (d) => seesCompany || managed.includes(d.id),
  );

  const requestedScope = search.get('scope') as ReportScope | null;
  const scope: ReportScope =
    requestedScope === 'department' || !seesCompany ? 'department' : 'company';
  const requestedDepartment = search.get('departmentId');
  const departmentId =
    scope === 'department'
      ? (departmentChoices.find((d) => d.id === requestedDepartment) ?? departmentChoices[0])?.id
      : undefined;
  const allowed = scope === 'company' ? seesCompany : Boolean(departmentId);

  const { data: weeks } = useReportWeeks(scope, departmentId, allowed);
  const week = search.get('week') ?? weeks?.[0];
  const {
    data: report,
    isPending,
    isError,
  } = useWeeklyReport(scope, departmentId, week, allowed && Boolean(week));

  const go = (next: { scope?: ReportScope; departmentId?: string; week?: string }) => {
    const params = new URLSearchParams();
    const nextScope = next.scope ?? scope;
    params.set('scope', nextScope);
    const nextDepartment = next.departmentId ?? departmentId;
    if (nextScope === 'department' && nextDepartment) params.set('departmentId', nextDepartment);
    if (next.week) params.set('week', next.week);
    router.replace(`/reports?${params.toString()}`, { scroll: false });
  };

  // The PDF is the browser's print-to-PDF, always in the light theme.
  useEffect(() => {
    const root = document.documentElement;
    let previous: string | null = null;
    const before = () => {
      previous = root.getAttribute('data-theme');
      root.setAttribute('data-theme', 'light');
    };
    const after = () => {
      if (previous) root.setAttribute('data-theme', previous);
      else root.removeAttribute('data-theme');
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);

  const scopeOptions = [
    ...(seesCompany ? [{ value: 'company', label: t('reports.company') }] : []),
    ...departmentChoices.map((d) => ({ value: d.id, label: d.name })),
  ];

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={t('reports.title')}
          subtitle={t('reports.subtitle')}
          action={
            report ? (
              <Button
                variant="secondary"
                icon={<FileDown aria-hidden />}
                onClick={() => window.print()}
              >
                {t('reports.pdf')}
              </Button>
            ) : undefined
          }
        />
      </div>
      <div className="flex flex-col gap-5 pb-20 md:pb-0 print:pb-0">
        {member && scopeOptions.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:max-w-lg print:hidden">
            <SelectField
              label={t('reports.scope')}
              value={scope === 'company' ? 'company' : (departmentId ?? '')}
              onChange={(e) =>
                e.target.value === 'company'
                  ? go({ scope: 'company' })
                  : go({ scope: 'department', departmentId: e.target.value })
              }
              options={scopeOptions}
            />
            {weeks && weeks.length > 0 && (
              <SelectField
                label={t('reports.week')}
                value={week ?? ''}
                onChange={(e) => go({ week: e.target.value })}
                options={weeks.map((w, i) => ({
                  value: w,
                  label: `${t('reports.weekRange', {
                    from: formatCalendarDate(w),
                    to: formatCalendarDate(weekEndOf(w)),
                  })}${i === 0 ? ` ${t('reports.soFar')}` : ''}`,
                }))}
              />
            )}
          </div>
        )}
        {!member || (allowed && isPending && !isError) ? (
          <div className="flex flex-col gap-4" aria-busy>
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        ) : !allowed || isError || !report ? (
          <Card>
            <EmptyState title={t('reports.empty')} description={t('reports.emptyHint')} />
          </Card>
        ) : (
          <WeeklyReportView report={report} companyName={me?.tenant?.name ?? ''} />
        )}
      </div>
    </>
  );
}
