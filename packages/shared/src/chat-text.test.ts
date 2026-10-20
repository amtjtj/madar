import { describe, expect, it } from 'vitest';

import { canStillEdit, directKey, messageSegments } from './chat-text.js';

describe('chat text', () => {
  it('finds http and https links and leaves the rest as text', () => {
    expect(messageSegments('ببین https://example.ir/a?b=1، و javascript:alert(1)')).toEqual([
      { type: 'text', text: 'ببین ' },
      { type: 'link', text: 'https://example.ir/a?b=1', href: 'https://example.ir/a?b=1' },
      { type: 'text', text: '، و javascript:alert(1)' },
    ]);
    expect(messageSegments('<script>x</script>')).toEqual([
      { type: 'text', text: '<script>x</script>' },
    ]);
  });

  it('keeps sentence punctuation out of a link', () => {
    const [, link, rest] = messageSegments('سایت http://a.ir.');
    expect(link).toMatchObject({ href: 'http://a.ir' });
    expect(rest).toEqual({ type: 'text', text: '.' });
  });

  it('gives a two-person conversation one key', () => {
    expect(directKey('b', 'a')).toBe(directKey('a', 'b'));
  });

  it('allows edits for 15 minutes', () => {
    const now = new Date('2026-10-20T10:00:00Z');
    expect(canStillEdit('2026-10-20T09:46:00Z', now)).toBe(true);
    expect(canStillEdit('2026-10-20T09:44:00Z', now)).toBe(false);
  });
});
