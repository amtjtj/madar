import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { LocalStorage, objectKeyFor } from './storage.js';

describe('file storage', () => {
  it('builds keys under the company prefix', () => {
    const tenant = randomUUID();
    const id = randomUUID();
    expect(objectKeyFor(tenant, id, new Date('2026-10-19T10:00:00Z'))).toBe(
      `tenants/${tenant}/2026/10/${id}`,
    );
  });

  it('stores, reads and deletes on disk, refusing keys it did not build', async () => {
    const root = await mkdtemp(join(tmpdir(), 'madar-files-'));
    const storage = new LocalStorage(root);
    const key = objectKeyFor(randomUUID(), randomUUID());
    const temp = join(root, 'upload.tmp');
    await writeFile(temp, 'سلام');
    await storage.put(key, temp);
    expect(await storage.exists(key)).toBe(true);
    const chunks: Buffer[] = [];
    for await (const chunk of await storage.get(key)) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('سلام');
    await storage.delete(key);
    expect(await storage.exists(key)).toBe(false);

    for (const bad of ['../../etc/passwd', `tenants/${randomUUID()}/../../x`, 'a/b']) {
      await expect(storage.get(bad)).rejects.toThrow(/unexpected storage key/);
    }
    await expect(readFile(join(root, '..', 'passwd'))).rejects.toThrow();
  });
});
