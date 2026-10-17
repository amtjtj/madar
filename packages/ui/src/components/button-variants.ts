import { cva } from 'class-variance-authority';

/**
 * Tactile buttons: solid variants sit on a darker "edge" and press down on click,
 * which gives the playful feel without hurting legibility.
 */
export const buttonVariants = cva(
  [
    'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-semibold',
    'transition-[transform,box-shadow,background-color,color] duration-(--duration-fast) ease-(--ease-out-quart)',
    'disabled:pointer-events-none disabled:opacity-50 aria-busy:pointer-events-none',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
    '[&_svg]:size-[1.15em] [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-on-primary shadow-[0_3px_0_var(--primary-edge)] hover:brightness-105 active:translate-y-[3px] active:shadow-none',
        accent:
          'bg-accent text-on-accent shadow-[0_3px_0_var(--accent-edge)] hover:brightness-105 active:translate-y-[3px] active:shadow-none',
        danger:
          'bg-danger text-on-danger shadow-[0_3px_0_var(--danger-edge)] hover:brightness-105 active:translate-y-[3px] active:shadow-none',
        secondary:
          'border-2 border-line-strong bg-surface text-ink shadow-[0_3px_0_var(--line-strong)] hover:bg-sunken active:translate-y-[3px] active:shadow-none',
        ghost: 'text-ink-muted hover:bg-sunken hover:text-ink active:scale-[0.98]',
      },
      size: {
        sm: 'h-9 rounded-md px-3 text-sm',
        md: 'h-11 rounded-lg px-5 text-base',
        lg: 'h-13 rounded-xl px-7 text-lg',
        icon: 'size-11 rounded-lg',
      },
      fullWidth: { true: 'w-full' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);
