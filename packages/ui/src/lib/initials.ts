/**
 * Initials for a Persian or Latin name: first letter of the first and last word.
 * With `max = 1` only the first letter is returned (small avatars).
 */
export function getInitials(name: string, max: 1 | 2 = 2): string {
  const words = name.replace(/‌/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const first = Array.from(words[0] ?? '')[0] ?? '';
  const last =
    max > 1 && words.length > 1 ? (Array.from(words[words.length - 1] ?? '')[0] ?? '') : '';
  // Persian has no letter case and joins letters; a ZWNJ keeps the two initials separate.
  return last ? `${first}‌${last}` : first;
}
