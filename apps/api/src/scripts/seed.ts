/**
 * Seeds the demo company through the real services (same validation, permissions and audit log
 * as the app). Development only. Usage: pnpm db:seed
 */
import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { schema as s, uuidv7, withTenant, type DbHandle } from '@madar/db';
import {
  addDays,
  calendarDateIn,
  calendarDateOfJalali,
  DEFAULT_WORK_CALENDAR,
  fileTypeFor,
  mentionToken,
  weekStartOf,
  weeklyReport,
  persianWeekdayOfCalendarDate,
  zonedInstant,
  type SaveLetterRequest,
  type SystemRole,
} from '@madar/shared';
import { eq, sql } from 'drizzle-orm';

import { AppModule } from '../app.module.js';
import { AccountsService } from '../auth/accounts.service.js';
import { AttachmentsService } from '../files/attachments.service.js';
import { ChatService } from '../chat/chat.service.js';
import { MeetingsService } from '../meetings/meetings.service.js';
import { RequestsService } from '../requests/requests.service.js';
import { EvidenceService } from '../evidence/evidence.service.js';
import { LettersService } from '../letters/letters.service.js';
import { FILE_STORAGE, objectKeyFor, type FileStorage } from '../files/storage.js';
import { TenantContextService } from '../auth/tenant-context.service.js';
import type { TenantContext } from '../common/context.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DB_HANDLE } from '../database/tokens.js';
import { DepartmentsService } from '../departments/departments.service.js';
import { GoalsService } from '../goals/goals.service.js';
import { KeyResultsService } from '../goals/key-results.service.js';
import { MembersService } from '../members/members.service.js';
import { buildWeeklyReport } from '../reports/builder.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { ProjectsService } from '../work/projects.service.js';
import { TasksService } from '../work/tasks.service.js';
import { TodayService } from '../work/today.service.js';
import { SEED_COMPANY, SEED_DEPARTMENTS, SEED_PEOPLE, seedSummary } from './seed-data.js';
import { samplePdf, samplePng } from './seed-files.js';
import { SEED_GOALS, SEED_PROJECT_LINKS, SEED_TASK_LINKS } from './seed-goals.js';
import { SEED_HISTORY, SEED_PROJECTS, SEED_TASKS } from './seed-work.js';

import { demoMode } from './demo.js';
import { seedGamification } from './seed-gamification.js';

const logger = new Logger('Seed');
/** Summary lines go straight to stdout (the Nest logger is limited to warnings while seeding). */
const say = (line: string) => process.stdout.write(`${line}\n`);

