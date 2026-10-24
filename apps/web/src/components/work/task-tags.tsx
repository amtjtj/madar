'use client';

import type { Task } from '@madar/shared';
import { Badge, StatusChip, TypeIcon } from '@madar/ui';

import { GoalTag } from '@/components/goals/goal-tag';
import { useTaskLook } from '@/hooks/module-config';

/**
 * Labels on a task card (plan phase-3-step-19a): the work type when it is not the department's
 * default one,
 * the status while the work is under way (lists group only open and done), and the goal served.
 */
export function TaskTags({ task, status = true }: { task: Task; status?: boolean }) {
  const look = useTaskLook()(task);
  const showType = look.type && look.manyTypes && !look.isDefaultType;
  const showStatus = status && look.status && task.statusCategory === 'in_progress';
  if (!showType && !showStatus && !task.keyResult) return null;
  return (
    <>
      {showType && look.type ? (
        <Badge>
          <TypeIcon icon={look.type.icon} />
          {look.type.label}
        </Badge>
      ) : null}
      {showStatus && look.status ? (
        <StatusChip label={look.status.label} color={look.status.color} />
      ) : null}
      {task.keyResult ? <GoalTag keyResult={task.keyResult} /> : null}
    </>
  );
}
