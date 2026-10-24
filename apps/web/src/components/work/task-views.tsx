'use client';

import { KanbanSquare, List, Search, Sparkles } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { t } from '@madar/i18n';
import type { ListTasksQuery, TaskSource } from '@madar/shared';
import { Button, Card, EmptyState, Skeleton, TextField, cn, useToast } from '@madar/ui';

import { workKeys } from '@/hooks/keys';
import {
  useClearTaskOrder,
  useSetTaskOrder,
  useTaskOrder,
  useTasks,
  useTodayDate,
} from '@/hooks/work';
import { errorMessage } from '@/lib/errors';

import { TaskBoard } from './task-board';
import { TaskList } from './task-list';

type Mode = 'list' | 'board';
type StatusFilter = 'open' | 'done' | 'all';
type SourceFilter = 'all' | Exclude<TaskSource, 'meeting'>;
const SOURCE_FILTERS: readonly SourceFilter[] = ['all', 'personal', 'assigned', 'request'];
const MODE_KEY = 'madar.tasks.mode';

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'board' ? 'board' : 'list';
  } catch {
    return 'list';
  }
}

export interface TaskViewsProps {
  /** The list being shown (view, project, department…). */
  params: Partial<ListTasksQuery>;
  showAssignee?: boolean;
  emptyDescription?: string;
  /** Extra controls placed next to the filters (e.g. tabs). */
  toolbar?: ReactNode;
}

/** A task list with list/board switch, status filter and title search. */
export function TaskViews({ params, showAssignee, emptyDescription, toolbar }: TaskViewsProps) {
  const today = useTodayDate();
  // Rendered only on the client (behind the app gate), so reading storage here is safe.
  const [mode, setMode] = useState<Mode>(readMode);
  const [status, setStatus] = useState<StatusFilter>('open');
  const [source, setSource] = useState<SourceFilter>('all');
  const { toast } = useToast();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  const changeMode = (next: Mode) => {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // Remembering the mode is a convenience only.
    }
  };

  const listParams: Partial<ListTasksQuery> = {
    ...params,
    status: mode === 'board' ? 'all' : status,
    ...(query ? { q: query } : {}),
    ...(source !== 'all' ? { source } : {}),
  };
  const { data: tasks, isPending } = useTasks(listParams);
  const filtered = Boolean(query) || status !== 'open' || source !== 'all';
  // «My tasks», unfiltered: the member's own order (ADR 0017).
  const personal =
    params.view === 'mine' && mode === 'list' && status === 'open' && !query && source === 'all';
  const { data: order } = useTaskOrder();
  const setOrder = useSetTaskOrder(workKeys.tasks(listParams));
  const clearOrder = useClearTaskOrder();
  const onError = (error: unknown) => toast({ tone: 'error', title: errorMessage(error) });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {toolbar}
        <Segmented
          label={t('tasks.views.label')}
          value={mode}
          onChange={changeMode}
          options={[
            { value: 'list', label: t('tasks.views.list'), icon: <List aria-hidden /> },
            { value: 'board', label: t('tasks.views.board'), icon: <KanbanSquare aria-hidden /> },
          ]}
        />
        {mode === 'list' && (
          <Segmented
            label={t('tasks.statusFilter.label')}
            value={status}
            onChange={setStatus}
            options={(['open', 'done', 'all'] as const).map((value) => ({
              value,
              label: t(`tasks.statusFilter.${value}`),
            }))}
          />
        )}
        <Segmented
          label={t('tasks.sourceFilter.label')}
          value={source}
          onChange={setSource}
          options={SOURCE_FILTERS.map((value) => ({
            value,
            label: t(`tasks.sourceFilter.${value}`),
          }))}
        />
        {personal && (order?.taskIds.length ?? 0) > 0 && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Sparkles aria-hidden />}
            title={t('tasks.autoOrderHint')}
            loading={clearOrder.isPending}
            onClick={() => clearOrder.mutate(undefined, { onError })}
          >
            {t('tasks.autoOrder')}
          </Button>
        )}
        <TextField
          label={t('tasks.search')}
          hideLabel
          placeholder={t('tasks.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          icon={<Search aria-hidden />}
          className="min-w-48 flex-1"
          type="search"
        />
      </div>

      {isPending || !tasks ? (
        <div className="flex flex-col gap-2" aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : mode === 'board' ? (
        <TaskBoard
          tasks={tasks}
          listKey={workKeys.tasks(listParams)}
          today={today}
          hideProject={Boolean(params.projectId)}
          departmentId={
            params.departmentId ??
            (tasks.length > 0 && tasks.every((t) => t.department.id === tasks[0]?.department.id)
              ? tasks[0]?.department.id
              : null)
          }
        />
      ) : tasks.length === 0 ? (
        <Card>
          <EmptyState
            title={t('tasks.emptyTitle')}
            description={filtered ? t('tasks.emptyFiltered') : emptyDescription}
          />
        </Card>
      ) : (
        <TaskList
          tasks={tasks}
          today={today}
          showAssignee={showAssignee}
          hideProject={Boolean(params.projectId)}
          onReorder={personal ? (ids) => setOrder.mutate(ids, { onError }) : undefined}
        />
      )}
    </div>
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
}

/** A small single-choice switch (radio group semantics). */
export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg bg-sunken p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors [&_svg]:size-4',
            value === option.value
              ? 'bg-surface text-ink shadow-xs'
              : 'text-ink-muted hover:text-ink',
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}
