'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { ConversationList } from '@/components/chat/conversation-list';
import { cn } from '@madar/ui';

/**
 * Desktop: the list and the open conversation side by side. Phones: the list on /chat, the
 * conversation full screen on /chat/[id].
 */
export default function ChatLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const open = pathname !== '/chat';
  return (
    <div className="-mt-2 flex h-[calc(100dvh-12rem)] gap-6 md:-mt-4 md:h-[calc(100dvh-6.5rem)]">
      <ConversationList
        className={cn('w-full md:flex md:w-80 md:shrink-0', open ? 'hidden' : 'flex')}
      />
      <div className={cn('min-w-0 flex-1', open ? 'flex flex-col' : 'hidden md:flex md:flex-col')}>
        {children}
      </div>
    </div>
  );
}
