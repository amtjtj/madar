/**
 * Seeds the demo company through the real services (same validation, permissions and audit log
 * as the app). Development only. Usage: pnpm db:seed
 */
import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { schema as s, withTenant, type DbHandle } from '@madar/db';
import { addDays, calendarDateIn, type SystemRole } from '@madar/shared';
import { eq } from 'drizzle-orm';

import { AppModule } from '../app.module.js';
import { AccountsService } from '../auth/accounts.service.js';
import { TenantContextService } from '../auth/tenant-context.service.js';
import type { TenantContext } from '../common/context.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DB_HANDLE } from '../database/tokens.js';
import { DepartmentsService } from '../departments/departments.service.js';
import { MembersService } from '../members/members.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { ProjectsService } from '../work/projects.service.js';
import { TasksService } from '../work/tasks.service.js';
import { TodayService } from '../work/today.service.js';
import { SEED_COMPANY, SEED_DEPARTMENTS, SEED_PEOPLE } from './seed-data.js';
import { SEED_PROJECTS, SEED_TASKS } from './seed-work.js';

const logger = new Logger('Seed');
/** Summary lines go straight to stdout (the Nest logger is limited to warnings while seeding). */
const say = (line: string) => process.stdout.write(`${line}\n`);

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Refusing to seed a production database');
  const password = process.env.SEED_PASSWORD ?? 'madar-demo-1234';

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const env = app.get<Env>(ENV);
    const handle = app.get<DbHandle>(DB_HANDLE);
    const [existing] = await handle.db
      .select({ id: s.tenants.id })
      .from(s.tenants)
      .where(eq(s.tenants.slug, SEED_COMPANY.slug));
    if (existing) {
      logger.warn(
        `"${SEED_COMPANY.slug}" already exists; nothing to do. Reset with: pnpm --filter @madar/db db:reset`,
      );
      return;
    }

    const [owner, ...others] = SEED_PEOPLE;
    if (!owner) throw new Error('seed data has no owner');
    const tenants = app.get(TenantsService);
    const { tenantId } = await tenants.signup(
      {
        companyName: SEED_COMPANY.name,
        slug: SEED_COMPANY.slug,
        adminName: owner.name,
        username: owner.username,
        password,
        signupCode: env.TENANT_SIGNUP_CODE || undefined,
      },
      { ip: null, userAgent: 'seed' },
    );

    // Act as the owner for everything else, exactly like the app would.
    const ownerUser = await app.get(AccountsService).findByUsername(owner.username);
    if (!ownerUser) throw new Error('owner user missing');
    const loaded = await app.get(TenantContextService).loadMember(tenantId, ownerUser.id);
    if (!loaded) throw new Error('owner member missing');
    const ctx: TenantContext = {
      user: {
        id: ownerUser.id,
        name: owner.name,
        username: owner.username,
        twoFactorEnabled: false,
        mustChangePassword: false,
      },
      sessionToken: 'seed',
      activeTenantId: tenantId,
      ip: null,
      userAgent: 'seed',
      tenantId,
      tenantStatus: 'active',
      memberId: loaded.memberId,
      actor: loaded.actor,
    };

    const departments = app.get(DepartmentsService);
    const departmentIds = new Map<string, string>();
    for (const d of SEED_DEPARTMENTS) {
      const created = await departments.create(ctx, { name: d.name, templateKey: d.templateKey });
      departmentIds.set(d.key, created.id);
    }

    const members = app.get(MembersService);
    const memberIds = new Map<string, string>([[owner.username, loaded.memberId]]);
    await members.update(ctx, loaded.memberId, {
      title: owner.title,
      departments: [
        {
          departmentId: departmentIds.get(owner.department) ?? '',
          deptRole: 'head',
          isPrimary: true,
        },
      ],
    });

    const accounts = app.get(AccountsService);
    for (const person of others) {
      const roles: SystemRole[] = [...(person.roles ?? []), 'member'];
      const { member } = await members.create(ctx, {
        displayName: person.name,
        username: person.username,
        title: person.title,
        roles: [...new Set(roles)],
        departments: [
          {
            departmentId: departmentIds.get(person.department) ?? '',
            deptRole: person.head ? 'head' : 'member',
            isPrimary: true,
          },
        ],
        managerId: person.manager ? memberIds.get(person.manager) : undefined,
      });
      memberIds.set(person.username, member.id);
      // Demo accounts get the shared seed password instead of a temporary one.
      const user = await accounts.findByUsername(person.username);
      if (user) await accounts.setPassword(user.id, password, false);
    }

    for (const d of SEED_DEPARTMENTS) {
      if (d.oversight)
        await departments.setOversight(ctx, departmentIds.get(d.key) ?? '', {
          resources: d.oversight,
        });
    }

    // Work: projects and tasks, each created by the person who would create it in the app.
    const contextFor = async (username: string): Promise<TenantContext> => {
      const user = await accounts.findByUsername(username);
      const member = user && (await app.get(TenantContextService).loadMember(tenantId, user.id));
      if (!user || !member) throw new Error(`seed member ${username} missing`);
      return {
        ...ctx,
        user: { ...ctx.user, id: user.id, username },
        memberId: member.memberId,
        actor: member.actor,
      };
    };
    const contexts = new Map<string, TenantContext>();
    const as = async (username: string) => {
      const cached = contexts.get(username);
      if (cached) return cached;
      const loadedCtx = await contextFor(username);
      contexts.set(username, loadedCtx);
      return loadedCtx;
    };
    const idOf = (username: string) => {
      const id = memberIds.get(username);
      if (!id) throw new Error(`seed member ${username} missing`);
      return id;
    };

    const today = calendarDateIn(new Date());
    const projects = app.get(ProjectsService);
    const projectIds = new Map<string, string>();
    for (const p of SEED_PROJECTS) {
      const project = await projects.create(await as(p.owner), {
        name: p.name,
        description: p.description,
        departmentId: departmentIds.get(p.department) ?? null,
        visibility: p.visibility,
        dueOn: p.dueIn === undefined ? null : addDays(today, p.dueIn),
        memberIds: (p.members ?? []).map(idOf),
      });
      projectIds.set(p.key, project.id);
    }

    const tasks = app.get(TasksService);
    const todayPlans = app.get(TodayService);
    let taskCount = 0;
    for (const item of SEED_TASKS) {
      const reporter = await as(item.by);
      const task = await tasks.create(reporter, {
        title: item.title,
        description: item.description ?? null,
        projectId: item.project ? projectIds.get(item.project) : null,
        assigneeId: item.assignee ? idOf(item.assignee) : null,
        dueOn: item.dueIn === undefined ? null : addDays(today, item.dueIn),
        priority: item.priority,
        weight: item.weight,
        statusKey: item.status,
      });
      taskCount++;
      for (const title of item.subtasks ?? []) {
        await tasks.create(reporter, {
          title,
          parentId: task.id,
          departmentId: task.department.id,
          projectId: task.project?.id ?? null,
          assigneeId: task.assignee?.id ?? null,
        });
        taskCount++;
      }
      for (const comment of item.comments ?? []) {
        await tasks.addComment(await as(comment.by), task.id, { body: comment.body });
      }
      if (item.today && item.assignee) await todayPlans.add(await as(item.assignee), task.id);
      if (item.yesterday && item.assignee) {
        await withTenant(handle.db, { tenantId }, (tx) =>
          tx.insert(s.dailyPlanItems).values({
            memberId: idOf(item.assignee ?? ''),
            planDate: addDays(today, -1),
            taskId: task.id,
          }),
        );
      }
    }

    const count = await withTenant(
      handle.db,
      { tenantId },
      async (tx) => (await tx.select({ id: s.members.id }).from(s.members)).length,
    );
    say(
      `Seeded "${SEED_COMPANY.name}" (${SEED_COMPANY.slug}): ${SEED_DEPARTMENTS.length} departments, ${count} members, ${SEED_PROJECTS.length} projects, ${taskCount} tasks.`,
    );
    say(
      `Sign in as any seeded username (e.g. ${owner.username}, maryam.ahmadi, ali.rezaei) with SEED_PASSWORD.`,
    );
    say('Owner and admin accounts are asked to set up two-factor authentication at first sign-in.');
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  logger.error(error);
  process.exit(1);
});
