/** Joins class names, skipping falsy values. Replaced by a tailwind-merge based helper in the design-system step. */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
