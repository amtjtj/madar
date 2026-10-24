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
import {
  allStatuses,
  defaultStatus,
  type ModuleConfig,
  type StatusCategory,
  type StatusColor,
  type Task,
} from '@madar/shared';
import { BoardColumn, TaskCard, useToast } from '@madar/ui';

import { TaskTags } from '@/components/work/task-tags';
import { useModuleConfigs } from '@/hooks/module-config';
import { useMoveTask } from '@/hooks/work';
import { errorMessage } from '@/lib/errors';

/**
 * A board column: a department's own status (one department shown), or a status category (work
 * from several departments; plan phase-3-step-19a). Canceled work stays off the board.
 */
interface Column {
  id: string;
  title: string;
  category: StatusCategory;
  color?: StatusColor;
}
type Columns = Record<string, string[]>;

const CATEGORY_COLUMNS: Column[] = (['todo', 'in_progress', 'done'] as const).map((c) => ({
  id: c,
  title: t(`work.status.${c}`),
  category: c,
}));

function columnsFor(config: ModuleConfig | null): Column[] {
  if (!config) return CATEGORY_COLUMNS;
  return allStatuses(config)
    .filter((s) => s.category !== 'canceled')
    .map((s) => ({ id: `status:${s.key}`, title: s.label, category: s.category, color: s.color }));
}

/** The column a task sits in: its own status, else the first column of its category. */
function homeOf(task: Task, columns: Column[]): Column | undefined {
  return (
    columns.find((c) => c.id === `status:${task.statusKey}`) ??
    columns.find((c) => c.id === task.statusCategory) ??
    columns.find((c) => c.category === task.statusCategory)
  );
}

/** Columns keep the shared board order (`sortKey`), whatever order the list arrived in. */
function columnsOf(tasks: Task[], columns: Column[]): Columns {
  const result: Columns = Object.fromEntries(columns.map((c) => [c.id, [] as string[]]));
  const byBoardOrder = [...tasks].sort((a, b) =>
    a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0,
  );
  for (const task of byBoardOrder) {
    const home = homeOf(task, columns);
    if (home) result[home.id]?.push(task.id);
  }
  return result;
}

/** Column a draggable or droppable belongs to (set as dnd-kit data on cards and columns). */
const columnData = (data: { current?: Record<string, unknown> } | undefined) =>
  data?.current?.column as string | undefined;

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
      const target = [...droppableRects.entries()]
        .filter(
          ([id]) => typeof id === 'string' && (id.startsWith('status:') || CATEGORY_IDS.has(id)),
        )
        .map(([, rect]) => rect)
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
  /** One department's board uses its own statuses as columns. */
  departmentId?: string | null;
}

const CATEGORY_IDS = new Set<UniqueIdentifier>(CATEGORY_COLUMNS.map((c) => c.id));

/** Kanban board: drag cards within and across columns (mouse, touch and keyboard). */
export function TaskBoard({ tasks, listKey, today, hideProject, departmentId }: TaskBoardProps) {
  const router = useRouter();
  const { data: configs } = useModuleConfigs();
  const configOf = (id: string) => configs?.find((c) => c.departmentId === id)?.config ?? null;
  const config = departmentId ? configOf(departmentId) : null;
  const COLUMNS = useMemo(() => columnsFor(config), [config]);
  const columnById = (id: string | undefined) => COLUMNS.find((c) => c.id === id);
  const statusLabel = (id: string) => columnById(id)?.title ?? '';
  const move = useMoveTask(listKey);
  const { toast } = useToast();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Columns | null>(null);
  const byId = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const base = useMemo(() => columnsOf(tasks, COLUMNS), [tasks, COLUMNS]);
  const columns = draft ?? base;

  const columnOf = (id: UniqueIdentifier, from: Columns = columns): string | undefined =>
    COLUMNS.find((c) => c.id === id)?.id ??
    COLUMNS.find((c) => from[c.id]?.includes(String(id)))?.id;
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
      const target = (cols[to] ?? []).filter((id) => id !== active.id);
      const overIndex = target.indexOf(String(over.id));
      target.splice(overIndex >= 0 ? overIndex : target.length, 0, String(active.id));
      return {
        ...cols,
        [from]: (cols[from] ?? []).filter((id) => id !== active.id),
        [to]: target,
      };
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
    const column = over ? (columnById(String(over.id))?.id ?? columnData(over.data)) : undefined;
    const from = task ? homeOf(task, COLUMNS)?.id : undefined;
    const target = columnById(column);
    if (!over || !task || !column || !from || !target) return reset();
    // The status the task lands in: the column's own, or (category columns) its department's first
    // status of that category; a reorder keeps the status it has.
    const statusKey =
      column === from
        ? task.statusKey
        : column.startsWith('status:')
          ? column.slice('status:'.length)
          : (() => {
              const own = configOf(task.department.id);
              return own ? (defaultStatus(own, task.typeKey, target.category)?.key ?? null) : null;
            })();
    if (!statusKey) return reset();

    let ids: string[];
    if (column === from) {
      const list = base[from] ?? [];
      const oldIndex = list.indexOf(id);
      const overIndex = over.id === column ? list.length - 1 : list.indexOf(String(over.id));
      ids = overIndex >= 0 && overIndex !== oldIndex ? arrayMove(list, oldIndex, overIndex) : list;
    } else {
      const shown = (draft ?? base)[column] ?? [];
      if (shown.includes(id)) {
        ids = shown;
      } else {
        const list = base[column] ?? [];
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
      [from]: (base[from] ?? []).filter((taskId) => taskId !== id),
      [column]: ids,
    };
    const moved: Task = {
      ...task,
      statusKey,
      statusCategory: target.category,
      completedAt:
        target.category === 'done' ? (task.completedAt ?? new Date().toISOString()) : null,
    };
    const shownIds = new Set(COLUMNS.flatMap((c) => next[c.id] ?? []));
    const optimistic = [
      ...COLUMNS.flatMap((c) =>
        (next[c.id] ?? [])
          .map((taskId) => (taskId === id ? moved : byId.get(taskId)))
          .filter((t): t is Task => Boolean(t)),
      ),
      ...tasks.filter((t) => !shownIds.has(t.id) && t.id !== id),
    ];
    move.mutate(
      { id, statusKey, afterTaskId, beforeTaskId, optimistic },
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
          <DroppableColumn key={column.id} column={column} count={columns[column.id]?.length ?? 0}>
            <SortableContext
              items={columns[column.id] ?? []}
              strategy={verticalListSortingStrategy}
            >
              {(columns[column.id] ?? []).map((taskId) => {
                const task = byId.get(taskId);
                if (!task) return null;
                return (
                  <SortableTask
                    key={taskId}
                    task={task}
                    column={column.id}
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
  const { setNodeRef, isOver } = useDroppable({ id: column.id, data: { column: column.id } });
  return (
    <BoardColumn
      title={column.title}
      category={column.category}
      color={column.color}
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
  column: string;
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
      source={task.source}
      progress={task.progress}
      attachmentCount={task.attachmentCount}
      evidenceCount={task.evidenceCount}
      projectName={hideProject ? undefined : task.project?.name}
      subtasks={task.subtasks}
      commentCount={task.commentCount}
      assigneeName={task.assignee?.displayName}
      tag={<TaskTags task={task} status={false} />}
      compact
    />
  );
}
