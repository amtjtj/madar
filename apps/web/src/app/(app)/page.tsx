'use client';

import { ArrowLeft, Check, Plus, Sparkles, Wand2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

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
  SortableList,
  TaskCard,
  cn,
  useToast,
} from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { GoalTag } from '@/components/goals/goal-tag';
import { CompanyView } from '@/components/home/company-view';
import { MyGoalsCard } from '@/components/home/my-goals-card';
import { TeamView } from '@/components/home/team-view';
import { InstallCard } from '@/components/pwa/install';
import { NewTaskButton } from '@/components/work/new-task-button';
import { Segmented } from '@/components/work/task-views';
import { QuickAdd } from '@/components/work/quick-add';
import { useCan, useDepartments, useMembers } from '@/hooks/queries';
import { useMe } from '@/hooks/use-me';
import {
  isDraft,
  useAddToToday,
  useAutoOrderToday,
  useRemoveFromToday,
  useReorderToday,
  useToday,
  useToggleDone,
} from '@/hooks/work';
import { errorMessage } from '@/lib/errors';

type HomeTab = 'today' | 'team' | 'company';
const TAB_KEY = 'madar.home.tab';

export default function HomePage() {
  return (
    <Suspense>
      <Home />
    </Suspense>
  );
}

/**
 * One home per role (plan phase-1-step-8): executives land on «شرکت», department managers on
 * «تیم من», everyone else on «امروز». The last choice is remembered on this device.
 */
function Home() {
  const search = useSearchParams();
  const router = useRouter();
  const { data: me } = useMe();
  const can = useCan();
  const { data: departments } = useDepartments();
  const { data: today } = useToday();
  const firstName = (me?.member?.displayName ?? '').split(' ')[0] ?? '';

  const member = me?.member;
  const seesCompany =
    member?.permissions['task.read'] === 'tenant' && member?.permissions['goal.read'] === 'tenant';
  const managed = (member?.departments ?? [])
    .filter((d) => d.deptRole === 'head' || d.deptRole === 'manager')
    .map((d) => d.id);
  // Company readers can open any department's team view from the company dashboard.
  const teamDepartments = (departments ?? []).filter(
    (d) => managed.includes(d.id) || (seesCompany && d.id === search.get('department')),
  );
  const tabs: HomeTab[] = [
    'today',
    ...(teamDepartments.length || managed.length ? (['team'] as const) : []),
    ...(seesCompany ? (['company'] as const) : []),
  ];
  const fallback: HomeTab = seesCompany ? 'company' : managed.length ? 'team' : 'today';
  // The address decides (links from the company view, Back/Forward); otherwise the last choice.
  const [stored] = useState<HomeTab | null>(() => {
    try {
      return localStorage.getItem(TAB_KEY) as HomeTab | null;
    } catch {
      return null;
    }
  });
  const fromUrl = search.get('tab') as HomeTab | null;
  const wanted = fromUrl ?? stored;
  const tab = wanted && tabs.includes(wanted) ? wanted : fallback;
  const requestedDepartment = search.get('department');
  const departmentId =
    requestedDepartment && teamDepartments.some((d) => d.id === requestedDepartment)
      ? requestedDepartment
      : teamDepartments[0]?.id;

  const go = (next: HomeTab, department?: string) => {
    const params = new URLSearchParams({ tab: next });
    // Kept on every tab: a company reader's «تیم من» tab exists only while a department is open.
    if (department) params.set('department', department);
    router.replace(`/?${params.toString()}`, { scroll: false });
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      // Remembering the tab is a convenience only.
    }
  };
  // Keep the department a company reader opened when switching back to «تیم من».
  const choose = (next: HomeTab) => go(next, departmentId);

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
        {member && tabs.length > 1 && (
          <div className="overflow-x-auto">
            <Segmented
              label={t('home.tabs.label')}
              value={tab}
              onChange={choose}
              options={tabs.map((value) => ({ value, label: t(`home.tabs.${value}`) }))}
            />
          </div>
        )}
        {!member ? (
          <TodaySkeleton />
        ) : tab === 'company' ? (
          <CompanyView />
        ) : tab === 'team' ? (
          <TeamView
            departments={teamDepartments}
            departmentId={departmentId}
            onDepartmentChange={(id) => go('team', id)}
          />
        ) : (
          <TodayTab />
        )}
      </div>
    </>
  );
}

function TodayTab() {
  const { data: today, isPending } = useToday();
  return (
    <>
      {isPending || !today ? <TodaySkeleton /> : <TodayPlan today={today} />}
      <MyGoalsCard />
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
  const reorder = useReorderToday();
  const autoOrder = useAutoOrderToday();
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
            {today.ordered && !allDone && (
              <Button
                size="sm"
                variant="ghost"
                icon={<Wand2 aria-hidden />}
                title={t('tasks.autoOrderHint')}
                loading={autoOrder.isPending}
                onClick={() => autoOrder.mutate(undefined, { onError })}
              >
                {t('today.autoOrder')}
              </Button>
            )}
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
          <SortableList
            label={t('today.planList')}
            items={today.items}
            itemTitle={(task) => task.title}
            // A task still being saved has no id yet: it keeps its place.
            onReorder={(ids) =>
              reorder.mutate(
                ids.filter((id) => !id.startsWith('draft-')),
                { onError },
              )
            }
            renderItem={(task, handle, { dragging }) => (
              <div className={cn(isDraft(task) && 'opacity-60')}>
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
                  tag={task.keyResult ? <GoalTag keyResult={task.keyResult} /> : undefined}
                  source={task.source}
                  reasons={isDraft(task) ? undefined : task.rank.reasons}
                  dragHandle={isDraft(task) || today.items.length < 2 ? undefined : handle}
                  dragging={dragging}
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
              </div>
            )}
          />
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
                  source={task.source}
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
