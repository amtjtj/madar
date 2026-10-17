# 0008 — Design system foundations

- Status: Accepted
- Date: 2026-10-17

## Context
The brief asks for a Duolingo-level, lovable experience that still feels trustworthy to the CEO of a fintech. Everything is RTL-first, Persian-first, light and dark.

## Decision

**Visual direction**
- Primary «سبز مدار» (emerald-teal, `--primary`): actions, progress, task completion.
- Accent saffron/gold (`--accent`): XP, levels, celebration — a nod to Persian culture and the gold pilot.
- Streak flame (`--streak`) used only for streaks.
- Ink-navy neutrals on warm paper (`--canvas`, `--surface`, `--ink`); dark theme uses deep ink-blue, not pure black.
- Playfulness comes from motion and tactile buttons (solid variants sit on a darker 3px edge and press down), not from loud colors or rounded-everything; radii stay moderate (8–20px).

**Tokens** (`packages/ui/src/styles/theme.css`)
- Semantic CSS variables in OKLCH, mapped to Tailwind with `@theme inline` (`bg-surface`, `text-ink-muted`, `bg-primary-soft`, …). Components never use raw colors.
- Theme switching: `data-theme="light|dark"` on any element (so a subtree can be themed), OS preference when `<html>` has none. An inline `themeScript` applies the saved choice before paint; `useTheme()` reads `<html data-theme>` through `useSyncExternalStore` (no provider).
- Persian line heights (1.6–1.8 for body sizes), radius scale, four ink-tinted shadows, motion tokens (`--ease-spring`, durations ≤ 320ms).

**Typography**: Vazirmatn variable font, self-hosted in the repo and loaded via `next/font/local`. No font feature that swaps digits — digits are converted explicitly so data, usernames and codes keep Latin digits.

**Locale utilities** live in `@madar/shared` (usable by the API too): Jalali conversion via `jalaali-js`, formatting via `Intl` with the tenant timezone, Persian digits/number/percent helpers, Saturday-first week.

**Components** (`@madar/ui`): Button, TextField, Card, ProgressBar, ProgressRing, Avatar/AvatarGroup, Badge, AchievementBadge, Skeleton/SkeletonText, EmptyState (+ orbit illustration), Toast (Radix), Modal (Radix; bottom sheet on mobile, dialog from `sm`), BottomNav, Sidebar, CompleteCheck (task-done animation), ThemeToggle. All user-facing strings come from `@madar/i18n`; navigation components accept any link component so the package stays framework-agnostic.

**Motion rules**: feedback under 400ms and never blocking; the completion moment (pop, self-drawing check, confetti, floating «+XP») lands in ~250ms, the decorative tail fades by ~900ms. `prefers-reduced-motion` disables the burst and travel.

## Consequences
- New colors require a token in both themes.
- `/design-system` is the living reference and is covered by e2e tests at 360px and 1440px.
- `'use client'` files export only components, hooks and types (see CLAUDE.md).
