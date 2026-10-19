'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { t } from '@madar/i18n';
import {
  DEFAULT_MAX_FILE_MB,
  fileSizeParts,
  type Attachment,
  type FileSettings,
  type Upload,
} from '@madar/shared';
import { useToast } from '@madar/ui';

import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { precheckFile, uploadFile } from '@/lib/upload';

import { fileKeys, workKeys } from './keys';

export function useTaskAttachments(taskId: string) {
  return useQuery({
    queryKey: fileKeys.task(taskId),
    queryFn: () => api<Attachment[]>(`/api/tasks/${taskId}/attachments`),
  });
}

function refreshTask(client: ReturnType<typeof useQueryClient>, taskId: string) {
  void client.invalidateQueries({ queryKey: fileKeys.task(taskId) });
  void client.invalidateQueries({ queryKey: workKeys.task(taskId), exact: true });
  void client.invalidateQueries({ queryKey: workKeys.comments(taskId) });
  void client.invalidateQueries({ queryKey: workKeys.activity(taskId) });
  void client.invalidateQueries({ queryKey: workKeys.allTasks });
}

export function useAttachToTask(taskId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (uploadIds: string[]) =>
      api<Attachment[]>(`/api/tasks/${taskId}/attachments`, {
        method: 'POST',
        body: { uploadIds },
      }),
    onSuccess: (list) => {
      client.setQueryData(fileKeys.task(taskId), list);
      refreshTask(client, taskId);
    },
  });
}

/** Optimistic: the file leaves the list at once and comes back if the server refuses. */
export function useDeleteAttachment(taskId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<undefined>(`/api/attachments/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await client.cancelQueries({ queryKey: fileKeys.task(taskId) });
      const before = client.getQueryData<Attachment[]>(fileKeys.task(taskId));
      client.setQueryData<Attachment[]>(fileKeys.task(taskId), (list) =>
        list?.filter((a) => a.id !== id),
      );
      return { before };
    },
    onError: (_error, _id, context) => {
      client.setQueryData(fileKeys.task(taskId), context?.before);
    },
    onSettled: () => refreshTask(client, taskId),
  });
}

export function useFileSettings() {
  return useQuery({
    queryKey: fileKeys.settings,
    queryFn: () => api<FileSettings>('/api/settings/files'),
    staleTime: 5 * 60_000,
  });
}

export function useSaveFileSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: FileSettings) =>
      api<FileSettings>('/api/settings/files', { method: 'PUT', body }),
    onSuccess: (settings) => client.setQueryData(fileKeys.settings, settings),
  });
}

export interface PendingUpload {
  key: string;
  name: string;
  progress: number;
}

/**
 * Files on their way up, with progress and cancel. `upload` checks each file first (type, size),
 * sends the good ones in parallel and resolves with those that arrived.
 */
export function useUploads() {
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const { data: settings } = useFileSettings();
  const { toast } = useToast();
  const maxSizeMb = settings?.maxSizeMb ?? DEFAULT_MAX_FILE_MB;

  const upload = async (files: File[]): Promise<Upload[]> => {
    const size = fileSizeParts(maxSizeMb * 1024 * 1024);
    const limit = t(`ui.fileSize.${size.unit}`, { value: size.value });
    const accepted = files.filter((file) => {
      const problem = precheckFile(file, maxSizeMb);
      if (problem === 'tooLarge') {
        toast({ tone: 'error', title: t('work.files.tooLarge', { name: file.name, size: limit }) });
      }
      if (problem === 'notAllowed') {
        toast({ tone: 'error', title: t('work.files.notAllowed', { name: file.name }) });
      }
      return problem === null;
    });
    const results = await Promise.all(
      accepted.map(async (file, i) => {
        const key = `${Date.now()}-${i}-${file.name}`;
        const controller = new AbortController();
        controllers.current.set(key, controller);
        setPending((list) => [...list, { key, name: file.name, progress: 0 }]);
        try {
          return await uploadFile(
            file,
            (progress) =>
              setPending((list) => list.map((p) => (p.key === key ? { ...p, progress } : p))),
            controller.signal,
          );
        } catch (error) {
          if (!(error instanceof DOMException && error.name === 'AbortError')) {
            toast({ tone: 'error', title: errorMessage(error) });
          }
          return null;
        } finally {
          controllers.current.delete(key);
          setPending((list) => list.filter((p) => p.key !== key));
        }
      }),
    );
    return results.filter((u): u is Upload => u !== null);
  };

  const cancel = (key: string) => controllers.current.get(key)?.abort();
  return { pending, upload, cancel, maxSizeMb };
}
