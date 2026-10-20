'use client';

import { Search } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { t } from '@madar/i18n';
import type { ConversationSummary } from '@madar/shared';
import { ConversationRow, EmptyState, Skeleton, TextField, cn } from '@madar/ui';

import { NextLink } from '@/components/next-link';
import { Segmented } from '@/components/work/task-views';
import { useConversations } from '@/hooks/chat';
import { useMe } from '@/hooks/use-me';
import { chatTime, conversationPreview } from '@/lib/chat';

import { NewConversation } from './new-conversation';

type Tab = 'all' | 'teams' | 'people';

function inTab(c: ConversationSummary, tab: Tab): boolean {
  if (tab === 'teams') return c.kind === 'project' || c.kind === 'department';
  if (tab === 'people') return c.kind === 'direct' || c.kind === 'group';
  return true;
}

/** All conversations, newest first (plan phase-2-step-15a §6). */
export function ConversationList({ className }: { className?: string }) {
  const { data: items, isPending } = useConversations();
  const { data: me } = useMe();
  const pathname = usePathname();
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const q = query.trim();
  const shown = (items ?? []).filter((c) => inTab(c, tab) && (!q || c.title.includes(q)));

  return (
    <div className={cn('flex min-h-0 flex-col gap-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-black text-ink">{t('chat.title')}</h1>
        <NewConversation />
      </div>
      <Segmented
        label={t('chat.tabsLabel')}
        value={tab}
        onChange={setTab}
        options={(['all', 'teams', 'people'] as const).map((value) => ({
          value,
          label: t(`chat.tabs.${value}`),
        }))}
      />
      <TextField
        label={t('chat.search')}
        hideLabel
        type="search"
        placeholder={t('chat.search')}
        icon={<Search aria-hidden />}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {isPending ? (
        <div className="flex flex-col gap-2" aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      ) : !shown.length ? (
        <EmptyState
          title={q ? t('chat.noResults') : t('chat.empty')}
          description={q ? undefined : t('chat.emptyHint')}
        />
      ) : (
        <ul className="flex min-h-0 flex-col overflow-y-auto">
          {shown.map((c) => (
            <li key={c.id}>
              <ConversationRow
                href={`/chat/${c.id}`}
                Link={NextLink}
                kind={c.kind}
                title={c.title}
                preview={conversationPreview(c, me?.member?.id)}
                time={
                  c.lastMessage
                    ? chatTime(c.lastMessage.createdAt, me?.tenant?.timezone)
                    : undefined
                }
                unread={c.unreadCount}
                muted={c.muted}
                active={pathname === `/chat/${c.id}`}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
