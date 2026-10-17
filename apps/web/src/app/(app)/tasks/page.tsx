'use client';

import { useState } from 'react';

import { t } from '@madar/i18n';

import { PageHeader } from '@/components/app-shell';
import { NewTaskButton } from '@/components/work/new-task-button';
import { Segmented, TaskViews } from '@/components/work/task-views';
import { useMe } from '@/hooks/use-me';
import { useTodayDate } from '@/hooks/work';

type Tab = 'mine' | 'department' | 'visible';

export default function TasksPage() {
  const today = useTodayDate();
  const { data: me } = useMe();
  const [tab, setTab] = useState<Tab>('mine');
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
        action={<NewTaskButton today={today} addToToday={false} />}
      />
      <TaskViews
        params={{ view: tab }}
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
