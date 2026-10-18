/**
 * Demo server: empties the database and seeds «زرین‌مدار» again, so dates stay relative to today
 * and every visitor starts clean (plan phase-1-step-9 §5). Refuses to run without DEMO_MODE.
 *   node dist/scripts/demo-reset.js           reset once
 *   node dist/scripts/demo-reset.js --daily   reset every day at DEMO_RESET_AT (Tehran)
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { truncateAllData } from '@madar/db';

import { demoMode, nextDailyRun } from './demo.js';

const log = (message: string) =>
  process.stdout.write(
    `${JSON.stringify({ time: new Date().toISOString(), service: 'demo', message })}\n`,
  );

function seed(): Promise<void> {
  return new Promise((done, failed) => {
    const child = spawn(process.execPath, [resolve(import.meta.dirname, 'seed.js')], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) =>
      code === 0 ? done() : failed(new Error(`seed exited with ${code}`)),
    );
  });
}

async function reset(): Promise<void> {
  const ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) throw new Error('DATABASE_URL (owner) is required to reset the demo');
  const tables = await truncateAllData(ownerUrl);
  log(`emptied ${tables} tables`);
  await seed();
  log('demo company seeded');
}

async function main(): Promise<void> {
  if (!demoMode(process.env)) throw new Error('Refusing to reset: DEMO_MODE is not true');
  if (!process.argv.includes('--daily')) return reset();
  const at = process.env.DEMO_RESET_AT || '05:00';
  for (;;) {
    const next = nextDailyRun(new Date(), at, 'Asia/Tehran');
    log(`next demo reset at ${next.toISOString()}`);
    await new Promise((wake) => setTimeout(wake, next.getTime() - Date.now()));
    await reset().catch((error: unknown) => log(`ERROR demo reset failed: ${String(error)}`));
  }
}

main().catch((error: unknown) => {
  log(`ERROR ${String(error)}`);
  process.exit(1);
});
