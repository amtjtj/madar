import { t } from '@madar/i18n';
import { formatNumber, taskXp, type MyProgress, type Task } from '@madar/shared';

/**
 * The «+XP» the check shows when I finish a task (ADR 0029): an estimate from the same rule the
 * worker uses, only for my own tasks, and nothing once today's cap is full or it is switched off.
 */
export function xpForFinishing(
  task: Pick<Task, 'weight' | 'dueOn' | 'source' | 'assignee'>,
  me: string | undefined,
  progress: MyProgress | undefined,
): number | undefined {
  if (!progress?.enabled || progress.today.capReached || !me || task.assignee?.id !== me) {
    return undefined;
  }
  const xp = taskXp({
    weight: task.weight,
    source: task.source?.kind ?? null,
    dueOn: task.dueOn,
    completedOn: progress.today.date,
  });
  return xp.completed + xp.onTime;
}

const LEVEL_KEY = 'madar.progress.level';

/**
 * Whether this device should celebrate `level` now: once per new level, never on the first visit
 * (a per-device convenience; nothing breaks without storage).
 */
export function celebrateLevel(level: number): boolean {
  try {
    const seen = Number(localStorage.getItem(LEVEL_KEY) ?? 0);
    localStorage.setItem(LEVEL_KEY, String(level));
    return seen > 0 && level > seen;
  } catch {
    return false;
  }
}

/** The line under «پیشرفت من»: what today still needs, in plain words. */
export function dayHint(progress: MyProgress): string {
  const { today } = progress;
  if (!today.working) return t('progress.hint.dayOff');
  if (today.planned === 0) return t('progress.hint.noPlan');
  if (today.complete) return t('progress.hint.complete');
  return t('progress.hint.needed', {
    done: formatNumber(today.done),
    planned: formatNumber(today.planned),
    needed: formatNumber(today.needed),
  });
}
