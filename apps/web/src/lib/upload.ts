import { FILE_TYPES, extensionOf, type Attachment, type Upload } from '@madar/shared';

import { ApiClientError } from './api';

/**
 * Uploads one file with progress (fetch has no upload progress, so this uses XHR). Resolves with
 * the fresh upload; attach it afterwards to a task or a comment (ADR 0019).
 */
export function uploadFile(
  file: File,
  onProgress: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<Upload> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/uploads');
    xhr.withCredentials = true;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      let body: { error?: { code?: string } } | Upload | null = null;
      try {
        body = JSON.parse(xhr.responseText) as typeof body;
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && body) resolve(body as Upload);
      else {
        const code =
          (body as { error?: { code?: string } } | null)?.error?.code ??
          (xhr.status === 413 ? 'file_too_large' : undefined);
        reject(new ApiClientError(xhr.status, code));
      }
    };
    xhr.onerror = () => reject(new ApiClientError(0, 'network'));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort());
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
}

export function fileUrl(attachment: Pick<Attachment, 'id'>, inline = false): string {
  return `/api/attachments/${attachment.id}/file${inline ? '?inline=1' : ''}`;
}

/** The `accept` list for file pickers: the same allowlist the API checks (ADR 0019). */
export const ACCEPT_FILES = Object.keys(FILE_TYPES)
  .map((extension) => `.${extension}`)
  .join(',');

/** A quick check before uploading (the API checks again, including the file's real bytes). */
export function precheckFile(file: File, maxSizeMb: number): 'tooLarge' | 'notAllowed' | null {
  if (!FILE_TYPES[extensionOf(file.name)]) return 'notAllowed';
  if (file.size > maxSizeMb * 1024 * 1024) return 'tooLarge';
  return null;
}
