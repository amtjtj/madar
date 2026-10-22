import type { Message } from '@madar/shared';
import { describe, expect, it } from 'vitest';

import {
  conversationPreview,
  decodeMentions,
  encodeMentions,
  flattenMessages,
  groupMessages,
  matchPeople,
  mentionQuery,
  reactionViews,
  toggleReaction,
  upsertMessage,
} from './chat';

const msg = (id: string, author: string, createdAt: string, body = id): Message => ({
  id,
  conversationId: 'c',
  author: { id: author, displayName: author },
  body,
  replyTo: null,
  createdAt,
  editedAt: null,
  deleted: false,
  attachments: [],
  mentions: [],
  reactions: [],
});

describe('chat helpers', () => {
  it('appends new messages to the newest page and replaces known ones', () => {
    const data = {
      pages: [
        { items: [msg('3', 'a', '2026-10-20T08:00:00Z')], hasMore: true },
        { items: [msg('1', 'a', '2026-10-19T08:00:00Z')], hasMore: false },
      ],
      pageParams: [undefined, '3'],
    };
    const added = upsertMessage(data, msg('4', 'b', '2026-10-20T08:01:00Z'));
    expect(flattenMessages(added.pages).map((m) => m.id)).toEqual(['1', '3', '4']);
    const edited = upsertMessage(added, msg('1', 'a', '2026-10-19T08:00:00Z', 'تازه'));
    expect(flattenMessages(edited.pages).find((m) => m.id === '1')?.body).toBe('تازه');
  });

  it('keeps id order, swaps my pending copy, and ignores edits of messages not loaded', () => {
    const data = {
      pages: [{ items: [msg('3', 'a', '2026-10-20T08:00:00Z')], hasMore: true }],
      pageParams: [undefined],
    };
    const pending = upsertMessage(data, msg('pending-1', 'me', '2026-10-20T08:02:00Z', 'سلام'));
    // Committed in the other order: still shown by id.
    const late = upsertMessage(pending, msg('2', 'b', '2026-10-20T07:59:00Z'));
    expect(flattenMessages(late.pages).map((m) => m.id)).toEqual(['2', '3', 'pending-1']);
    // My message comes back through the socket before the send returns: no second bubble.
    const live = upsertMessage(late, msg('4', 'me', '2026-10-20T08:02:00Z', 'سلام'));
    expect(flattenMessages(live.pages).map((m) => m.id)).toEqual(['2', '3', '4']);
    // A delete of an older, unloaded message does not appear at the bottom.
    const old = { ...msg('1', 'a', '2026-10-19T08:00:00Z', ''), deleted: true };
    expect(upsertMessage(live, old)).toBe(live);
  });

  it('groups by day and shows the author once per run', () => {
    const groups = groupMessages(
      [
        msg('1', 'a', '2026-10-19T08:00:00Z'),
        msg('2', 'a', '2026-10-20T08:00:00Z'),
        msg('3', 'a', '2026-10-20T08:01:00Z'),
        msg('4', 'b', '2026-10-20T08:02:00Z'),
      ],
      'Asia/Tehran',
    );
    expect(groups).toHaveLength(2);
    expect(groups[1]?.items.map((i) => i.showAuthor)).toEqual([true, false, true]);
  });

  it('finds the «@name» being typed and matches people by any part of the name', () => {
    expect(mentionQuery('سلام @مری', 9)).toEqual({ start: 5, query: 'مری' });
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQuery('a@b.ir', 6)).toBeNull();
    expect(mentionQuery('@مریم\nبعد', 9)).toBeNull();
    const people = [{ displayName: 'مریم احمدی' }, { displayName: 'علی رضایی' }];
    expect(matchPeople(people, 'احمد')).toEqual([people[0]]);
    expect(matchPeople(people, '')).toHaveLength(2);
  });

  it('turns picked «@name» into tokens and back', () => {
    const ali = { id: '0190a1b2-0000-7000-8000-000000000002', displayName: 'علی' };
    const aliR = { id: '0190a1b2-0000-7000-8000-000000000003', displayName: 'علی رضایی' };
    const body = encodeMentions('@علی رضایی و @علی ببینید', [ali, aliR]);
    expect(body).toBe(`<@${aliR.id}> و <@${ali.id}> ببینید`);
    expect(decodeMentions(body, [ali, aliR])).toBe('@علی رضایی و @علی ببینید');
  });

  it('toggles my reaction and marks it as mine', () => {
    const me = { id: 'me', displayName: 'من' };
    const base = msg('5', 'a', '2026-10-20T08:00:00Z');
    const on = toggleReaction(base, '👍', true, me);
    expect(reactionViews(on, 'me')).toEqual([{ emoji: '👍', names: ['من'], mine: true }]);
    expect(toggleReaction(on, '👍', false, me).reactions).toEqual([]);
  });

  it('previews a file-only message by the file name and mentions by name', () => {
    const summary = (body: string, fileName: string | null) => ({
      id: 'c',
      kind: 'group' as const,
      title: 'گروه',
      peer: null,
      projectId: null,
      departmentId: null,
      lastMessage: {
        author: { id: 'a', displayName: 'مریم' },
        body,
        createdAt: '2026-10-20T08:00:00Z',
        deleted: false,
        mentions: [{ id: '0190a1b2-0000-7000-8000-000000000002', displayName: 'علی' }],
        fileName,
      },
      unreadCount: 0,
      unreadMentions: 0,
      muted: false,
    });
    expect(conversationPreview(summary('', 'گزارش.pdf'), 'me')).toBe('مریم: فایل: گزارش.pdf');
    expect(
      conversationPreview(summary('<@0190a1b2-0000-7000-8000-000000000002> سلام', null), 'me'),
    ).toBe('مریم: @علی سلام');
  });
});
