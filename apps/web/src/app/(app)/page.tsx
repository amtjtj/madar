'use client';

import { ArrowLeft, Check, Plus, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { t } from '@madar/i18n';
import {
  formatCalendarDate,
  formatJalaliDate,
  formatNumber,
  type Task,
  type Today,
} from '@madar/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  ProgressBar,
  Skeleton,
  TaskCard,
  cn,
  useToast,
} from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { InstallCard } from '@/components/pwa/install';
import { NewTaskButton } from '@/components/work/new-task-button';
import { QuickAdd } from '@/components/work/quick-add';
import { useCan, useDepartments, useMembers } from '@/hooks/queries';
import { useMe } from '@/hooks/use-me';
import { isDraft, useAddToToday, useRemoveFromToday, useToday, useToggleDone } from '@/hooks/work';
import { errorMessage } from '@/lib/errors';

export default function TodayPage() {
  const { data: me } = useMe();
  const can = useCan();
  const { data: today, isPending } = useToday();
  const firstName = (me?.member?.displayName ?? '').split(' ')[0] ?? '';

  return (
    <>
      <PageHeader
        title={t('home.greeting', { name: firstName })}
        subtitle={t('home.today', {
          date: today
            ? formatCalendarDate(today.date, 'full')
            : formatJalaliDate(new Date(), 'full', me?.tenant?.timezone),
        })}
        action={today ? <NewTaskButton today={today.date} /> : undefined}
      />
      <div className="flex flex-col gap-6 pb-20 md:pb-0">
        {can('department.manage') && can('member.create') && <SetupChecklist />}
        <InstallCard />
        {isPending || !today ? <TodaySkeleton /> : <TodayPlan today={today} />}
      </div>
    </>
  );
}

function TodaySkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy>
      <Skeleton className="h-24 rounded-2xl" />
      <Skeleton className="h-12 rounded-lg" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-16 rounded-xl" />
      ))}
    </div>
  );
}

function TodayPlan({ today }: { today: Today }) {
  const router = useRouter();
  const toggle = useToggleDone();
  const add = useAddToToday();
  const remove = useRemoveFromToday();
  const { toast } = useToast();
  const { done, total } = today.progress;
  const allDone = total > 0 && done === total;
  const onError = (error: unknown) => toast({ tone: 'error', title: errorMessage(error) });

  const onToggle = (task: Task) => (checked: boolean) => {
    toggle.toggle(task, checked).catch(onError);
  };

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-ink">{t('today.planTitle')}</h2>
            {allDone && (
              <Badge tone="accent" size="md">
                <Sparkles aria-hidden />
                {t('today.allDone')}
              </Badge>
            )}
          </div>
          <ProgressBar
            value={total ? done / total : 0}
            label={
              total
                ? t('today.progress', { done: formatNumber(done), total: formatNumber(total) })
                : t('today.progressEmpty')
            }
            showValue={total > 0}
          />
          {allDone && <p className="text-sm text-ink-muted">{t('today.allDoneHint')}</p>}
        </CardContent>
      </Card>

      <section aria-label={t('today.planTitle')} className="flex flex-col gap-3">
        <QuickAdd />
        {today.items.length === 0 ? (
          <Card>
            <EmptyState title={t('today.emptyTitle')} description={t('today.emptyDescription')} />
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {today.items.map((task) => (
              <li key={task.id} className={cn(isDraft(task) && 'opacity-60')}>
                <TaskCard
                  title={task.title}
                  done={task.statusCategory === 'done'}
                  onDoneChange={task.can.edit ? onToggle(task) : undefined}
                  onOpen={isDraft(task) ? undefined : () => router.push(`/tasks/${task.id}`)}
                  priority={task.priority}
                  dueOn={task.dueOn}
                  today={today.date}
                  projectName={task.project?.name}
                  subtasks={task.subtasks}
                  commentCount={task.commentCount}
                  action={
                    isDraft(task) ? null : (
                      <button
                        type="button"
                        aria-label={t('today.removeFromTodayLabel', { title: task.title })}
                        title={t('today.removeFromToday')}
                        onClick={() => remove.mutate(task.id, { onError })}
                        className="grid size-8 shrink-0 place-items-center rounded-full text-ink-subtle hover:bg-sunken hover:text-ink [&_svg]:size-4"
                      >
                        <X aria-hidden />
                      </button>
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {today.suggestions.length > 0 && (
        <section aria-labelledby="suggestions-title" className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 id="suggestions-title" className="text-lg font-bold text-ink">
              {t('today.suggestionsTitle')}
            </h2>
            <p className="text-sm text-ink-muted">{t('today.suggestionsHint')}</p>
          </div>
          <ul className="flex flex-col gap-2">
            {today.suggestions.map(({ task, reason }) => (
              <li key={task.id}>
                <TaskCard
                  title={task.title}
                  done={false}
                  onOpen={() => router.push(`/tasks/${task.id}`)}
                  priority={task.priority}
                  dueOn={reason === 'overdue' || reason === 'due_today' ? null : task.dueOn}
                  today={today.date}
                  projectName={task.project?.name}
                  className="bg-canvas"
                  tag={
                    <Badge
                      tone={
                        reason === 'overdue'
                          ? 'danger'
                          : reason === 'due_today'
                            ? 'warning'
                            : 'accent'
                      }
                    >
                      {t(`today.reasons.${reason}`)}
                    </Badge>
                  }
                  action={
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={t('today.addToTodayLabel', { title: task.title })}
                      onClick={() => add.mutate(task.id, { onError })}
                      icon={<Plus aria-hidden />}
                    >
                      {t('today.addToToday')}
                    </Button>
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      )}
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
