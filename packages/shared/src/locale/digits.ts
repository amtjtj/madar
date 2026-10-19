const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Converts Latin digits to Persian digits for display. Data and code keep Latin digits. */
export function toPersianDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (digit) => PERSIAN_DIGITS[Number(digit)] ?? digit);
}

/** Normalizes Persian and Arabic-Indic digits in user input to Latin digits before parsing or storing. */
export function toLatinDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => {
    const persian = PERSIAN_DIGITS.indexOf(digit);
    return String(persian >= 0 ? persian : ARABIC_INDIC_DIGITS.indexOf(digit));
  });
}

/** Formats a number with Persian digits and separators (e.g. ۱٬۲۳۴٫۵). */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat('fa-IR', options).format(value);
}

/** Formats a ratio (0..1) as a Persian percentage (e.g. 0.72 → ۷۲٪). */
export function formatPercent(ratio: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat('fa-IR', { style: 'percent', maximumFractionDigits }).format(ratio);
}

/**
 * A decimal typed by a person (Persian or Latin digits, Persian or Latin separators) as a number;
 * undefined when empty, NaN when it is not a number.
 */
export function parseDecimal(input: string): number | undefined {
  const normalized = toLatinDigits(input)
    .replace(/[٬,\s]/g, '')
    .replace('٫', '.');
  return normalized === '' ? undefined : Number(normalized);
}

/**
 * A file size in Persian digits with its unit key: «۲٫۴» + 'mb'. The unit's word comes from i18n
 * (`ui.fileSize.*`), so this module stays free of UI text.
 */
export function fileSizeParts(bytes: number): { value: string; unit: 'b' | 'kb' | 'mb' } {
  if (bytes < 1024) return { value: formatNumber(bytes), unit: 'b' };
  if (bytes < 1024 * 1024) {
    return { value: formatNumber(Math.max(1, Math.round(bytes / 1024))), unit: 'kb' };
  }
  return {
    value: formatNumber(bytes / (1024 * 1024), { maximumFractionDigits: 1 }),
    unit: 'mb',
  };
}
