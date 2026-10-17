import { describe, expect, it } from 'vitest';

import { formatNumber, formatPercent, toLatinDigits, toPersianDigits } from './digits.js';

describe('digits', () => {
  it('converts Latin digits to Persian', () => {
    expect(toPersianDigits('v1.20')).toBe('v۱.۲۰');
    expect(toPersianDigits(2026)).toBe('۲۰۲۶');
  });

  it('normalizes Persian and Arabic-Indic digits to Latin', () => {
    expect(toLatinDigits('۰۹۱۲-٣٤٥')).toBe('0912-345');
  });

  it('round-trips', () => {
    expect(toLatinDigits(toPersianDigits('1234567890'))).toBe('1234567890');
  });

  it('formats numbers and percentages in Persian', () => {
    expect(formatNumber(1234567)).toBe('۱٬۲۳۴٬۵۶۷');
    expect(formatPercent(0.72)).toBe('۷۲٪');
  });
});
