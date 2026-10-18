/**
 * Seeds the demo company through the real services (same validation, permissions and audit log
 * as the app). Development only. Usage: pnpm db:seed
 */
import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { schema as s, withTenant, type DbHandle } from '@madar/db';
import {
  addDays,
  calendarDateIn,
  calendarDateOfJalali,
  DEFAULT_WORK_CALENDAR,
  type SystemRole,
} from '@madar/shared';
import { eq } from 'drizzle-orm';

import { AppModule } from '../app.module.js';
import { AccountsService } from '../auth/accounts.service.js';
import { TenantContextService } from '../auth/tenant-context.service.js';
import type { TenantContext } from '../common/context.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DB_HANDLE } from '../database/tokens.js';
import { DepartmentsService } from '../departments/departments.service.js';
import { GoalsService } from '../goals/goals.service.js';
import { KeyResultsService } from '../goals/key-results.service.js';
import { MembersService } from '../members/members.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { ProjectsService } from '../work/projects.service.js';
import { TasksService } from '../work/tasks.service.js';
import { TodayService } from '../work/today.service.js';
import { SEED_COMPANY, SEED_DEPARTMENTS, SEED_PEOPLE } from './seed-data.js';
import { SEED_GOALS, SEED_PROJECT_LINKS, SEED_TASK_LINKS } from './seed-goals.js';
import { SEED_HISTORY, SEED_PROJECTS, SEED_TASKS } from './seed-work.js';

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
    const taskRefs = new Map<string, { id: string; version: number; by: string }>();
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
      taskRefs.set(item.title, { id: task.id, version: task.version, by: item.by });
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

    // History for the «done per week» trend: routine tasks finished over the past seven weeks.
    for (const [d, dept] of SEED_HISTORY.entries()) {
      const reporter = await as(dept.by);
      for (let week = 1; week <= 7; week++) {
        // A gently rising, slightly uneven curve (deterministic).
        const count = 2 + ((week * 3 + d) % 4) + (7 - week);
        for (let i = 0; i < count; i++) {
          const assignee = dept.people[(i + week) % dept.people.length] ?? dept.by;
          const created = await tasks.create(reporter, {
            title: dept.titles[(i + week) % dept.titles.length] ?? '',
            assigneeId: idOf(assignee),
            statusKey: 'done',
          });
          taskCount++;
          const finished = new Date(Date.now() - (week * 7 - (i % 5)) * 24 * 60 * 60_000);
          await withTenant(handle.db, { tenantId }, (tx) =>
            tx
              .update(s.tasks)
              .set({ completedAt: finished, createdAt: finished, updatedAt: finished })
              .where(eq(s.tasks.id, created.id)),
          );
        }
      }
    }

    // Goals: the current season, each goal created by its owner, with check-in history.
    const goalsService = app.get(GoalsService);
    const keyResults = app.get(KeyResultsService);
    const period = (await goalsService.periods(ctx)).find((p) => p.current);
    if (!period) throw new Error('current goal period missing');
    const goalIds = new Map<string, string>();
    const krIds = new Map<string, string>();
    for (const g of SEED_GOALS) {
      const goal = await goalsService.create(await as(g.owner), {
        periodId: period.id,
        level: g.level,
        departmentId: g.department ? departmentIds.get(g.department) : undefined,
        parentId: g.parent ? goalIds.get(g.parent) : null,
        title: g.title,
        keyResults: g.keyResults.map((kr) => ({
          title: kr.title,
          kind: kr.kind,
          startValue: kr.start,
          targetValue: kr.target,
          unit: kr.unit ?? null,
          weight: kr.weight,
        })),
      });
      goalIds.set(g.key, goal.id);
      g.keyResults.forEach((kr, i) => {
        const id = goal.keyResults[i]?.id;
        if (id) krIds.set(kr.key, id);
      });
    }
    for (const g of SEED_GOALS) {
      for (const kr of g.keyResults) {
        const id = krIds.get(kr.key);
        const history = kr.checkins ?? [];
        const last = history.at(-1);
        if (!id || !last) continue;
        // Earlier check-ins are back-dated history; the latest goes through the service.
        await withTenant(handle.db, { tenantId }, async (tx) => {
          for (const c of history.slice(0, -1)) {
            await tx.insert(s.keyResultCheckins).values({
              keyResultId: id,
              value: c.value,
              status: c.status,
              note: c.note ?? null,
              authorId: idOf(g.owner),
              createdAt: new Date(Date.now() - c.daysAgo * 24 * 60 * 60_000),
            });
          }
        });
        await keyResults.checkIn(await as(g.owner), id, {
          value: last.value,
          status: last.status,
          note: last.note ?? null,
        });
      }
    }
    for (const [title, krKey] of Object.entries(SEED_TASK_LINKS)) {
      const task = taskRefs.get(title);
      const keyResultId = krIds.get(krKey);
      if (!task || !keyResultId) continue;
      await tasks
        .update(await as(task.by), task.id, { version: task.version, keyResultId })
        .catch((error: unknown) => logger.warn(`link «${title}»: ${String(error)}`));
    }
    for (const [projectKey, krKey] of Object.entries(SEED_PROJECT_LINKS)) {
      const project = SEED_PROJECTS.find((p) => p.key === projectKey);
      const projectId = projectIds.get(projectKey);
      const keyResultId = krIds.get(krKey);
      if (!project || !projectId || !keyResultId) continue;
      await projects
        .update(await as(project.owner), projectId, { keyResultId })
        .catch((error: unknown) => logger.warn(`link project ${projectKey}: ${String(error)}`));
    }

    // Work calendar (docs/pilot-assumptions.md §2): Thursday half day, fixed solar holidays.
    // Lunar holidays move every year; the owner adds them in «ساعت کاری».
    const solarHolidays = [
      { jy: 1405, jm: 11, jd: 22 },
      { jy: 1405, jm: 12, jd: 29 },
      { jy: 1406, jm: 1, jd: 1 },
      { jy: 1406, jm: 1, jd: 2 },
      { jy: 1406, jm: 1, jd: 3 },
      { jy: 1406, jm: 1, jd: 4 },
      { jy: 1406, jm: 1, jd: 12 },
      { jy: 1406, jm: 1, jd: 13 },
    ].map(calendarDateOfJalali);
    await app.get(NotificationsService).setWorkCalendar(ctx, {
      ...DEFAULT_WORK_CALENDAR,
      holidays: solarHolidays,
    });

    const count = await withTenant(
      handle.db,
      { tenantId },
      async (tx) => (await tx.select({ id: s.members.id }).from(s.members)).length,
    );
    say(
      `Seeded "${SEED_COMPANY.name}" (${SEED_COMPANY.slug}): ${SEED_DEPARTMENTS.length} departments, ${count} members, ${SEED_PROJECTS.length} projects, ${taskCount} tasks, ${SEED_GOALS.length} goals.`,
    );
    say(
      `Sign in as any seeded username (e.g. ${owner.username}, maryam.ahmadi, ali.rezaei) with SEED_PASSWORD.`,
    );
    say('Owner and admin accounts are asked to set up two-factor authentication at first sign-in.');
    say('Notifications appear once the worker runs (pnpm dev starts it).');
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  logger.error(error);
  process.exit(1);
});
