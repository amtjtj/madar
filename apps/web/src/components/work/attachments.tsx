'use client';

import { Download, Paperclip, Trash2 } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';

import { t } from '@madar/i18n';
import { fileSizeParts, formatNumber, formatRelativeTime, type Attachment } from '@madar/shared';
import {
  Button,
  FileTile,
  ImageThumb,
  Modal,
  Skeleton,
  UploadProgress,
  cn,
  useToast,
} from '@madar/ui';

import {
  useAttachToTask,
  useDeleteAttachment,
  useTaskAttachments,
  useUploads,
  type PendingUpload,
} from '@/hooks/files';
import { errorMessage } from '@/lib/errors';
import { ACCEPT_FILES, fileUrl } from '@/lib/upload';

/**
 * «Attachments» on a task (ADR 0019): add files (picker, camera on phones, drag and drop on
 * desktop), images as thumbnails with a full-size view, other files to open or download.
 */
export function TaskAttachments({ taskId }: { taskId: string }) {
  const { data: attachments, isPending } = useTaskAttachments(taskId);
  const uploads = useUploads();
  const attach = useAttachToTask(taskId);
  const { toast } = useToast();
  const [dragging, setDragging] = useState(false);

  const add = async (files: File[]) => {
    const done = await uploads.upload(files);
    if (!done.length) return;
    attach.mutate(
      done.map((u) => u.id),
      {
        onSuccess: () =>
          toast({ tone: 'success', title: t('work.files.attached'), duration: 1500 }),
        onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
      },
    );
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void add([...event.dataTransfer.files]);
  };
  const size = fileSizeParts(uploads.maxSizeMb * 1024 * 1024);

  return (
    <section
      aria-labelledby="files-title"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
      className={cn(
        'relative flex flex-col gap-3 rounded-2xl transition-colors',
        dragging && 'bg-primary-soft outline-2 outline-dashed outline-primary',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="files-title" className="text-lg font-bold text-ink">
          {t('work.files.title')}
          {attachments?.length ? (
            <span className="ms-1.5 text-sm font-medium text-ink-subtle">
              ({formatNumber(attachments.length)})
            </span>
          ) : null}
        </h2>
        <FilePicker label={t('work.files.add')} onFiles={(files) => void add(files)} />
      </div>
      {dragging && (
        <p className="text-center text-sm font-semibold text-primary-ink">{t('work.files.drop')}</p>
      )}
      <PendingList pending={uploads.pending} onCancel={uploads.cancel} />
      {isPending ? (
        <Skeleton className="h-16 rounded-xl" />
      ) : attachments && attachments.length > 0 ? (
        <AttachmentList taskId={taskId} attachments={attachments} />
      ) : (
        uploads.pending.length === 0 && (
          <div className="rounded-xl border border-dashed border-line p-4 text-center">
            <p className="font-semibold text-ink-muted">{t('work.files.empty')}</p>
            <p className="mt-1 text-xs text-ink-subtle">
              {t('work.files.limit', {
                size: t(`ui.fileSize.${size.unit}`, { value: size.value }),
              })}
            </p>
          </div>
        )
      )}
    </section>
  );
}

/** A button that opens the system picker (camera, photos or files on phones). */
export function FilePicker({
  label,
  onFiles,
  iconOnly,
  disabled,
}: {
  label: string;
  onFiles: (files: File[]) => void;
  iconOnly?: boolean;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT_FILES}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
      {iconOnly ? (
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={() => input.current?.click()}
          className="grid size-10 place-items-center rounded-full text-ink-muted hover:bg-sunken hover:text-ink disabled:opacity-50 [&_svg]:size-5"
        >
          <Paperclip aria-hidden />
        </button>
      ) : (
        <Button
          size="sm"
          variant="secondary"
          icon={<Paperclip aria-hidden />}
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          {label}
        </Button>
      )}
    </>
  );
}

export function PendingList({
  pending,
  onCancel,
}: {
  pending: PendingUpload[];
  onCancel: (key: string) => void;
}) {
  if (!pending.length) return null;
  return (
    <ul className="flex flex-col gap-2">
      {pending.map((p) => (
        <li key={p.key}>
          <UploadProgress
            fileName={p.name}
            progress={p.progress}
            onCancel={() => onCancel(p.key)}
          />
        </li>
      ))}
    </ul>
  );
}

/** Images first as a grid of thumbnails, then the other files. */
export function AttachmentList({
  taskId,
  attachments,
  compact,
}: {
  taskId: string;
  attachments: Attachment[];
  compact?: boolean;
}) {
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const [removing, setRemoving] = useState<Attachment | null>(null);
  const images = attachments.filter((a) => a.kind === 'image');
  const others = attachments.filter((a) => a.kind !== 'image');
  return (
    <div className="flex flex-col gap-2">
      {images.length > 0 && (
        <ul
          aria-label={t('work.files.images')}
          className={cn(
            'grid gap-2',
            compact ? 'grid-cols-4 sm:grid-cols-6' : 'grid-cols-3 sm:grid-cols-4',
          )}
        >
          {images.map((a) => (
            <li key={a.id}>
              <ImageThumb src={fileUrl(a, true)} alt={a.fileName} onOpen={() => setViewing(a)} />
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <ul className="flex flex-col gap-2">
          {others.map((a) => (
            <li key={a.id}>
              <FileTile
                fileName={a.fileName}
                size={a.size}
                kind={a.kind}
                meta={t('work.files.meta', {
                  name: a.uploadedBy.displayName,
                  time: formatRelativeTime(new Date(a.createdAt)),
                })}
                href={fileUrl(a, a.kind === 'pdf')}
                external={a.kind === 'pdf'}
                actions={
                  <span className="flex shrink-0 items-center">
                    <a
                      href={fileUrl(a)}
                      aria-label={t('work.files.download', { name: a.fileName })}
                      className="grid size-9 place-items-center rounded-full text-ink-subtle hover:bg-sunken hover:text-ink [&_svg]:size-4"
                    >
                      <Download aria-hidden />
                    </a>
                    {a.can.delete && (
                      <button
                        type="button"
                        aria-label={t('work.files.delete', { name: a.fileName })}
                        onClick={() => setRemoving(a)}
                        className="grid size-9 place-items-center rounded-full text-ink-subtle hover:bg-sunken hover:text-danger-ink [&_svg]:size-4"
                      >
                        <Trash2 aria-hidden />
                      </button>
                    )}
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      )}
      <ImageViewer
        attachment={viewing}
        onClose={() => setViewing(null)}
        onDelete={(a) => {
          setViewing(null);
          setRemoving(a);
        }}
      />
      <DeleteAttachment taskId={taskId} attachment={removing} onClose={() => setRemoving(null)} />
    </div>
  );
}

function ImageViewer({
  attachment,
  onClose,
  onDelete,
}: {
  attachment: Attachment | null;
  onClose: () => void;
  onDelete: (attachment: Attachment) => void;
}) {
  return (
    <Modal
      open={attachment !== null}
      onOpenChange={(open) => !open && onClose()}
      title={attachment?.fileName ?? ''}
      className="sm:max-w-3xl"
    >
      {attachment && (
        <div className="flex flex-col gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- a private, signed-in download */}
          <img
            src={fileUrl(attachment, true)}
            alt={attachment.fileName}
            className="max-h-[70vh] w-full rounded-lg bg-sunken object-contain"
          />
          <div className="flex flex-wrap gap-2">
            <a
              href={fileUrl(attachment)}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 font-semibold text-on-primary [&_svg]:size-4"
            >
              <Download aria-hidden />
              {t('work.files.downloadShort')}
            </a>
            {attachment.can.delete && (
              <Button
                variant="ghost"
                className="text-danger-ink"
                icon={<Trash2 aria-hidden />}
                onClick={() => onDelete(attachment)}
              >
                {t('work.files.deleteShort')}
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function DeleteAttachment({
  taskId,
  attachment,
  onClose,
}: {
  taskId: string;
  attachment: Attachment | null;
  onClose: () => void;
}) {
  const remove = useDeleteAttachment(taskId);
  const { toast } = useToast();
  return (
    <Modal
      open={attachment !== null}
      onOpenChange={(open) => !open && onClose()}
      title={t('work.files.deleteTitle')}
      description={attachment ? t('work.files.deleteBody', { name: attachment.fileName }) : ''}
    >
      <div className="flex gap-3">
        <Button
          variant="danger"
          className="flex-1"
          loading={remove.isPending}
          onClick={() => {
            if (!attachment) return;
            remove.mutate(attachment.id, {
              onSuccess: () => toast({ tone: 'success', title: t('work.files.deleted') }),
              onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
            });
            onClose();
          }}
        >
          {t('task.delete')}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          {t('task.cancel')}
        </Button>
      </div>
    </Modal>
  );
}
