/**
 * Sets SEED_PASSWORD again for every seeded «زرین‌مدار» account, when the password printed at seed
 * time was lost or a second seed run (which changes nothing) printed a new one. Only the seeded
 * usernames are touched, and only with DEMO_MODE on in production, like the seed itself.
 *   node dist/scripts/seed-passwords.js
 */
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { schema as s, type DbHandle } from '@madar/db';
import { inArray } from 'drizzle-orm';

import { AppModule } from '../app.module.js';
import { AccountsService } from '../auth/accounts.service.js';
import { DB_HANDLE } from '../database/tokens.js';
import { demoMode } from './demo.js';
import { SEED_PEOPLE } from './seed-data.js';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production' && !demoMode(process.env)) {
    throw new Error('Refusing to run on a production database (set DEMO_MODE=true)');
  }
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 12)
    throw new Error('SEED_PASSWORD (12+ characters) is required');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const handle = app.get<DbHandle>(DB_HANDLE);
    const accounts = app.get(AccountsService);
    const users = await handle.db
      .select({ id: s.users.id, username: s.users.username })
      .from(s.users)
      .where(
        inArray(
          s.users.username,
          SEED_PEOPLE.map((person) => person.username),
        ),
      );
    for (const user of users) await accounts.setPassword(user.id, password, false);
    process.stdout.write(`Password set for ${users.length} seeded accounts.\n`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exit(1);
});
