'use client';

import { MessageCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { t } from '@madar/i18n';
import { formatNumber } from '@madar/shared';
import { Button } from '@madar/ui';

import { useProjectConversation } from '@/hooks/chat';

/** «گفت‌وگوی تیم» on a project page, for the project's members (the channel is theirs). */
export function TeamChatButton({ projectId, member }: { projectId: string; member: boolean }) {
  const { data } = useProjectConversation(projectId, member);
  const router = useRouter();
  if (!data) return null;
  return (
    <Button
      size="sm"
      variant="secondary"
      icon={<MessageCircle aria-hidden />}
      aria-label={
        data.unreadCount > 0
          ? t('chat.teamChatUnread', { count: formatNumber(data.unreadCount) })
          : undefined
      }
      onClick={() => router.push(`/chat/${data.id}`)}
    >
      {t('chat.teamChat')}
      {data.unreadCount > 0 && (
        <span
          aria-hidden
          className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[0.6875rem] font-bold text-on-primary"
        >
          {formatNumber(Math.min(data.unreadCount, 99))}
        </span>
      )}
    </Button>
  );
}
