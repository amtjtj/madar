import { describe, expect, it } from 'vitest';

import { applyMark, replyRecipients, replySubject } from './letters';

describe('letter helpers', () => {
  it('wraps the selection in bold marks', () => {
    expect(applyMark('سلام دنیا', 5, 9, 'bold')).toEqual({
      text: 'سلام **دنیا**',
      start: 7,
      end: 11,
    });
  });

  it('turns the selected lines into a list', () => {
    expect(applyMark('یک\nدو\nسه', 3, 8, 'list').text).toBe('یک\n- دو\n- سه');
    expect(applyMark('- یک', 0, 4, 'list').text).toBe('- یک');
  });

  it('prefixes a reply subject once', () => {
    expect(replySubject('قرارداد')).toBe('پاسخ: قرارداد');
    expect(replySubject('پاسخ: قرارداد')).toBe('پاسخ: قرارداد');
  });
});

describe('replyRecipients', () => {
  const person = (id: string, kind: 'to' | 'cc' | 'referral') => ({
    id,
    displayName: id,
    kind,
    referredBy: null,
    referralNote: null,
    referredAt: null,
  });
  const letter = {
    sender: { id: 'ali', displayName: 'ali' },
    recipients: [
      person('me', 'to'),
      person('maryam', 'to'),
      person('reza', 'cc'),
      person('sina', 'referral'),
    ],
  };

  it('replies to the sender only', () => {
    expect(replyRecipients(letter, false, 'me')).toEqual({
      to: [{ id: 'ali', displayName: 'ali' }],
      cc: [],
    });
  });

  it('replies to all except me and referrals', () => {
    const { to, cc } = replyRecipients(letter, true, 'me');
    expect(to.map((p) => p.id)).toEqual(['ali', 'maryam']);
    expect(cc.map((p) => p.id)).toEqual(['reza']);
  });

  it('replying to my own letter goes to its recipients', () => {
    expect(replyRecipients(letter, false, 'ali').to.map((p) => p.id)).toEqual(['me', 'maryam']);
  });
});
