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
