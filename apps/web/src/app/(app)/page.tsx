'use client';

import { ArrowLeft, Check } from 'lucide-react';
import Link from 'next/link';

import { t } from '@madar/i18n';
import { formatJalaliDate } from '@madar/shared';
import { Button, Card, CardContent, EmptyState, ProgressBar, cn } from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { useCan, useDepartments, useMembers } from '@/hooks/queries';
import { useMe } from '@/hooks/use-me';

export default function HomePage() {
  const { data: me } = useMe();
  const can = useCan();
  const firstName = (me?.member?.displayName ?? '').split(' ')[0] ?? '';
  const today = formatJalaliDate(new Date(), 'full', me?.tenant?.timezone);

  return (
    <>
      <PageHeader
        title={t('home.greeting', { name: firstName })}
        subtitle={t('home.today', { date: today })}
      />
      <div className="flex flex-col gap-6">
        {can('department.manage') && can('member.create') && <SetupChecklist />}
        <Card>
          <EmptyState title={t('home.emptyTitle')} description={t('home.emptyDescription')} />
        </Card>
      </div>
    </>
  );
}

function SetupChecklist() {
  const can = useCan();
  const { data: departments } = useDepartments();
  const { data: members } = useMembers();
  const steps = [
    {
      key: 'departments',
      label: t('home.stepDepartments'),
      href: '/departments',
      done: (departments?.length ?? 0) > 0,
    },
    {
      key: 'members',
      label: t('home.stepMembers'),
      href: '/members',
      done: (members?.length ?? 0) > 1,
    },
    ...(can('department.set_oversight')
      ? [
          {
            key: 'oversight',
            label: t('home.stepOversight'),
            href: '/departments',
            done: departments?.some((d) => d.oversight.length > 0) ?? false,
          },
        ]
      : []),
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (departments && members && doneCount === steps.length) return null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-bold text-ink">{t('home.setupTitle')}</h2>
          <p className="text-sm text-ink-muted">{t('home.setupSubtitle')}</p>
        </div>
        <ProgressBar value={doneCount / steps.length} showValue label={t('home.setupTitle')} />
        <ol className="flex flex-col divide-y divide-line">
          {steps.map((step) => (
            <li key={step.key} className="flex items-center gap-3 py-3">
              <span
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-full border-2 [&_svg]:size-4',
                  step.done
                    ? 'border-primary bg-primary text-on-primary'
                    : 'border-line-strong text-transparent',
                )}
              >
                <Check aria-hidden strokeWidth={3} />
              </span>
              <span
                className={cn(
                  'flex-1 font-medium',
                  step.done ? 'text-ink-subtle line-through' : 'text-ink',
                )}
              >
                {step.label}
              </span>
              {!step.done && (
                <Button asChild size="sm" variant="secondary">
                  <Link href={step.href}>
                    {t('home.go')}
                    <ArrowLeft aria-hidden />
                  </Link>
                </Button>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
