'use client';

import { Bell, BellOff, FolderKanban, LogOut, UserMinus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { t } from '@madar/i18n';
import type { Conversation } from '@madar/shared';
import { Avatar, Badge, Button, Modal, TextField, useToast } from '@madar/ui';

import { RecipientPicker, type Person } from '@/components/letters/recipient-picker';
import {
  useAddMembers,
  useLeaveGroup,
  useMuteConversation,
  useRemoveMember,
  useRenameGroup,
} from '@/hooks/chat';
import { useMe } from '@/hooks/use-me';
import { errorMessage } from '@/lib/errors';

/** Members and settings of a conversation; channel members are managed where they come from. */
export function ConversationInfo({
  conversation,
  open,
  onOpenChange,
}: {
  conversation: Conversation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = conversation.id;
  const { data: me } = useMe();
  const router = useRouter();
  const { toast } = useToast();
  const mute = useMuteConversation(id);
  const rename = useRenameGroup(id);
  const add = useAddMembers(id);
  const remove = useRemoveMember(id);
  const leave = useLeaveGroup(id);
  const [title, setTitle] = useState(conversation.title);
  const [adding, setAdding] = useState<Person[]>([]);
  const [leaving, setLeaving] = useState(false);
  const onError = (error: unknown) => toast({ tone: 'error', title: errorMessage(error) });

  return (
    <>
      <Modal open={open} onOpenChange={onOpenChange} title={t('chat.info')}>
        <div className="flex flex-col gap-4">
          <Button
            variant="secondary"
            icon={conversation.muted ? <Bell aria-hidden /> : <BellOff aria-hidden />}
            onClick={() =>
              mute.mutate(!conversation.muted, {
                onSuccess: () =>
                  toast({
                    tone: 'success',
                    title: t(conversation.muted ? 'chat.unmuted' : 'chat.muted'),
                  }),
                onError,
              })
            }
          >
            {t(conversation.muted ? 'chat.unmute' : 'chat.mute')}
          </Button>

          {conversation.can.manage && (
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!title.trim()) return;
                rename.mutate(title.trim(), {
                  onSuccess: () => toast({ tone: 'success', title: t('chat.renamed') }),
                  onError,
                });
              }}
            >
              <TextField
                label={t('chat.groupName')}
                value={title}
                maxLength={80}
                onChange={(e) => setTitle(e.target.value)}
                className="flex-1"
              />
              <Button type="submit" variant="secondary" loading={rename.isPending}>
                {t('chat.rename')}
              </Button>
            </form>
          )}

          {conversation.kind === 'project' && conversation.projectId && (
            <div className="flex flex-col gap-2 rounded-xl bg-sunken p-3 text-sm text-ink-muted">
              <p>{t('chat.projectMembersHint')}</p>
              <Link
                href={`/projects/${conversation.projectId}`}
                className="inline-flex items-center gap-1.5 font-semibold text-primary-ink [&_svg]:size-4"
              >
                <FolderKanban aria-hidden />
                {t('chat.openProject')}
              </Link>
            </div>
          )}
          {conversation.kind === 'department' && (
            <p className="rounded-xl bg-sunken p-3 text-sm text-ink-muted">
              {t('chat.departmentMembersHint')}
            </p>
          )}

          {conversation.can.addMembers && (
            <div className="flex flex-col gap-2">
              <RecipientPicker
                label={t('chat.addMembers')}
                value={adding}
                onChange={setAdding}
                exclude={conversation.members.map((m) => m.id)}
              />
              {adding.length > 0 && (
                <Button
                  loading={add.isPending}
                  onClick={() =>
                    add.mutate(
                      adding.map((p) => p.id),
                      {
                        onSuccess: () => {
                          setAdding([]);
                          toast({ tone: 'success', title: t('chat.added') });
                        },
                        onError,
                      },
                    )
                  }
                >
                  {t('chat.addMembers')}
                </Button>
              )}
            </div>
          )}

          <ul
            aria-label={t('chat.members', { count: String(conversation.members.length) })}
            className="flex max-h-72 flex-col divide-y divide-line overflow-y-auto"
          >
            {conversation.members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2">
                <Avatar name={m.displayName} size="sm" />
                <span className="min-w-0 flex-1 truncate font-medium text-ink">
                  {m.displayName}
                </span>
                {m.owner && conversation.kind === 'group' && (
                  <Badge tone="primary">{t('chat.owner')}</Badge>
                )}
                {!m.canPost && <Badge>{t('chat.readsOnly')}</Badge>}
                {conversation.can.manage && m.id !== me?.member?.id && (
                  <button
                    type="button"
                    aria-label={t('chat.remove', { name: m.displayName })}
                    onClick={() =>
                      remove.mutate(m.id, {
                        onSuccess: () => toast({ tone: 'success', title: t('chat.removed') }),
                        onError,
                      })
                    }
                    className="grid size-10 place-items-center rounded-full text-ink-subtle hover:bg-sunken hover:text-danger-ink [&_svg]:size-4"
                  >
                    <UserMinus aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>

          {conversation.can.leave && (
            <Button
              variant="ghost"
              className="text-danger-ink"
              icon={<LogOut aria-hidden />}
              onClick={() => setLeaving(true)}
            >
              {t('chat.leave')}
            </Button>
          )}
        </div>
      </Modal>
      <Modal
        open={leaving}
        onOpenChange={setLeaving}
        title={t('chat.leaveTitle')}
        description={t('chat.leaveBody')}
      >
        <div className="flex gap-3">
          <Button
            variant="danger"
            className="flex-1"
            loading={leave.isPending}
            // mutateAsync: the refetch after leaving 404s and unmounts this dialog, which would
            // drop mutate()'s per-call callbacks before the redirect.
            onClick={() =>
              leave.mutateAsync(undefined).then(() => {
                toast({ tone: 'success', title: t('chat.left') });
                router.replace('/chat');
              }, onError)
            }
          >
            {t('chat.leave')}
          </Button>
          <Button variant="ghost" onClick={() => setLeaving(false)}>
            {t('chat.cancel')}
          </Button>
        </div>
      </Modal>
    </>
  );
}
