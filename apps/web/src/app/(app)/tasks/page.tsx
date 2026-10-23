'use client';

import { X } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { t } from '@madar/i18n';
import { Badge } from '@madar/ui';

import { PageHeader } from '@/components/app-shell';
import { AssistantGate } from '@/components/assistant/assistant-gate';
import { BreakdownDialog } from '@/components/assistant/breakdown-dialog';
import { NewTaskButton } from '@/components/work/new-task-button';
import { Segmented, TaskViews } from '@/components/work/task-views';
import { useDepartments } from '@/hooks/queries';
import { useMe } from '@/hooks/use-me';
import { useTodayDate } from '@/hooks/work';

type Tab = 'mine' | 'department' | 'visible';

export default function TasksPage() {
  return (
    <Suspense>
      <TasksScreen />
    </Suspense>
  );
}

const TABS: readonly Tab[] = ['mine', 'department', 'visible'];

/** Dashboard cards link here with filters in the address (`?view=…&departmentId=…&due=overdue`). */
function TasksScreen() {
  const search = useSearchParams();
  const today = useTodayDate();
  const { data: me } = useMe();
  const { data: departments } = useDepartments();
  const requested = search.get('view') as Tab | null;
  const [tab, setTab] = useState<Tab>(requested && TABS.includes(requested) ? requested : 'mine');
  const departmentId = search.get('departmentId') ?? undefined;
  const assigneeId = search.get('assigneeId') ?? undefined;
  const due = search.get('due') === 'overdue' ? ('overdue' as const) : undefined;
  const stuck = search.get('stuck') === 'true' ? true : undefined;
  const subtasks = search.get('subtasks') === 'include' ? ('include' as const) : undefined;
  const drillDown = Boolean(due || stuck || departmentId || assigneeId);
  const departmentName = departments?.find((d) => d.id === departmentId)?.name;
  const hasDepartment = (me?.member?.departments.length ?? 0) > 0;
  // Oversight and company-wide readers also get «همه».
  const readsAll = me?.member?.permissions['task.read'] === 'tenant';
  const tabs: Tab[] = [
    'mine',
    ...(hasDepartment ? (['department'] as const) : []),
    ...(readsAll ? (['visible'] as const) : []),
  ];

  return (
    <>
      <PageHeader
        title={t('tasks.title')}
        subtitle={t('tasks.subtitle')}
        action={
          <div className="flex items-center gap-2">
            <AssistantGate>
              <BreakdownDialog today={today} />
            </AssistantGate>
            <NewTaskButton today={today} addToToday={false} />
          </div>
        }
      />
      {drillDown && (
        <div className="mb-4 flex flex-wrap items-center gap-2" role="status">
          <span className="text-sm text-ink-muted">{t('tasks.filters.label')}</span>
          {due && <Badge tone="danger">{t('tasks.filters.overdue')}</Badge>}
          {stuck && <Badge tone="warning">{t('tasks.filters.stuck')}</Badge>}
          {departmentName && <Badge>{departmentName}</Badge>}
          <Link
            href="/tasks"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-ink-muted hover:bg-sunken [&_svg]:size-4"
          >
            <X aria-hidden />
            {t('tasks.filters.clear')}
          </Link>
        </div>
      )}
      <TaskViews
        params={{
          view: tab,
          departmentId,
          assigneeId,
          due,
          stuck,
          subtasks,
          // Drill-downs show every row the card counted.
          ...(drillDown ? { limit: 500 } : {}),
        }}
        showAssignee={tab !== 'mine'}
        emptyDescription={tab === 'mine' ? t('tasks.emptyMine') : undefined}
        toolbar={
          tabs.length > 1 ? (
            <Segmented
              label={t('tasks.title')}
              value={tab}
              onChange={setTab}
              options={tabs.map((value) => ({ value, label: t(`tasks.tabs.${value}`) }))}
            />
          ) : null
        }
      />
    </>
  );
}
