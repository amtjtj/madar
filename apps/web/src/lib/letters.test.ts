import { describe, expect, it } from 'vitest';

import { applyMark, replySubject } from './letters';

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
