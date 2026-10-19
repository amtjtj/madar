'use client';

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
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
import { t } from '@madar/i18n';
import { formatNumber } from '@madar/shared';
import { GripVertical } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { cn } from '../lib/cn.js';

export interface SortableListProps<T extends { id: string }> {
  items: readonly T[];
  /** Accessible name of the list. */
  label: string;
  /** Used in the handle's label and the screen-reader announcements. */
  itemTitle: (item: T) => string;
  /** The new order, after a drop that changed it. */
  onReorder: (ids: string[]) => void;
  /** One row; put `handle` where the drag handle belongs (usually TaskCard's `dragHandle`). */
  renderItem: (item: T, handle: ReactNode, state: { dragging: boolean }) => ReactNode;
  className?: string;
}

/**
 * A list a person orders by hand (ADR 0017): mouse (drag the handle), touch (hold the handle
 * briefly, so scrolling still works) and keyboard (Space on the handle, arrows, Space to drop),
 * with Persian screen-reader announcements.
 */
export function SortableList<T extends { id: string }>({
  items,
  label,
  itemTitle,
  onReorder,
  renderItem,
  className,
}: SortableListProps<T>) {
  // The order right after a drop, until the parent passes new items (with an optimistic cache
  // update, usually on the next render).
  const [draft, setDraft] = useState<{ items: readonly T[]; order: string[] } | null>(null);
  const order = draft && draft.items === items ? draft.order : items.map((i) => i.id);
  const byId = new Map(items.map((i) => [i.id, i]));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const titleOf = (id: UniqueIdentifier) => {
    const item = byId.get(String(id));
    return item ? itemTitle(item) : '';
  };
  const where = (id: UniqueIdentifier | undefined) => ({
    position: formatNumber(order.indexOf(String(id)) + 1),
    total: formatNumber(order.length),
  });
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      t('work.sortable.picked', { title: titleOf(active.id), ...where(active.id) }),
    onDragOver: ({ active, over }) =>
      over ? t('work.sortable.moved', { title: titleOf(active.id), ...where(over.id) }) : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? t('work.sortable.dropped', { title: titleOf(active.id), ...where(over.id) })
        : undefined,
    onDragCancel: ({ active }) => t('work.sortable.canceled', { title: titleOf(active.id) }),
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const next = arrayMove(order, order.indexOf(String(active.id)), order.indexOf(String(over.id)));
    setDraft({ items, order: next });
    onReorder(next);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      accessibility={{ announcements }}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <ul aria-label={label} className={cn('flex flex-col gap-2', className)}>
          {order.flatMap((id) => {
            const item = byId.get(id);
            return item
              ? [
                  <SortableRow key={id} id={id} title={itemTitle(item)}>
                    {(handle, dragging) => renderItem(item, handle, { dragging })}
                  </SortableRow>,
                ]
              : [];
          })}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: (handle: ReactNode, dragging: boolean) => ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={t('work.sortable.handle', { title })}
      className="-ms-1 grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-md text-ink-subtle hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-focus active:cursor-grabbing [&_svg]:size-4"
    >
      <GripVertical aria-hidden />
    </button>
  );
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('relative', isDragging && 'z-10')}
    >
      {children(handle, isDragging)}
    </li>
  );
}
