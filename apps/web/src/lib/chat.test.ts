import type { Message } from '@madar/shared';
import { describe, expect, it } from 'vitest';

import { flattenMessages, groupMessages, upsertMessage } from './chat';

const msg = (id: string, author: string, createdAt: string, body = id): Message => ({
  id,
  conversationId: 'c',
  author: { id: author, displayName: author },
  body,
  replyTo: null,
  createdAt,
  editedAt: null,
  deleted: false,
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
});
