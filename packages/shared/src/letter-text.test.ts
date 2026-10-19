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

describe('evidence contracts', () => {
  it('accepts a letter pin and rejects unknown kinds', async () => {
    const { pinEvidenceRequest } = await import('./contracts/evidence.js');
    const id = '0190b3a0-0000-7000-8000-000000000000';
    expect(pinEvidenceRequest.safeParse({ kind: 'letter', subjectId: id }).success).toBe(true);
    expect(pinEvidenceRequest.safeParse({ kind: 'task', subjectId: id }).success).toBe(false);
  });
});
