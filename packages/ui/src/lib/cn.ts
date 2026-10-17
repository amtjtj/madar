import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Teach tailwind-merge our custom text sizes so `text-ink` and `text-sm` don't clobber each other.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl'],
    },
  },
});

/** Merges class names; later Tailwind classes win over conflicting earlier ones. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
