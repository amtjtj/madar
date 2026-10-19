'use client';

import { useRouter } from 'next/navigation';

import { t } from '@madar/i18n';
import { formatNumber, type Task } from '@madar/shared';
import { SortableList, TaskCard, useToast } from '@madar/ui';

import { GoalTag } from '@/components/goals/goal-tag';
import { useToggleDone } from '@/hooks/work';
import { errorMessage } from '@/lib/errors';

export interface TaskListProps {
  tasks: Task[];
  today: string;
  /** Show the assignee avatar (department and project views). */
  showAssignee?: boolean;
  /** Hide the project name (inside a project). */
  hideProject?: boolean;
  /** «My tasks»: the member orders open tasks by hand (ADR 0017). */
  onReorder?: (taskIds: string[]) => void;
}

/**
 * Open tasks in the order the API gives (automatic priority, or the member's own order), each with
 * where it came from and why it sits there; finished tasks below.
 */
export function TaskList({ tasks, today, showAssignee, hideProject, onReorder }: TaskListProps) {
  const router = useRouter();
  const toggle = useToggleDone();
  const { toast } = useToast();
  const finished = (task: Task) =>
    task.statusCategory === 'done' || task.statusCategory === 'canceled';
  const open = tasks.filter((task) => !finished(task));
  const done = tasks.filter(finished);

  const card = (task: Task, extra: { dragHandle?: React.ReactNode; dragging?: boolean } = {}) => (
    <TaskCard
      title={task.title}
      done={task.statusCategory === 'done'}
      onDoneChange={
        task.can.edit
          ? (checked) =>
              void toggle
                .toggle(task, checked)
                .catch((error: unknown) => toast({ tone: 'error', title: errorMessage(error) }))
          : undefined
      }
      onOpen={() => router.push(`/tasks/${task.id}`)}
      priority={task.priority}
      dueOn={task.dueOn}
      today={today}
      projectName={hideProject ? undefined : task.project?.name}
      subtasks={task.subtasks}
      commentCount={task.commentCount}
      assigneeName={showAssignee ? task.assignee?.displayName : undefined}
      tag={task.keyResult ? <GoalTag keyResult={task.keyResult} /> : undefined}
      source={task.source}
      progress={task.progress}
      reasons={task.rank.reasons}
      {...extra}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      {open.length > 0 && (
        <section aria-labelledby="group-open" className="flex flex-col gap-2">
          <h2 id="group-open" className="text-sm font-bold text-ink-muted">
            {t('tasks.groups.open')}{' '}
            <span className="font-medium text-ink-subtle">({formatNumber(open.length)})</span>
          </h2>
          {onReorder && open.length > 1 ? (
            <SortableList
              label={t('tasks.orderList')}
              items={open}
              itemTitle={(task) => task.title}
              onReorder={onReorder}
              renderItem={(task, handle, { dragging }) =>
                card(task, { dragHandle: handle, dragging })
              }
            />
          ) : (
            <ul aria-label={t('tasks.orderList')} className="flex flex-col gap-2">
              {open.map((task) => (
                <li key={task.id}>{card(task)}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      {done.length > 0 && (
        <section aria-labelledby="group-done" className="flex flex-col gap-2">
          <h2 id="group-done" className="text-sm font-bold text-ink-muted">
            {t('tasks.groups.done')}{' '}
            <span className="font-medium text-ink-subtle">({formatNumber(done.length)})</span>
          </h2>
          <ul className="flex flex-col gap-2">
            {done.map((task) => (
              <li key={task.id}>{card(task)}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
