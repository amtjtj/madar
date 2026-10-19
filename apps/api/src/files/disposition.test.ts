import { describe, expect, it } from 'vitest';

import { contentDisposition } from './disposition.js';

describe('contentDisposition', () => {
  it('keeps a Persian name in filename* with an ASCII fallback', () => {
    expect(contentDisposition('attachment', 'قرارداد "نهایی".pdf')).toBe(
      `attachment; filename="_______ _______.pdf"; filename*=UTF-8''${encodeURIComponent('قرارداد "نهایی".pdf')}`,
    );
    expect(contentDisposition('inline', "a'b.png")).toBe(
      `inline; filename="a'b.png"; filename*=UTF-8''a%27b.png`,
    );
  });
});
