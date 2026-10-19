import type { Attachment, Comment, Task, Upload } from '@madar/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, hasDatabase, memberSession, ownerSession, type Client } from './helpers.js';

interface Person {
  c: Client;
  memberId: string;
}

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

describe.skipIf(!hasDatabase)('attachments', () => {
  let app: NestExpressApplication;
  let owner: Client;
  let lead: Person;
  let ali: Person;
  let marketer: Person;
  let other: Client;
  let task: Task;

  const upload = async (c: Client, content: Buffer | string, name: string): Promise<Upload> => {
    const res = await c.upload('/api/uploads', content, name);
    if (res.status !== 201) throw new Error(`upload failed: ${res.status} ${res.text}`);
    return res.body;
  };

  beforeAll(async () => {
    let env;
    ({ app, env } = await createTestApp());
    owner = (await ownerSession(app, env)).c;
    const support = (await owner.post('/api/departments', { name: 'پشتیبانی' })).body;
    const marketing = (await owner.post('/api/departments', { name: 'مارکتینگ' })).body;
    const dept = (id: string, deptRole = 'member') => [
      { departmentId: id, deptRole, isPrimary: true },
    ];
    lead = await memberSession(app, env, owner, { departments: dept(support.id, 'manager') });
    ali = await memberSession(app, env, owner, { departments: dept(support.id) });
    marketer = await memberSession(app, env, owner, { departments: dept(marketing.id) });
    other = (await ownerSession(app, env)).c;
    task = (await lead.c.post('/api/tasks', { title: 'پیگیری قرارداد', assigneeId: ali.memberId }))
      .body;
  });
  afterAll(() => app?.close());

  it('uploads, attaches to a task and serves the file with safe headers', async () => {
    const file = await upload(ali.c, PDF, 'قرارداد "نهایی".pdf');
    expect(file).toMatchObject({ kind: 'pdf', mime: 'application/pdf', size: PDF.length });

    // Before it is attached, only its uploader sees it.
    expect((await lead.c.get(`/api/attachments/${file.id}/file`)).status).toBe(404);

    const attached = await ali.c.post(`/api/tasks/${task.id}/attachments`, {
      uploadIds: [file.id],
    });
    expect(attached.status).toBe(201);
    expect((attached.body as Attachment[]).map((a) => a.fileName)).toEqual(['قرارداد "نهایی".pdf']);

    const res = await lead.c.download(`/api/attachments/${file.id}/file?inline=1`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^inline; .*filename\*=UTF-8''/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toMatch(/sandbox/);
    expect(Buffer.compare(res.body as Buffer, PDF)).toBe(0);

    expect(((await lead.c.get(`/api/tasks/${task.id}`)).body as Task).attachmentCount).toBe(1);
    const history = (await lead.c.get(`/api/tasks/${task.id}/activity`)).body as Array<{
      verb: string;
    }>;
    expect(history.map((h) => h.verb)).toContain('attachments_added');

    // Attaching it again, or someone else's upload, is not found.
    expect(
      (await ali.c.post(`/api/tasks/${task.id}/attachments`, { uploadIds: [file.id] })).status,
    ).toBe(404);
    const mine = await upload(lead.c, PNG, 'screen.png');
    expect(
      (await ali.c.post(`/api/tasks/${task.id}/attachments`, { uploadIds: [mine.id] })).status,
    ).toBe(404);
  });

  it('refuses files that are too large or not what they claim to be', async () => {
    const big = Buffer.alloc(26 * 1024 * 1024, 0x20);
    const tooLarge = await ali.c.upload('/api/uploads', Buffer.concat([PDF, big]), 'big.pdf');
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.error.code).toBe('file_too_large');

    for (const [content, name] of [
      ['<html><script>alert(1)</script></html>', 'invoice.pdf'],
      ['<svg onload="alert(1)"/>', 'logo.svg'],
      ['MZ\x90\x00', 'setup.exe'],
    ] as const) {
      const res = await ali.c.upload('/api/uploads', content, name);
      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe('file_type_not_allowed');
    }

    // The owner raises the limit; the change is audited.
    expect((await ali.c.put('/api/settings/files', { maxSizeMb: 50 })).status).toBe(403);
    expect((await owner.put('/api/settings/files', { maxSizeMb: 50 })).status).toBe(200);
    expect((await ali.c.upload('/api/uploads', Buffer.concat([PDF, big]), 'big.pdf')).status).toBe(
      201,
    );
    await owner.put('/api/settings/files', { maxSizeMb: 25 });
  });

  it('carries files on comments, and only people who see the task open them', async () => {
    const image = await upload(ali.c, PNG, 'اسکرین.png');
    const comment = (
      await ali.c.post(`/api/tasks/${task.id}/comments`, {
        body: 'این نسخه اصلاح‌شده است',
        attachmentIds: [image.id],
      })
    ).body as Comment;
    expect(comment.attachments.map((a) => a.kind)).toEqual(['image']);
    const listed = (await lead.c.get(`/api/tasks/${task.id}/comments`)).body as Comment[];
    expect(listed.at(-1)?.attachments[0]?.id).toBe(image.id);
    const all = (await lead.c.get(`/api/tasks/${task.id}/attachments`)).body as Attachment[];
    expect(all.map((a) => a.id)).toContain(image.id);

    // Someone from another department (who cannot see the task) gets nothing.
    expect((await marketer.c.get(`/api/attachments/${image.id}/file`)).status).toBe(404);
    expect((await marketer.c.get(`/api/tasks/${task.id}/attachments`)).status).toBe(404);

    // Deleting the comment hides its files.
    await ali.c.delete(`/api/comments/${comment.id}`);
    expect((await lead.c.get(`/api/attachments/${image.id}/file`)).status).toBe(404);
  });

  it('lets the uploader or a manager delete, with an audit entry', async () => {
    const file = await upload(ali.c, PDF, 'پیش‌نویس.pdf');
    await ali.c.post(`/api/tasks/${task.id}/attachments`, { uploadIds: [file.id] });
    const another = await upload(lead.c, PNG, 'manager.png');
    await lead.c.post(`/api/tasks/${task.id}/attachments`, { uploadIds: [another.id] });

    // A colleague who sees the task but did not upload the file and cannot edit the task.
    expect((await marketer.c.delete(`/api/attachments/${file.id}`)).status).toBe(404);
    expect((await lead.c.delete(`/api/attachments/${file.id}`)).status).toBe(204);
    expect((await ali.c.get(`/api/attachments/${file.id}/file`)).status).toBe(404);
    const audit = (await owner.get('/api/audit-logs')).body as Array<{ action: string }>;
    expect(audit.map((a) => a.action)).toContain('attachment.deleted');
  });

  it('keeps companies apart', async () => {
    const file = await upload(ali.c, PDF, 'محرمانه.pdf');
    await ali.c.post(`/api/tasks/${task.id}/attachments`, { uploadIds: [file.id] });
    expect((await other.get(`/api/attachments/${file.id}/file`)).status).toBe(404);
    expect((await other.delete(`/api/attachments/${file.id}`)).status).toBe(404);
    expect((await other.get(`/api/tasks/${task.id}/attachments`)).status).toBe(404);
    // Their own upload cannot be attached to our task.
    const theirs = (await other.upload('/api/uploads', PDF, 'x.pdf')).body as Upload;
    expect(
      (await other.post(`/api/tasks/${task.id}/attachments`, { uploadIds: [theirs.id] })).status,
    ).toBe(404);
  });
});
