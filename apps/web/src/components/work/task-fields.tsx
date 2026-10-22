'use client';

import Link from 'next/link';

import { t } from '@madar/i18n';
import {
  DEFAULT_WORKFLOW,
  TASK_PRIORITIES,
  type Task,
  type TaskPriority,
  type UpdateTaskRequest,
} from '@madar/shared';
import { Avatar, DatePicker, SelectField, SourceBadge, rankText, useToast } from '@madar/ui';

import { KeyResultSelect } from '@/components/goals/key-result-select';
import { useMembers } from '@/hooks/queries';
import { useProjects, useTodayDate, useUpdateTask } from '@/hooks/work';
import { errorMessage } from '@/lib/errors';

/** Side panel: status, priority, assignee, due date, weight, project and key result. */
export function TaskFields({ task }: { task: Task }) {
  const today = useTodayDate();
  const update = useUpdateTask();
  const { toast } = useToast();
  const { data: members } = useMembers();
  const { data: projects } = useProjects();
  const disabled = !task.can.edit;

  const save = (changes: Omit<UpdateTaskRequest, 'version'>) =>
    update.mutate(
      { id: task.id, version: task.version, ...changes },
      {
        onSuccess: () => toast({ tone: 'success', title: t('task.saved'), duration: 1500 }),
        onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
      },
    );

  const assignees = (members ?? [])
    .filter((m) => m.status === 'active')
    .map((m) => ({ id: m.id, displayName: m.displayName }));
  // Keep the current assignee selectable even if they are no longer active.
  if (task.assignee && !assignees.some((m) => m.id === task.assignee?.id)) {
    assignees.unshift(task.assignee);
  }

  return (
    <div className="flex flex-col gap-4">
      <SelectField
        label={t('task.status')}
        value={task.statusKey}
        disabled={disabled}
        onChange={(e) => save({ statusKey: e.target.value })}
        options={DEFAULT_WORKFLOW.map((s) => ({
          value: s.key,
          label: t(`work.status.${s.category}`),
        }))}
      />
      <SelectField
        label={t('task.priority')}
        value={task.priority}
        disabled={disabled}
        onChange={(e) => save({ priority: e.target.value as TaskPriority })}
        options={TASK_PRIORITIES.map((p) => ({ value: p, label: t(`work.priority.${p}`) }))}
      />
      <SelectField
        label={t('task.assignee')}
        value={task.assignee?.id ?? ''}
        disabled={disabled}
        onChange={(e) => save({ assigneeId: e.target.value || null })}
        options={[
          { value: '', label: t('task.noAssignee') },
          ...assignees.map((m) => ({ value: m.id, label: m.displayName })),
        ]}
      />
      <DatePicker
        label={t('task.due')}
        value={task.dueOn}
        today={today}
        disabled={disabled}
        onChange={(dueOn) => save({ dueOn })}
      />
      <SelectField
        label={t('task.weight')}
        value={String(task.weight)}
        disabled={disabled || !task.can.setWeight}
        hint={task.can.setWeight ? undefined : t('task.weightHint')}
        onChange={(e) => save({ weight: Number(e.target.value) })}
        options={(['1', '2', '3', '4', '5'] as const).map((w) => ({
          value: w,
          label: t(`task.weights.${w}`),
        }))}
      />
      <SelectField
        label={t('task.project')}
        value={task.project?.id ?? ''}
        disabled={disabled}
        onChange={(e) => save({ projectId: e.target.value || null })}
        options={[
          { value: '', label: t('task.noProject') },
          ...(task.project && !projects?.some((p) => p.id === task.project?.id)
            ? [{ value: task.project.id, label: task.project.name }]
            : []),
          ...(projects ?? []).map((p) => ({ value: p.id, label: p.name })),
        ]}
      />
      <KeyResultSelect
        value={task.keyResult}
        disabled={disabled}
        onChange={(keyResultId) => save({ keyResultId })}
      />
      <dl className="flex flex-col gap-3 border-t border-line pt-4 text-sm">
        {task.source && (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-muted">{t('task.source')}</dt>
            <dd className="min-w-0">
              <SourceBadge source={task.source} full />
            </dd>
          </div>
        )}
        {task.meeting && (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-muted">{t('task.meeting')}</dt>
            <dd className="min-w-0 text-end font-medium">
              {task.meeting.visible ? (
                <Link
                  href={`/meetings/${task.meeting.id}`}
                  className="text-primary-ink hover:underline"
                >
                  {t('meetings.fromMeeting', { title: task.meeting.title ?? '' })}
                </Link>
              ) : (
                <span className="text-ink">
                  {task.meeting.title
                    ? t('meetings.fromMeeting', { title: task.meeting.title })
                    : t('meetings.fromOneOnOne')}
                </span>
              )}
            </dd>
          </div>
        )}
        {task.statusCategory !== 'done' && task.statusCategory !== 'canceled' && (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-ink-muted">{t('task.rank')}</dt>
            <dd className="text-end font-medium text-ink">{rankText(task.rank.reasons)}</dd>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <dt className="text-ink-muted">{t('task.reporter')}</dt>
          <dd className="flex items-center gap-2 font-medium text-ink">
            <Avatar name={task.reporter.displayName} size="xs" />
            {task.reporter.displayName}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-ink-muted">{t('task.department')}</dt>
          <dd className="font-medium text-ink">{task.department.name}</dd>
        </div>
      </dl>
    </div>
  );
}
