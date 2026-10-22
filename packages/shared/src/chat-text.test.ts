import { describe, expect, it } from 'vitest';

import {
  canStillEdit,
  csvLine,
  searchExcerpt,
  taskTitleFromMessage,
  directKey,
  mentionIdsIn,
  mentionToken,
  mentionsAsText,
  messageSegments,
} from './chat-text.js';

const MARYAM = '0190a1b2-0000-7000-8000-000000000001';
const ALI = '0190a1b2-0000-7000-8000-000000000002';

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

  it('reads mention tokens as mentions, next to links and text', () => {
    const body = `${mentionToken(MARYAM)} ببین https://a.ir و ${mentionToken(ALI)}`;
    expect(messageSegments(body)).toEqual([
      { type: 'mention', id: MARYAM },
      { type: 'text', text: ' ببین ' },
      { type: 'link', text: 'https://a.ir', href: 'https://a.ir' },
      { type: 'text', text: ' و ' },
      { type: 'mention', id: ALI },
    ]);
    // Not a token: stays text.
    expect(messageSegments('<@nope>')).toEqual([{ type: 'text', text: '<@nope>' }]);
    expect(
      mentionIdsIn(`${mentionToken(ALI)} ${mentionToken(ALI)} ${mentionToken(MARYAM)}`),
    ).toEqual([ALI, MARYAM]);
  });

  it('writes mentions as names for previews, never the raw id', () => {
    const names = new Map([[MARYAM, 'مریم احمدی']]);
    expect(mentionsAsText(`سلام ${mentionToken(MARYAM)} و ${mentionToken(ALI)}`, names)).toBe(
      'سلام @مریم احمدی و @…',
    );
  });

  it('gives a two-person conversation one key', () => {
    expect(directKey('b', 'a')).toBe(directKey('a', 'b'));
  });

  it('allows edits for 15 minutes', () => {
    const now = new Date('2026-10-20T10:00:00Z');
    expect(canStillEdit('2026-10-20T09:46:00Z', now)).toBe(true);
    expect(canStillEdit('2026-10-20T09:44:00Z', now)).toBe(false);
  });

  it('makes a task title from the first line, with names, at most 120 characters', () => {
    const names = new Map([[MARYAM, 'مریم احمدی']]);
    expect(
      taskTitleFromMessage(`\n  ${mentionToken(MARYAM)} صفحه خطا را درست کن\nجزئیات`, names),
    ).toBe('@مریم احمدی صفحه خطا را درست کن');
    expect(taskTitleFromMessage('الف'.repeat(100), names)).toHaveLength(120);
    expect(taskTitleFromMessage('   ', names)).toBe('');
  });

  it('writes CSV lines that survive commas, quotes and line breaks', () => {
    expect(csvLine(['ساده', 'با، ویرگول فارسی', 'a,b', 'گفت "سلام"', 'دو\nخط'])).toBe(
      'ساده,با، ویرگول فارسی,"a,b","گفت ""سلام""","دو\nخط"',
    );
  });

  it('cuts a search excerpt around the match, Persian digits included', () => {
    const text = `${'ابتدا '.repeat(20)}سرور تست ۲۰۲ آماده است ${'انتها '.repeat(40)}`;
    const excerpt = searchExcerpt(text, '202', 10, 20);
    expect(excerpt.startsWith('…')).toBe(true);
    expect(excerpt.endsWith('…')).toBe(true);
    expect(excerpt).toContain('۲۰۲');
    expect(searchExcerpt('کوتاه', 'هیچ')).toBe('کوتاه');
  });
});
