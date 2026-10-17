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
  type KeyboardCoordinateGetter,
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

/** Column a draggable or droppable belongs to (set as dnd-kit data on cards and columns). */
const columnData = (data: { current?: Record<string, unknown> } | undefined) =>
  data?.current?.column as Column | undefined;

/**
 * Keyboard: ←/→ jump straight to the neighbouring column (whatever the reading direction);
 * ↑/↓ move within a column.
 */
const coordinateGetter: KeyboardCoordinateGetter = (event, args) => {
  const { active, over, droppableRects } = args.context;
  if ((event.code === 'ArrowLeft' || event.code === 'ArrowRight') && active) {
    const current = columnData(over?.data) ?? columnData(active.data);
    const from = current ? droppableRects.get(current) : undefined;
    if (from) {
      const center = from.left + from.width / 2;
      const toward = event.code === 'ArrowLeft' ? -1 : 1;
      const target = COLUMNS.map((c) => droppableRects.get(c))
        .filter((rect): rect is NonNullable<typeof rect> => Boolean(rect))
        .filter((rect) => (rect.left + rect.width / 2 - center) * toward > 0)
        .sort(
          (a, b) =>
            Math.abs(a.left + a.width / 2 - center) - Math.abs(b.left + b.width / 2 - center),
        )[0];
      event.preventDefault();
      return target ? { x: target.left + 16, y: target.top + 16 } : undefined;
    }
  }
  return sortableKeyboardCoordinates(event, args);
};

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

  const columnOf = (id: UniqueIdentifier, from: Columns = columns): Column | undefined =>
    COLUMNS.find((c) => c === id) ?? COLUMNS.find((c) => from[c].includes(String(id)));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter }),
  );

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
    // `over` comes from dnd-kit and is always current; React state may lag a fast keyboard drop.
    const column = over
      ? (COLUMNS as readonly UniqueIdentifier[]).includes(over.id)
        ? (over.id as Column)
        : columnData(over.data)
      : undefined;
    const from = task?.statusCategory as Column | undefined;
    if (!over || !task || !column || !from || !(COLUMNS as readonly string[]).includes(from)) {
      return reset();
    }

    let ids: string[];
    if (column === from) {
      const list = base[from];
      const oldIndex = list.indexOf(id);
      const overIndex = over.id === column ? list.length - 1 : list.indexOf(String(over.id));
      ids = overIndex >= 0 && overIndex !== oldIndex ? arrayMove(list, oldIndex, overIndex) : list;
    } else {
      const shown = (draft ?? base)[column];
      if (shown.includes(id)) {
        ids = shown;
      } else {
        const list = base[column];
        const overIndex = list.indexOf(String(over.id));
        ids = [...list];
        ids.splice(overIndex >= 0 ? overIndex : list.length, 0, id);
      }
    }
    const index = ids.indexOf(id);
    const afterTaskId = ids[index - 1] ?? null;
    const beforeTaskId = ids[index + 1] ?? null;
    if (column === from && ids === base[from]) return reset();

    const next: Columns = {
      ...base,
      [from]: base[from].filter((taskId) => taskId !== id),
      [column]: ids,
    };
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
                    column={column}
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
  const { setNodeRef, isOver } = useDroppable({ id: column, data: { column } });
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
  column,
  today,
  hideProject,
  onOpen,
}: {
  task: Task;
  column: Column;
  today: string;
  hideProject?: boolean;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { column },
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
