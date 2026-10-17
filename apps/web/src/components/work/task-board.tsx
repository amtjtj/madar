'use client';

import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { t } from '@madar/i18n';
import type { StatusCategory, Task } from '@madar/shared';
import { BoardColumn, TaskCard, useToast } from '@madar/ui';

import { useMoveTask } from '@/hooks/work';
import { errorMessage } from '@/lib/errors';

/** Board columns: the core workflow (canceled tasks stay off the board). */
const COLUMNS = ['todo', 'in_progress', 'done'] as const;
type Column = (typeof COLUMNS)[number];
type Columns = Record<Column, string[]>;

function columnsOf(tasks: Task[]): Columns {
  const columns: Columns = { todo: [], in_progress: [], done: [] };
  for (const task of tasks) {
    if ((COLUMNS as readonly string[]).includes(task.statusCategory)) {
      columns[task.statusCategory as Column].push(task.id);
    }
  }
  return columns;
}

const statusLabel = (column: StatusCategory) => t(`work.status.${column}`);

export interface TaskBoardProps {
  tasks: Task[];
  /** Query key of the list being shown (updated optimistically on drop). */
  listKey: readonly unknown[];
  today: string;
  hideProject?: boolean;
}

/** Kanban board: drag cards within and across columns (mouse, touch and keyboard). */
export function TaskBoard({ tasks, listKey, today, hideProject }: TaskBoardProps) {
  const router = useRouter();
  const move = useMoveTask(listKey);
  const { toast } = useToast();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Columns | null>(null);
  const byId = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const base = useMemo(() => columnsOf(tasks), [tasks]);
  const columns = draft ?? base;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const columnOf = (id: UniqueIdentifier, from: Columns = columns): Column | undefined =>
    COLUMNS.find((c) => c === id) ?? COLUMNS.find((c) => from[c].includes(String(id)));

  const titleOf = (id: UniqueIdentifier) => byId.get(String(id))?.title ?? '';
  const announcements: Announcements = {
    onDragStart: ({ active }) => t('tasks.dragHint') + ' ' + titleOf(active.id),
    onDragOver: ({ active, over }) => {
      const column = over ? columnOf(over.id) : undefined;
      return column ? t('tasks.moveTo', { status: statusLabel(column) }) : titleOf(active.id);
    },
    onDragEnd: ({ active, over }) => {
      const column = over ? columnOf(over.id) : undefined;
      return column
        ? t('tasks.moved', { title: titleOf(active.id), status: statusLabel(column) })
        : '';
    },
    onDragCancel: ({ active }) => titleOf(active.id),
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
    setDraft(base);
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = columnOf(active.id);
    const to = columnOf(over.id);
    if (!from || !to || from === to) return;
    setDraft((current) => {
      const cols = current ?? base;
      const target = cols[to].filter((id) => id !== active.id);
      const overIndex = target.indexOf(String(over.id));
      target.splice(overIndex >= 0 ? overIndex : target.length, 0, String(active.id));
      return { ...cols, [from]: cols[from].filter((id) => id !== active.id), [to]: target };
    });
  };

  const reset = () => {
    setActiveId(null);
    setDraft(null);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id = String(active.id);
    const task = byId.get(id);
    const column = columnOf(id);
    if (!over || !task || !column) return reset();

    let ids = columns[column];
    const oldIndex = ids.indexOf(id);
    const overIndex = over.id === column ? ids.length - 1 : ids.indexOf(String(over.id));
    if (overIndex >= 0 && overIndex !== oldIndex) ids = arrayMove(ids, oldIndex, overIndex);
    const index = ids.indexOf(id);
    const afterTaskId = ids[index - 1] ?? null;
    const beforeTaskId = ids[index + 1] ?? null;

    const baseIds = base[column];
    const unchanged =
      task.statusCategory === column &&
      baseIds[baseIds.indexOf(id) - 1] === (afterTaskId ?? undefined) &&
      baseIds[baseIds.indexOf(id) + 1] === (beforeTaskId ?? undefined);
    if (unchanged) return reset();

    const next: Columns = { ...columns, [column]: ids };
    const moved: Task = {
      ...task,
      statusKey: column,
      statusCategory: column,
      completedAt: column === 'done' ? (task.completedAt ?? new Date().toISOString()) : null,
    };
    const optimistic = [
      ...COLUMNS.flatMap((c) =>
        next[c]
          .map((taskId) => (taskId === id ? moved : byId.get(taskId)))
          .filter((t): t is Task => Boolean(t)),
      ),
      ...tasks.filter((t) => !(COLUMNS as readonly string[]).includes(t.statusCategory)),
    ];
    move.mutate(
      { id, statusKey: column, afterTaskId, beforeTaskId, optimistic },
      {
        onError: (error) =>
          toast({ tone: 'error', title: t('tasks.moveFailed'), description: errorMessage(error) }),
      },
    );
    reset();
  };

  const active = activeId ? byId.get(activeId) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={reset}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: t('tasks.dragHint') },
      }}
    >
      <div
        role="region"
        aria-label={t('tasks.boardLabel')}
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:snap-none md:px-0"
      >
        {COLUMNS.map((column) => (
          <DroppableColumn key={column} column={column} count={columns[column].length}>
            <SortableContext items={columns[column]} strategy={verticalListSortingStrategy}>
              {columns[column].map((taskId) => {
                const task = byId.get(taskId);
                if (!task) return null;
                return (
                  <SortableTask
                    key={taskId}
                    task={task}
                    today={today}
                    hideProject={hideProject}
                    onOpen={() => router.push(`/tasks/${taskId}`)}
                  />
                );
              })}
            </SortableContext>
          </DroppableColumn>
        ))}
      </div>
      <DragOverlay>
        {active ? (
          <TaskCard
            title={active.title}
            done={active.statusCategory === 'done'}
            today={today}
            dueOn={active.dueOn}
            priority={active.priority}
            assigneeName={active.assignee?.displayName}
            dragging
            compact
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function DroppableColumn({
  column,
  count,
  children,
}: {
  column: Column;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column });
  return (
    <BoardColumn
      title={statusLabel(column)}
      category={column}
      count={count}
      bodyRef={setNodeRef}
      highlighted={isOver}
    >
      {children}
    </BoardColumn>
  );
}

function SortableTask({
  task,
  today,
  hideProject,
  onOpen,
}: {
  task: Task;
  today: string;
  hideProject?: boolean;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !task.can.edit,
  });
  return (
    <TaskCard
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={
        isDragging ? 'opacity-40' : task.can.edit ? 'cursor-grab touch-manipulation' : undefined
      }
      {...attributes}
      {...listeners}
      title={task.title}
      done={task.statusCategory === 'done'}
      onOpen={onOpen}
      today={today}
      dueOn={task.dueOn}
      priority={task.priority}
      projectName={hideProject ? undefined : task.project?.name}
      subtasks={task.subtasks}
      commentCount={task.commentCount}
      assigneeName={task.assignee?.displayName}
      compact
    />
  );
}
