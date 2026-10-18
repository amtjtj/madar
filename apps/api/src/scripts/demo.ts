import { addDays, calendarDateIn, zonedInstant } from '@madar/shared';

/** Demo server only (plan phase-1-step-9 §5). Read from the environment like the config does. */
export function demoMode(env: NodeJS.ProcessEnv): boolean {
  return env.DEMO_MODE === 'true' || env.DEMO_MODE === '1';
}

/** The next moment the wall clock in `timeZone` shows `at` (HH:MM), after `now`. */
export function nextDailyRun(now: Date, at: string, timeZone: string): Date {
  const today = calendarDateIn(now, timeZone);
  const todayRun = zonedInstant(today, at, timeZone);
  return todayRun > now ? todayRun : zonedInstant(addDays(today, 1), at, timeZone);
}
