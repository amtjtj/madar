'use client';

import { KanbanSquare, List, Search } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { t } from '@madar/i18n';
import type { ListTasksQuery } from '@madar/shared';
import { Card, EmptyState, Skeleton, TextField, cn } from '@madar/ui';

import { useTasks, useTodayDate, workKeys } from '@/hooks/work';

import { TaskBoard } from './task-board';
import { TaskList } from './task-list';

type Mode = 'list' | 'board';
type StatusFilter = 'open' | 'done' | 'all';
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
  };
  const { data: tasks, isPending } = useTasks(listParams);
  const filtered = Boolean(query) || status !== 'open';

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
