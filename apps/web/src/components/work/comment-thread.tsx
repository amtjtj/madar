'use client';

import { Pencil, Send, Trash2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { t } from '@madar/i18n';
import { formatRelativeTime, type Comment, type Upload } from '@madar/shared';
import { Avatar, Button, FileTile, Skeleton, TextAreaField, useToast } from '@madar/ui';

import { AttachmentList, FilePicker, PendingList } from '@/components/work/attachments';
import { useUploads } from '@/hooks/files';

import { useAddComment, useComments, useEditComment } from '@/hooks/work';
import { errorMessage } from '@/lib/errors';

export function CommentThread({ taskId }: { taskId: string }) {
  const { data: comments, isPending } = useComments(taskId);
  const add = useAddComment(taskId);
  const { toast } = useToast();
  const [body, setBody] = useState('');
  // Files picked for this comment, uploaded already; sent with it (ADR 0019).
  const [files, setFiles] = useState<Upload[]>([]);
  const uploads = useUploads();
  const uploading = uploads.pending.length > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = body.trim();
    if (!value || uploading) return;
    add.mutate(
      { body: value, ...(files.length ? { attachmentIds: files.map((f) => f.id) } : {}) },
      {
        onSuccess: () => {
          setBody('');
          setFiles([]);
        },
        onError: (error) => toast({ tone: 'error', title: errorMessage(error) }),
      },
    );
  };

  return (
    <section aria-labelledby="comments-title" className="flex flex-col gap-3">
      <h2 id="comments-title" className="text-lg font-bold text-ink">
        {t('task.comments')}
      </h2>
      {isPending ? (
        <Skeleton className="h-16 rounded-xl" />
      ) : comments && comments.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {comments.map((comment) => (
            <CommentItem key={comment.id} comment={comment} taskId={taskId} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-muted">{t('task.noComments')}</p>
      )}
      <form onSubmit={submit} className="flex flex-col gap-2">
        <TextAreaField
          label={t('task.commentPlaceholder')}
          hideLabel
          placeholder={t('task.commentPlaceholder')}
          rows={2}
          maxLength={5000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey))
              e.currentTarget.form?.requestSubmit();
          }}
        />
        <PendingList pending={uploads.pending} onCancel={uploads.cancel} />
        {files.length > 0 && (
          <ul className="flex flex-col gap-2">
            {files.map((f) => (
              <li key={f.id}>
                <FileTile
                  fileName={f.fileName}
                  size={f.size}
                  kind={f.kind}
                  actions={
                    <button
                      type="button"
                      aria-label={t('work.files.remove', { name: f.fileName })}
                      onClick={() => setFiles((list) => list.filter((x) => x.id !== f.id))}
                      className="grid size-9 shrink-0 place-items-center rounded-full text-ink-subtle hover:bg-sunken hover:text-ink [&_svg]:size-4"
                    >
                      <X aria-hidden />
                    </button>
                  }
                />
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between gap-2">
          <FilePicker
            label={t('work.files.attach')}
            iconOnly
            onFiles={(picked) =>
              void uploads.upload(picked).then((done) => setFiles((list) => [...list, ...done]))
            }
          />
          <Button
            type="submit"
            size="sm"
            disabled={!body.trim() || uploading}
            loading={add.isPending}
            icon={<Send aria-hidden className="-scale-x-100" />}
          >
            {t('task.send')}
          </Button>
        </div>
      </form>
    </section>
  );
}

function CommentItem({ comment, taskId }: { comment: Comment; taskId: string }) {
  const edit = useEditComment(taskId);
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(comment.body);
  const onError = (error: unknown) => toast({ tone: 'error', title: errorMessage(error) });

  return (
    <li className="flex gap-3">
      <Avatar name={comment.author.displayName} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-xl rounded-ss-sm bg-sunken px-3 py-2">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-bold text-ink">{comment.author.displayName}</span>
          <span className="text-xs text-ink-subtle">
            {formatRelativeTime(new Date(comment.createdAt))}
            {comment.editedAt && !comment.deleted ? ` (${t('task.edited')})` : ''}
          </span>
          {comment.can.edit && !editing && (
            <span className="ms-auto flex gap-1">
              <button
                type="button"
                aria-label={t('task.edit')}
                onClick={() => setEditing(true)}
                className="grid size-7 place-items-center rounded-full text-ink-subtle hover:bg-surface hover:text-ink [&_svg]:size-3.5"
              >
                <Pencil aria-hidden />
              </button>
              <button
                type="button"
                aria-label={t('task.delete')}
                onClick={() => edit.mutate({ id: comment.id, body: null }, { onError })}
                className="grid size-7 place-items-center rounded-full text-ink-subtle hover:bg-surface hover:text-danger-ink [&_svg]:size-3.5"
              >
                <Trash2 aria-hidden />
              </button>
            </span>
          )}
        </div>
        {comment.deleted ? (
          <p className="text-sm text-ink-subtle italic">{t('task.commentDeleted')}</p>
        ) : editing ? (
          <div className="flex flex-col gap-2">
            <TextAreaField
              label={t('task.edit')}
              hideLabel
              rows={2}
              value={body}
              maxLength={5000}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!body.trim()}
                loading={edit.isPending}
                onClick={() =>
                  edit.mutate(
                    { id: comment.id, body: body.trim() },
                    { onSuccess: () => setEditing(false), onError },
                  )
                }
              >
                {t('task.save')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setBody(comment.body);
                  setEditing(false);
                }}
              >
                {t('task.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="whitespace-pre-line break-words leading-7 text-ink">{comment.body}</p>
            {comment.attachments.length > 0 && (
              <AttachmentList taskId={taskId} attachments={comment.attachments} compact />
            )}
          </>
        )}
      </div>
    </li>
  );
}
