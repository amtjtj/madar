import { describe, expect, it } from 'vitest';

import { liteTextPreview, parseInline, parseLiteText } from './letter-text.js';

describe('lite text', () => {
  it('reads paragraphs, lists and bold', () => {
    expect(
      parseLiteText('سلام،\nلطفاً **تا شنبه** بررسی کنید.\n\n- قرارداد\n- پیوست ۲\n\nممنون'),
    ).toEqual([
      {
        type: 'paragraph',
        lines: [
          [{ text: 'سلام،', bold: false }],
          [
            { text: 'لطفاً ', bold: false },
            { text: 'تا شنبه', bold: true },
            { text: ' بررسی کنید.', bold: false },
          ],
        ],
      },
      {
        type: 'list',
        items: [[{ text: 'قرارداد', bold: false }], [{ text: 'پیوست ۲', bold: false }]],
      },
      { type: 'paragraph', lines: [[{ text: 'ممنون', bold: false }]] },
    ]);
  });

  it('keeps markup and unclosed marks as plain text', () => {
    expect(parseInline('<script>alert(1)</script> **باز')).toEqual([
      { text: '<script>alert(1)</script> **باز', bold: false },
    ]);
  });

  it('previews without marks', () => {
    expect(liteTextPreview('**مهم:**\n- یک\n- دو')).toBe('مهم: یک دو');
  });
});

describe('formatLetterNumber', () => {
  it('pads the sequence to five digits', async () => {
    const { formatLetterNumber } = await import('./contracts/letters.js');
    expect(formatLetterNumber(1405, 42)).toBe('1405/00042');
  });
});
