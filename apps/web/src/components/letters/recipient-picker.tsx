'use client';

import { Search, UserPlus } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { t } from '@madar/i18n';
import { Avatar, RecipientChip, Skeleton } from '@madar/ui';

import { useMembers } from '@/hooks/queries';

export interface Person {
  id: string;
  displayName: string;
}

/**
 * People on a letter as removable chips, with a name search under them (the same search as the
 * project members dialog). `exclude` keeps the sender and people already picked elsewhere out.
 */
export function RecipientPicker({
  label,
  value,
  onChange,
  exclude = [],
  autoFocus,
}: {
  label: string;
  value: Person[];
  onChange: (people: Person[]) => void;
  exclude?: string[];
  autoFocus?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const { data: found, isFetching } = useMembers({ q: search });
  const taken = new Set([...exclude, ...value.map((p) => p.id)]);
  const results = search
    ? (found ?? []).filter((m) => m.status === 'active' && !taken.has(m.id)).slice(0, 6)
    : [];

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-line-strong bg-surface p-1.5 focus-within:outline-2 focus-within:outline-focus">
        {value.map((p) => (
          <RecipientChip
            key={p.id}
            name={p.displayName}
            onRemove={() => onChange(value.filter((v) => v.id !== p.id))}
          />
        ))}
        <span className="flex min-w-40 flex-1 items-center gap-1.5 ps-1.5 text-ink-subtle [&_svg]:size-4">
          <Search aria-hidden />
          <input
            id={id}
            type="search"
            value={query}
            autoFocus={autoFocus}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !query && value.length) onChange(value.slice(0, -1));
            }}
            placeholder={t('letters.compose.searchPeople')}
            className="h-9 w-full bg-transparent text-ink outline-none placeholder:text-ink-subtle"
          />
        </span>
      </div>
      {search && (
        <div aria-live="polite" className="rounded-xl border border-line bg-surface p-1 shadow-sm">
          {isFetching && !found ? (
            <Skeleton className="h-11 rounded-lg" />
          ) : results.length === 0 ? (
            <p className="px-2 py-2 text-sm text-ink-muted">{t('letters.compose.noPeople')}</p>
          ) : (
            <ul>
              {results.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    aria-label={t('letters.compose.addPerson', { name: m.displayName })}
                    onClick={() => {
                      onChange([...value, { id: m.id, displayName: m.displayName }]);
                      setQuery('');
                      setSearch('');
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-start hover:bg-sunken focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    <Avatar name={m.displayName} size="sm" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium text-ink">{m.displayName}</span>
                      {m.title && (
                        <span className="truncate text-xs text-ink-muted">{m.title}</span>
                      )}
                    </span>
                    <UserPlus aria-hidden className="size-4 text-primary-ink" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
