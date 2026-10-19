'use client';

import { t } from '@madar/i18n';
import { fileSizeParts, type AttachmentKind } from '@madar/shared';
import { FileArchive, FileImage, FileText, File as FileIcon, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn.js';
import { ProgressBar } from './progress.js';

const ICONS: Record<AttachmentKind, ReactNode> = {
  image: <FileImage aria-hidden />,
  pdf: <FileText aria-hidden />,
  document: <FileText aria-hidden />,
  other: <FileArchive aria-hidden />,
};

/** «۲٫۴ مگابایت» */
export function FileSize({ bytes }: { bytes: number }) {
  const { value, unit } = fileSizeParts(bytes);
  return <>{t(`ui.fileSize.${unit}`, { value })}</>;
}

export interface FileTileProps {
  fileName: string;
  size: number;
  kind: AttachmentKind;
  /** Uploader and time, already worded («علی رضایی، ۵ دقیقه پیش»). */
  meta?: string;
  /** Where the name leads (download or preview). */
  href?: string;
  /** Opens in a new tab (PDF). */
  external?: boolean;
  onOpen?: () => void;
  /** Buttons at the end (delete, download). */
  actions?: ReactNode;
  className?: string;
}

/** One attached file in a list: type icon, name, size and who added it (ADR 0019). */
export function FileTile({
  fileName,
  size,
  kind,
  meta,
  href,
  external,
  onOpen,
  actions,
  className,
}: FileTileProps) {
  const name = <span className="block truncate font-medium text-ink">{fileName}</span>;
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border border-line bg-surface p-2.5',
        className,
      )}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-sunken text-ink-muted [&_svg]:size-5">
        {ICONS[kind] ?? <FileIcon aria-hidden />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 rounded-sm text-start hover:text-primary-ink focus-visible:outline-2 focus-visible:outline-focus"
          >
            {name}
          </button>
        ) : href ? (
          <a
            href={href}
            target={external ? '_blank' : undefined}
            rel={external ? 'noopener noreferrer' : undefined}
            className="min-w-0 rounded-sm hover:text-primary-ink focus-visible:outline-2 focus-visible:outline-focus"
          >
            {name}
          </a>
        ) : (
          name
        )}
        <span className="truncate text-xs text-ink-muted">
          <FileSize bytes={size} />
          {meta ? `${t('ui.listSeparator')}${meta}` : ''}
        </span>
      </span>
      {actions}
    </div>
  );
}

export interface UploadProgressProps {
  fileName: string;
  /** 0..1 */
  progress: number;
  onCancel?: () => void;
  className?: string;
}

/** A file on its way up: name, a bar and cancel. */
export function UploadProgress({ fileName, progress, onCancel, className }: UploadProgressProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl border border-dashed border-line-strong bg-surface p-2.5',
        className,
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="truncate text-sm font-medium text-ink">{fileName}</span>
        <ProgressBar
          value={progress}
          size="sm"
          label={t('ui.uploading', { name: fileName })}
          hideLabel
        />
      </span>
      {onCancel ? (
        <button
          type="button"
          aria-label={t('ui.cancelUpload', { name: fileName })}
          onClick={onCancel}
          className="grid size-9 shrink-0 place-items-center rounded-full text-ink-subtle hover:bg-sunken hover:text-ink [&_svg]:size-4"
        >
          <X aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

export interface ImageThumbProps {
  src: string;
  alt: string;
  onOpen: () => void;
  className?: string;
}

/** A square image preview that opens the full image. */
export function ImageThumb({ src, alt, onOpen, className }: ImageThumbProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t('ui.openImage', { name: alt })}
      className={cn(
        'relative aspect-square overflow-hidden rounded-xl border border-line bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- a private, signed-in download */}
      <img src={src} alt="" loading="lazy" className="size-full object-cover" />
    </button>
  );
}