async function main(): Promise<void> {
  // A production database is only ever seeded on the demo server (plan phase-1-step-9 §5).
  if (process.env.NODE_ENV === 'production' && !demoMode(process.env)) {
    throw new Error('Refusing to seed a production database (set DEMO_MODE=true on a demo server)');
  }
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
            deptRole: person.head ? 'head' : person.deptManager ? 'manager' : 'member',
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
      if (p.observers?.length) {
        await projects.setMembers(await as(p.owner), project.id, {
          members: [
            ...project.members.map((m) => ({ memberId: m.id, role: m.role })),
            ...p.observers.map((o) => ({ memberId: idOf(o), role: 'observer' as const })),
          ],
        });
      }
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
        ...(item.type && { typeKey: item.type, customFields: item.fields ?? {} }),
      });
      taskCount++;
      for (const [i, title] of (item.subtasks ?? []).entries()) {
        const sub = await tasks.create(reporter, {
          title,
          parentId: task.id,
          departmentId: task.department.id,
          projectId: task.project?.id ?? null,
          assigneeId: task.assignee?.id ?? null,
        });
        taskCount++;
        const value = item.subtaskProgress?.[i];
        if (value === 100) {
          await tasks.update(reporter, sub.id, { statusKey: 'done', version: sub.version });
        } else if (value) {
          await tasks.setProgress(reporter, sub.id, { value, version: sub.version });
        }
      }
      // Progress recorded by the assignee, with the notes their manager sees (ADR 0018).
      let version = (await tasks.get(reporter, task.id)).version;
      for (const step of item.progress ?? []) {
        const actor = await as(item.assignee ?? item.by);
        version = (await tasks.setProgress(actor, task.id, { ...step, version })).version;
      }
      taskRefs.set(item.title, { id: task.id, version, by: item.by });
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

    // Goals: the current season with check-in history. A person's own goal is defined by their
    // manager (ADR 0027); the owner only checks in.
    const goalsService = app.get(GoalsService);
    const keyResults = app.get(KeyResultsService);
    const period = (await goalsService.periods(ctx)).find((p) => p.current);
    if (!period) throw new Error('current goal period missing');
    const goalIds = new Map<string, string>();
    const krIds = new Map<string, string>();
    for (const g of SEED_GOALS) {
      const definer =
        g.level === 'individual'
          ? (SEED_PEOPLE.find((p) => p.username === g.owner)?.manager ?? g.owner)
          : g.owner;
      const goal = await goalsService.create(await as(definer), {
        periodId: period.id,
        ownerId: idOf(g.owner),
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
    // Files (ADR 0019): a PDF and a chart image on the CEO's report, a screenshot in a comment.
    const storage = app.get<FileStorage>(FILE_STORAGE);
    const attachments = app.get(AttachmentsService);
    const stage = async (by: string, fileName: string, bytes: Buffer) => {
      const type = fileTypeFor(fileName, bytes);
      if (!type) throw new Error(`seed file ${fileName} is not allowed`);
      const id = uuidv7();
      const objectKey = objectKeyFor(tenantId, id);
      const temp = join(tmpdir(), `madar-seed-${id}`);
      await writeFile(temp, bytes);
      await storage.put(objectKey, temp, bytes.length, type.mime);
      await withTenant(handle.db, { tenantId }, (tx) =>
        tx.insert(s.attachments).values({
          id,
          uploadedBy: idOf(by),
          fileName,
          extension: type.extension,
          mime: type.mime,
          size: bytes.length,
          checksum: createHash('sha256').update(bytes).digest('hex'),
          objectKey,
        }),
      );
      return id;
    };
    const report = taskRefs.get('گزارش رضایت مشتریان برای جلسه هیئت‌مدیره');
    if (report) {
      const ids = [
        await stage(
          'ali.rezaei',
          'پیش‌نویس گزارش رضایت.pdf',
          samplePdf('Customer satisfaction - draft'),
        ),
        await stage('ali.rezaei', 'نمودار رضایت مهر.png', samplePng()),
      ];
      await attachments.attachToTask(await as('ali.rezaei'), report.id, ids);
      report.version = (await tasks.get(await as('ali.rezaei'), report.id)).version;
    }
    const queue = taskRefs.get('پاسخ به تیکت‌های معوق صف طلا');
    if (queue) {
      const screenshot = await stage('ali.rezaei', 'اسکرین‌شات صف.png', samplePng(240, 160));
      await tasks.addComment(await as('ali.rezaei'), queue.id, {
        body: 'وضعیت صف بعد از پاسخ‌های امروز.',
        attachmentIds: [screenshot],
      });
    }

    // Letters (ADR 0020): a thread with a referral and a reply, a confidential letter, a draft.
    const letters = app.get(LettersService);
    const text = (...lines: string[]) => ({ format: 'lite' as const, text: lines.join('\n') });
    const sendAs = async (
      by: string,
      input: Omit<SaveLetterRequest, 'cc' | 'uploadIds' | 'urgency' | 'confidential'> &
        Partial<SaveLetterRequest>,
    ) => {
      const ctxOf = await as(by);
      const draft = await letters.create(ctxOf, {
        cc: [],
        uploadIds: [],
        urgency: 'normal',
        confidential: false,
        ...input,
      });
      return letters.send(ctxOf, draft.id);
    };
    const limits = await sendAs('ali.rezaei', {
      subject: 'درخواست افزایش سقف برداشت روزانه طلا برای مشتریان ویژه',
      body: text(
        'سلام خانم صادقی،',
        '',
        'در یک ماه گذشته **۴۸ تیکت** درباره سقف برداشت روزانه از مشتریان ویژه داشته‌ایم. پیشنهاد تیم پشتیبانی:',
        '',
        '- سقف برداشت روزانه برای سطح طلایی از ۵۰ به ۱۰۰ گرم برسد',
        '- برداشت بالای سقف با تایید دو مرحله‌ای انجام شود',
        '- گزارش هفتگی برداشت‌های بزرگ برای واحد ریسک ارسال شود',
        '',
        'گزارش کامل تیکت‌ها پیوست است.',
      ),
      to: [idOf('leila.sadeghi')],
      cc: [idOf('maryam.ahmadi')],
      urgency: 'urgent',
      uploadIds: [
        await stage(
          'ali.rezaei',
          'گزارش تیکت‌های سقف برداشت.pdf',
          samplePdf('Withdrawal limit tickets'),
        ),
      ],
    });
    await letters.get(await as('leila.sadeghi'), limits.id);
    await letters.refer(await as('leila.sadeghi'), limits.id, {
      memberIds: [idOf('amir.hosseini')],
      note: 'لطفاً امکان فنی و زمان پیاده‌سازی را بررسی کنید و تا شنبه نظر بدهید.',
    });
    await letters.get(await as('amir.hosseini'), limits.id);
    await sendAs('amir.hosseini', {
      subject: 'پاسخ: درخواست افزایش سقف برداشت روزانه طلا برای مشتریان ویژه',
      body: text(
        'سلام،',
        '',
        'تغییر سقف در تنظیمات سامانه **کمتر از یک روز** کار دارد. تایید دو مرحله‌ای حدود دو هفته زمان می‌برد و در اسپرینت بعد جا می‌شود.',
      ),
      to: [idOf('ali.rezaei')],
      cc: [idOf('leila.sadeghi')],
      replyToId: limits.id,
    });
    await sendAs('fatemeh.najafi', {
      subject: 'پیشنهاد بازنگری حقوق کارشناسان پشتیبانی',
      body: text(
        'آقای کریمی،',
        '',
        'بر اساس بررسی بازار، پیشنهاد بازنگری حقوق کارشناسان پشتیبانی از ابتدای دی ماه پیوست است. لطفاً پیش از جلسه هیئت‌مدیره ملاحظه فرمایید.',
      ),
      to: [idOf('reza.karimi')],
      confidential: true,
    });
    await sendAs('elham.akbari', {
      subject: 'هماهنگی کمپین یلدا با تیم پشتیبانی',
      body: text(
        'سلام مریم جان،',
        '',
        'کمپین یلدا از ۲۵ آذر شروع می‌شود. برای پاسخ‌گویی به سوال‌های پرتکرار، یک جلسه کوتاه با تیم پشتیبانی لازم داریم:',
        '',
        '- معرفی کد تخفیف و شرایط آن',
        '- سوال‌های پرتکرار و پاسخ آماده',
      ),
      to: [idOf('maryam.ahmadi')],
      cc: [idOf('ali.rezaei')],
    });
    await sendAs('kian.nouri', {
      subject: 'انتشار نسخه ۲٫۳ اپ: تغییرات صفحه برداشت',
      body: text(
        'نسخه ۲٫۳ اپ **امشب ساعت ۲۳** منتشر می‌شود و صفحه برداشت تغییر می‌کند. لطفاً تیم پشتیبانی راهنمای تازه را پیش از شیفت صبح ببیند.',
      ),
      to: [idOf('maryam.ahmadi'), idOf('ali.rezaei')],
      urgency: 'immediate',
    });
    await letters.create(await as('ali.rezaei'), {
      subject: 'گزارش ماهانه صف تیکت‌ها',
      body: text('سلام،', '', '- میانگین زمان پاسخ:', '- تیکت‌های باز:'),
      to: [idOf('maryam.ahmadi')],
      cc: [],
      uploadIds: [],
      urgency: 'normal',
      confidential: false,
    });

    // «شاهد کار» (ADR 0021): the withdrawal-limit letter backs Ali's ticket queue task.
    if (queue) {
      await app
        .get(EvidenceService)
        .pin(await as('ali.rezaei'), queue.id, { kind: 'letter', subjectId: limits.id })
        .catch((error: unknown) => logger.warn(`pin evidence: ${String(error)}`));
    }

    // Chat (ADR 0022): the support channel, a project channel, a direct conversation, a group.
    const chat = app.get(ChatService);
    const post = async (by: string, conversationId: string, body: string, replyToId?: string) =>
      chat.send(await as(by), conversationId, {
        body,
        replyToId: replyToId ?? null,
        uploadIds: [],
      });
    const supportChannel = await chat.forSource(
      await as('maryam.ahmadi'),
      'department',
      departmentIds.get('support') ?? '',
    );
    const shift = await post(
      'maryam.ahmadi',
      supportChannel.id,
      'صبح بخیر تیم. امروز به‌خاطر نوسان قیمت طلا حجم تیکت‌ها بالاست؛ اولویت با تیکت‌های برداشت است.',
    );
    await post('ali.rezaei', supportChannel.id, 'چشم. صف برداشت را من برمی‌دارم.', shift.id);
    await post('zahra.mohammadi', supportChannel.id, 'من هم تیکت‌های احراز هویت را جواب می‌دهم.');
    const kycChannel = await chat.forSource(
      await as('amir.hosseini'),
      'project',
      projectIds.get('kyc') ?? '',
    );
    await post(
      'amir.hosseini',
      kycChannel.id,
      'نسخه آزمایشی مسیر جدید احراز هویت روی سرور تست است: https://staging.example.ir/kyc',
    );
    const tryIt = await post(
      'maryam.ahmadi',
      kycChannel.id,
      'عالی. امروز با دو کاربر واقعی امتحانش می‌کنیم.',
    );
    // Files, a mention and reactions (plan phase-2-step-15b).
    const shot = await chat.send(await as('amir.hosseini'), kycChannel.id, {
      body: `${mentionToken(idOf('maryam.ahmadi'))} خطای صفحه بارگذاری مدرک روی گوشی؛ گزارش آزمون هم پیوست است.`,
      replyToId: null,
      uploadIds: [
        await stage('amir.hosseini', 'خطای بارگذاری مدرک.png', samplePng(360, 640)),
        await stage('amir.hosseini', 'گزارش آزمون احراز هویت.pdf', samplePdf('KYC test report')),
      ],
    });
    const reactAs = async (by: string, messageId: string, emoji: '👍' | '👀' | '🎉') =>
      chat.react(await as(by), messageId, { emoji, active: true });
    await reactAs('maryam.ahmadi', tryIt.id, '👍');
    await reactAs('amir.hosseini', tryIt.id, '🎉');
    await reactAs('maryam.ahmadi', shot.id, '👀');
    // A task made from that message, with the message pinned as evidence (plan 15c).
    await app
      .get(EvidenceService)
      .createFromMessage(await as('maryam.ahmadi'), shot.id, {
        title: 'رفع خطای بارگذاری مدرک روی گوشی',
        assigneeId: idOf('amir.hosseini'),
        projectId: projectIds.get('kyc') ?? null,
      })
      .catch((error: unknown) => logger.warn(`task from message: ${String(error)}`));
    await reactAs('ali.rezaei', shift.id, '👍');
    await reactAs('zahra.mohammadi', shift.id, '👍');
    const dm = await chat.direct(await as('maryam.ahmadi'), idOf('ali.rezaei'));
    await post('maryam.ahmadi', dm.id, 'علی جان، گزارش تیکت‌های دیروز را تا ظهر می‌فرستی؟');
    const group = await chat.createGroup(await as('maryam.ahmadi'), {
      title: 'شیفت صبح',
      memberIds: [idOf('ali.rezaei'), idOf('zahra.mohammadi'), idOf('hossein.yousefi')],
    });
    await post('hossein.yousefi', group.id, 'من فردا ده دقیقه دیرتر می‌رسم.');

    // Meetings (plan phase-2-step-13a): today's, tomorrow's one-on-one, a past OKR review with
    // minutes and a decision already turned into a task, and a canceled one.
    const meetings = app.get(MeetingsService);
    const slot = (day: string, start: string, end: string) => ({
      startsAt: zonedInstant(day, start, 'Asia/Tehran').toISOString(),
      endsAt: zonedInstant(day, end, 'Asia/Tehran').toISOString(),
    });
    const supportTeam = ['ali.rezaei', 'zahra.mohammadi', 'hossein.yousefi'].map(idOf);
    await meetings.create(await as('maryam.ahmadi'), {
      type: 'regular',
      title: 'بررسی صف برداشت',
      ...slot(today, '14:00', '15:00'),
      location: 'اتاق جلسه طبقه دوم',
      agenda: '- صف برداشت‌های معطل امروز\n- **تاخیرهای بیش از ۲ ساعت**\n- هماهنگی با مالی',
      participantIds: supportTeam,
    });
    await meetings.create(await as('maryam.ahmadi'), {
      type: 'one_on_one',
      title: 'گفت‌وگوی ماهانه',
      ...slot(addDays(today, 1), '10:00', '10:30'),
      participantIds: [idOf('ali.rezaei')],
    });
    const review = await meetings.create(await as('maryam.ahmadi'), {
      type: 'okr_review',
      title: 'بررسی OKR پشتیبانی',
      ...slot(addDays(today, -2), '10:00', '11:00'),
      link: 'https://meet.zarrinmadar.ir/support-okr',
      agenda: '- زمان پاسخ اول\n- تیکت‌های باز قدیمی',
      participantIds: supportTeam,
    });
    await meetings.saveMinutes(await as('zahra.mohammadi'), review.id, {
      body: 'زمان پاسخ اول این هفته به **۳ ساعت** رسید؛ هدف زیر ۲ ساعت است.\n\n- شیفت عصر یک نفر کم دارد\n- پاسخ‌های آماده برای پرتکرارها به‌روز شود',
      version: 0,
    });
    let reviewMeeting = await meetings.addDecision(await as('maryam.ahmadi'), review.id, {
      text: 'پاسخ‌های آماده برای ۲۰ سوال پرتکرار به‌روز شود',
    });
    reviewMeeting = await meetings.addDecision(await as('maryam.ahmadi'), review.id, {
      text: 'برای شیفت عصر یک نیروی پاره‌وقت درخواست شود',
    });
    const firstDecision = reviewMeeting.decisions[0];
    if (firstDecision) {
      const decisionTask = await meetings.convertDecision(
        await as('maryam.ahmadi'),
        review.id,
        firstDecision.id,
        {
          title: 'به‌روزرسانی پاسخ‌های آماده پرتکرار',
          assigneeId: idOf('ali.rezaei'),
          dueOn: addDays(today, 5),
          keyResultId: krIds.get('response') ?? null,
        },
      );
      // The review's minutes back the task they decided (plan phase-2-step-13b).
      await app.get(EvidenceService).pin(await as('maryam.ahmadi'), decisionTask.id, {
        kind: 'minutes',
        subjectId: review.id,
      });
    }
    const sync = await meetings.create(await as('maryam.ahmadi'), {
      type: 'regular',
      title: 'هماهنگی با فنی درباره خطای KYC',
      ...slot(addDays(today, 2), '11:00', '11:30'),
      participantIds: [idOf('amir.hosseini'), idOf('ali.rezaei')],
    });
    await meetings.cancel(await as('maryam.ahmadi'), sync.id);
    // A weekly meeting every Saturday at 9, with replies to the first one.
    const nextSaturday = addDays(today, (7 - persianWeekdayOfCalendarDate(today)) % 7 || 7);
    const weekly = await meetings.create(await as('maryam.ahmadi'), {
      type: 'regular',
      title: 'هماهنگی هفتگی پشتیبانی',
      ...slot(nextSaturday, '09:00', '09:30'),
      location: 'اتاق جلسه طبقه دوم',
      agenda: '- مرور تیکت‌های هفته\n- تاخیرهای برداشت\n- برنامه شیفت‌ها',
      participantIds: supportTeam,
      repeat: {},
    });
    await meetings.respond(await as('ali.rezaei'), weekly.id, 'accepted');
    await meetings.respond(await as('zahra.mohammadi'), weekly.id, 'accepted');
    await meetings.respond(await as('hossein.yousefi'), weekly.id, 'declined');

    // Requests (plan phase-3-step-17b): Ali's approved leave next week, Zahra's headset waiting
    // on the CEO after Maryam, Hossein's shift change waiting on Maryam, one turned down.
    const requests = app.get(RequestsService);
    let leaveDay = addDays(today, 7);
    while (persianWeekdayOfCalendarDate(leaveDay) !== 0) leaveDay = addDays(leaveDay, 1);
    const leave = await requests.create(await as('ali.rezaei'), {
      kind: 'leave',
      data: {
        kind: 'daily',
        startsOn: leaveDay,
        endsOn: addDays(leaveDay, 1),
        note: 'سفر خانوادگی',
      },
    });
    await requests.decide(await as('maryam.ahmadi'), leave.id, {
      decision: 'approved',
      comment: 'خوش بگذرد؛ زهرا تیکت‌های فوری را پوشش می‌دهد.',
    });
    const headset = await requests.create(await as('zahra.mohammadi'), {
      kind: 'expense',
      data: {
        amountToman: 18_000_000,
        category: 'equipment',
        description: 'هدست بی‌سیم برای شیفت شب پشتیبانی',
      },
      uploadIds: [],
    });
    await requests.decide(await as('maryam.ahmadi'), headset.id, {
      decision: 'approved',
      comment: '',
    });
    await requests.create(await as('hossein.yousefi'), {
      kind: 'general',
      title: 'جابه‌جایی شیفت پنجشنبه',
      data: { body: 'پنجشنبه آینده شیفت صبح را با زهرا عوض کنیم؟' },
      uploadIds: [],
    });
    const course = await requests.create(await as('ali.rezaei'), {
      kind: 'expense',
      data: {
        amountToman: 4_500_000,
        category: 'training',
        description: 'دوره آنلاین مدیریت تیکت',
      },
      uploadIds: [],
    });
    await requests.decide(await as('maryam.ahmadi'), course.id, {
      decision: 'rejected',
      comment: 'همین دوره را منابع انسانی ماه بعد برای همه برگزار می‌کند.',
    });

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

    // The assistant is on for the demo company (each company turns it on itself).
    await withTenant(handle.db, { tenantId }, (tx) =>
      tx
        .update(s.tenants)
        .set({ settings: sql`${s.tenants.settings} || '{"ai":{"enabled":true}}'::jsonb` })
        .where(eq(s.tenants.id, tenantId)),
    );

    // XP from the finished work and three weeks of streaks (ADR 0029).
    await seedGamification(handle, tenantId);

    // Weekly reports for the last three finished weeks, as the worker would have stored them.
    const thisWeek = weekStartOf(today);
    const reportDepartments = SEED_DEPARTMENTS.map((d) => ({
      id: departmentIds.get(d.key) ?? '',
      name: d.name,
    }));
    // The demo company has existed for months: its departments predate the reported weeks.
    await withTenant(handle.db, { tenantId }, (tx) =>
      tx
        .update(s.departments)
        .set({ createdAt: zonedInstant(addDays(thisWeek, -7 * 9), '09:00', 'Asia/Tehran') }),
    );
    for (let back = 3; back >= 1; back--) {
      const weekStart = addDays(thisWeek, -7 * back);
      const builtAt = zonedInstant(addDays(weekStart, 7), '09:30', 'Asia/Tehran');
      await withTenant(handle.db, { tenantId }, async (tx) => {
        for (const department of [null, ...reportDepartments]) {
          const data = weeklyReport.parse(
            await buildWeeklyReport(tx, {
              tenantId,
              scope: department ? 'department' : 'company',
              department,
              weekStart,
              now: builtAt,
            }),
          );
          const [stored] = await tx
            .insert(s.weeklyReports)
            .values({
              scope: data.scope,
              departmentId: department?.id ?? null,
              weekStart,
              data: data as unknown as Record<string, unknown>,
              createdAt: builtAt,
            })
            .returning({ id: s.weeklyReports.id });
          // What the assistant would have written (ADR 0025), so the demo shows the card.
          if (stored) {
            await tx.insert(s.reportSummaries).values({
              reportId: stored.id,
              text: seedSummary(data),
              model: 'seed',
              createdAt: builtAt,
            });
          }
        }
      });
    }

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
