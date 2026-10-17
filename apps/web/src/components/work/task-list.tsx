'use client';

import { useRouter } from 'next/navigation';

import { t } from '@madar/i18n';
import { addDays, formatNumber, type Task } from '@madar/shared';
import { TaskCard, useToast } from '@madar/ui';

import { useToggleDone } from '@/hooks/work';
import { errorMessage } from '@/lib/errors';

const GROUPS = ['overdue', 'today', 'week', 'later', 'noDate', 'done'] as const;
type Group = (typeof GROUPS)[number];

function groupOf(task: Task, today: string): Group {
  if (task.statusCategory === 'done' || task.statusCategory === 'canceled') return 'done';
  if (!task.dueOn) return 'noDate';
  if (task.dueOn < today) return 'overdue';
  if (task.dueOn === today) return 'today';
  if (task.dueOn <= addDays(today, 6)) return 'week';
  return 'later';
}

export interface TaskListProps {
  tasks: Task[];
  today: string;
  /** Show the assignee avatar (department and project views). */
  showAssignee?: boolean;
  /** Hide the project name (inside a project). */
  hideProject?: boolean;
}

/** Tasks grouped by due date (overdue first), each group in board order. */
export function TaskList({ tasks, today, showAssignee, hideProject }: TaskListProps) {
  const router = useRouter();
  const toggle = useToggleDone();
  const { toast } = useToast();
  const groups = GROUPS.map((group) => ({
    group,
    tasks: tasks
      .filter((task) => groupOf(task, today) === group)
      .sort((a, b) =>
        group === 'done' || group === 'noDate' ? 0 : (a.dueOn ?? '').localeCompare(b.dueOn ?? ''),
      ),
  })).filter((g) => g.tasks.length > 0);

  return (
    <div className="flex flex-col gap-6">
      {groups.map(({ group, tasks: groupTasks }) => (
        <section key={group} aria-labelledby={`group-${group}`} className="flex flex-col gap-2">
          <h2
            id={`group-${group}`}
            className={
              group === 'overdue'
                ? 'text-sm font-bold text-danger-ink'
                : 'text-sm font-bold text-ink-muted'
            }
          >
            {t(`tasks.groups.${group}`)}{' '}
            <span className="font-medium text-ink-subtle">({formatNumber(groupTasks.length)})</span>
          </h2>
          <ul className="flex flex-col gap-2">
            {groupTasks.map((task) => (
              <li key={task.id}>
                <TaskCard
                  title={task.title}
                  done={task.statusCategory === 'done'}
                  onDoneChange={
                    task.can.edit
                      ? (done) =>
                          void toggle
                            .toggle(task, done)
                            .catch((error: unknown) =>
                              toast({ tone: 'error', title: errorMessage(error) }),
                            )
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
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
