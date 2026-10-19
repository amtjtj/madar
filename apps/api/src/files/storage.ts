import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, copyFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import type { Env } from '../config/env.js';

/**
 * Where attachment bytes live (ADR 0019). Keys are built by the server only
 * (`objectKeyFor`), always under `tenants/{tenantId}/`; a user-supplied name never reaches a path.
 */
export interface FileStorage {
  /** Stores a finished temporary file under `key` (the temp file may be moved). */
  put(key: string, tempPath: string, size: number, mime: string): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export const FILE_STORAGE = Symbol('FILE_STORAGE');

const KEY = /^tenants\/[0-9a-f-]{36}\/\d{4}\/\d{2}\/[0-9a-f-]{36}$/;

export function objectKeyFor(tenantId: string, id: string, now = new Date()): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `tenants/${tenantId}/${now.getUTCFullYear()}/${month}/${id}`;
}

function assertKey(key: string): void {
  if (!KEY.test(key)) throw new Error(`Refusing an unexpected storage key: ${key}`);
}

/** Files on the server's disk (a Docker volume in production). */
export class LocalStorage implements FileStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    assertKey(key);
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) throw new Error('Path escapes the storage folder');
    return path;
  }

  async put(key: string, tempPath: string): Promise<void> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o750 });
    try {
      await rename(tempPath, path);
    } catch {
      // Another file system (temp folder elsewhere): copy, then drop the temp file.
      await copyFile(tempPath, path);
      await rm(tempPath, { force: true });
    }
  }

  async get(key: string): Promise<Readable> {
    const path = this.path(key);
    await stat(path);
    return createReadStream(path);
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    return stat(this.path(key)).then(
      () => true,
      () => false,
    );
  }
}

/** An S3-compatible service (an Iranian cloud storage, or MinIO). */
export class S3Storage implements FileStorage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async put(key: string, tempPath: string, size: number, mime: string): Promise<void> {
    assertKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(tempPath),
        ContentLength: size,
        ContentType: mime,
      }),
    );
    await rm(tempPath, { force: true });
  }

  async get(key: string): Promise<Readable> {
    assertKey(key);
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return out.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    assertKey(key);
    return this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })).then(
      () => true,
      () => false,
    );
  }
}

export function defaultStorageDir(): string {
  return resolve(import.meta.dirname, '../../../../.data/files');
}

export function createStorage(env: Env): FileStorage {
  if (env.STORAGE_DRIVER === 's3') {
    const client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    });
    return new S3Storage(client, env.S3_BUCKET);
  }
  return new LocalStorage(env.STORAGE_DIR || defaultStorageDir());
}

/** Writes a stream to a path (used by uploads before the file is checked and stored). */
export function writeStream(path: string) {
  return createWriteStream(path, { mode: 0o640 });
}
