'use client';

import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';

import { t } from '@madar/i18n';
import { formatNumber, type Task } from '@madar/shared';
import { ProgressBar, TaskCard, TextField, useToast } from '@madar/ui';

import { workKeys } from '@/hooks/keys';
import { useCreateTask, useTasks, useTodayDate, useToggleDone } from '@/hooks/work';
import { errorMessage } from '@/lib/errors';

export function Subtasks({ task }: { task: Task }) {
  const today = useTodayDate();
  const router = useRouter();
  const client = useQueryClient();
  const { toast } = useToast();
  const { data: subtasks } = useTasks({ view: 'visible', parentId: task.id, status: 'all' });
  const create = useCreateTask();
  const toggle = useToggleDone();
  const [title, setTitle] = useState('');
  const onError = (error: unknown) => toast({ tone: 'error', title: errorMessage(error) });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = title.trim();
    if (!value) return;
    setTitle('');
    create.mutate(
      {
        title: value,
        parentId: task.id,
        departmentId: task.department.id,
        projectId: task.project?.id ?? null,
        assigneeId: task.assignee?.id ?? null,
      },
      {
        onSuccess: () =>
          void client.invalidateQueries({ queryKey: workKeys.task(task.id), exact: true }),
        onError: (error) => {
          setTitle(value);
          onError(error);
        },
      },
    );
  };

  const list = subtasks ?? [];
  const done = list.filter((s) => s.statusCategory === 'done').length;

  return (
    <section aria-labelledby="subtasks-title" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="subtasks-title" className="text-lg font-bold text-ink">
          {t('task.subtasks')}
        </h2>
        {list.length > 0 && (
          <span className="text-sm text-ink-muted">
            {t('work.subtasks', { done: formatNumber(done), total: formatNumber(list.length) })}
          </span>
        )}
      </div>
      {list.length > 0 && <ProgressBar value={done / list.length} label={t('task.subtasks')} />}
      <ul className="flex flex-col gap-2">
        {list.map((sub) => (
          <li key={sub.id}>
            <TaskCard
              compact
              title={sub.title}
              done={sub.statusCategory === 'done'}
              onDoneChange={
                sub.can.edit
                  ? (checked) =>
                      void toggle
                        .toggle(sub, checked)
                        .then(() =>
                          client.invalidateQueries({
                            queryKey: workKeys.task(task.id),
                            exact: true,
                          }),
                        )
                        .catch(onError)
                  : undefined
              }
              onOpen={() => router.push(`/tasks/${sub.id}`)}
              today={today}
              dueOn={sub.dueOn}
              progress={sub.progress}
              priority={sub.priority}
              assigneeName={sub.assignee?.displayName}
            />
          </li>
        ))}
      </ul>
      {task.can.edit && (
        <form onSubmit={submit}>
          <TextField
            label={t('task.addSubtask')}
            hideLabel
            placeholder={t('task.addSubtaskPlaceholder')}
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            icon={<Plus aria-hidden />}
          />
        </form>
      )}
    </section>
  );
}
