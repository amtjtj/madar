import type { CheckinStatus, KeyResultKind } from './contracts/goals.js';

/** Progress of one key result, 0..1. Works for decreasing targets too (e.g. 24 h → 4 h). */
export function keyResultProgress(kr: {
  kind: KeyResultKind;
  startValue: number;
  targetValue: number;
  currentValue: number;
}): number {
  if (kr.kind === 'boolean') return kr.currentValue >= 1 ? 1 : 0;
  const span = kr.targetValue - kr.startValue;
  if (span === 0) return kr.currentValue === kr.targetValue ? 1 : 0;
  return Math.min(1, Math.max(0, (kr.currentValue - kr.startValue) / span));
}

/**
 * Progress of a goal: the weighted mean of its key results (their own weight) and its aligned
 * child goals (weight 1 each). A goal with neither is at 0.
 */
export function goalProgress(items: ReadonlyArray<{ progress: number; weight: number }>): number {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (total === 0) return 0;
  const value = items.reduce((sum, item) => sum + item.progress * item.weight, 0) / total;
  return Math.min(1, Math.max(0, value));
}

const SEVERITY: Record<CheckinStatus, number> = { on_track: 0, at_risk: 1, off_track: 2 };

/** A goal's status: the worst latest status among its key results (null when none checked in). */
export function worstStatus(
  statuses: ReadonlyArray<CheckinStatus | null | undefined>,
): CheckinStatus | null {
  let worst: CheckinStatus | null = null;
  for (const status of statuses) {
    if (status && (worst === null || SEVERITY[status] > SEVERITY[worst])) worst = status;
  }
  return worst;
}
