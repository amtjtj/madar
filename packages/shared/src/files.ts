import { z } from 'zod';

/**
 * Files people may attach (ADR 0019): an allowlist by extension, each with the MIME type we serve
 * it with and a check on its first bytes, so a renamed HTML page or script is refused. SVG and
 * HTML are left out on purpose: they can run script.
 */
export const ATTACHMENT_KINDS = ['image', 'pdf', 'document', 'other'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

type Signature = (head: Uint8Array) => boolean;

const bytes =
  (...expected: number[]): Signature =>
  (head) =>
    expected.every((b, i) => head[i] === b);
const ascii = (text: string, offset = 0): Signature => {
  const codes = [...text].map((c) => c.charCodeAt(0));
  return (head) => codes.every((b, i) => head[offset + i] === b);
};
const any =
  (...checks: Signature[]): Signature =>
  (head) =>
    checks.some((check) => check(head));

const zip = any(bytes(0x50, 0x4b, 0x03, 0x04), bytes(0x50, 0x4b, 0x05, 0x06));
const ole = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
const isoMedia = ascii('ftyp', 4);
/** Plain text: no NUL byte, and not markup a browser would render. */
const text: Signature = (head) => {
  if (head.includes(0)) return false;
  let i = head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0; // UTF-8 BOM
  while (i < head.length && [0x20, 0x09, 0x0a, 0x0d].includes(head[i] ?? 0)) i++;
  const start = String.fromCharCode(...head.slice(i, i + 16)).toLowerCase();
  return !/^<(!doctype|html|script|svg|\?xml|body|iframe)/.test(start);
};

interface FileType {
  mime: string;
  kind: AttachmentKind;
  signature: Signature;
}

export const FILE_TYPES: Record<string, FileType> = {
  jpg: { mime: 'image/jpeg', kind: 'image', signature: bytes(0xff, 0xd8, 0xff) },
  jpeg: { mime: 'image/jpeg', kind: 'image', signature: bytes(0xff, 0xd8, 0xff) },
  png: {
    mime: 'image/png',
    kind: 'image',
    signature: bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  },
  gif: { mime: 'image/gif', kind: 'image', signature: any(ascii('GIF87a'), ascii('GIF89a')) },
  webp: {
    mime: 'image/webp',
    kind: 'image',
    signature: (head) => ascii('RIFF')(head) && ascii('WEBP', 8)(head),
  },
  pdf: { mime: 'application/pdf', kind: 'pdf', signature: ascii('%PDF-') },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    kind: 'document',
    signature: zip,
  },
  xlsx: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    kind: 'document',
    signature: zip,
  },
  pptx: {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    kind: 'document',
    signature: zip,
  },
  odt: { mime: 'application/vnd.oasis.opendocument.text', kind: 'document', signature: zip },
  ods: { mime: 'application/vnd.oasis.opendocument.spreadsheet', kind: 'document', signature: zip },
  doc: { mime: 'application/msword', kind: 'document', signature: ole },
  xls: { mime: 'application/vnd.ms-excel', kind: 'document', signature: ole },
  ppt: { mime: 'application/vnd.ms-powerpoint', kind: 'document', signature: ole },
  txt: { mime: 'text/plain; charset=utf-8', kind: 'document', signature: text },
  csv: { mime: 'text/csv; charset=utf-8', kind: 'document', signature: text },
  zip: { mime: 'application/zip', kind: 'other', signature: zip },
  mp3: {
    mime: 'audio/mpeg',
    kind: 'other',
    signature: any(ascii('ID3'), (head) => head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0),
  },
  m4a: { mime: 'audio/mp4', kind: 'other', signature: isoMedia },
  mp4: { mime: 'video/mp4', kind: 'other', signature: isoMedia },
};

/** How many leading bytes `fileTypeFor` needs. */
export const SIGNATURE_BYTES = 512;

/** Lowercase extension without the dot ('' when none). */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 && dot < fileName.length - 1 ? fileName.slice(dot + 1).toLowerCase() : '';
}

/** The allowed type for this name and these first bytes, or null when refused. */
export function fileTypeFor(
  fileName: string,
  head: Uint8Array,
): (FileType & { extension: string }) | null {
  const extension = extensionOf(fileName);
  const type = FILE_TYPES[extension];
  if (!type || !type.signature(head)) return null;
  return { ...type, extension };
}

/** Preview in the page (images) or a new tab (PDF); everything else downloads. */
export function opensInline(kind: AttachmentKind): boolean {
  return kind === 'image' || kind === 'pdf';
}

/**
 * A safe display name: last path segment only, no control characters, at most 200 characters
 * with the extension kept. Never used to build a storage path.
 */
/** Control characters and bidi marks or overrides (the «‮fdp.exe» trick). */
function unsafeNameChar(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    code < 0x20 ||
    code === 0x7f ||
    code === 0x061c ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

export function sanitizeFileName(raw: string): string {
  const base = raw.normalize('NFC').split(/[\\/]/).pop() ?? '';
  const clean = [...base]
    .filter((char) => !unsafeNameChar(char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  const name = clean.replace(/^\.+/, '') || 'file';
  if (name.length <= 200) return name;
  const extension = extensionOf(name);
  const keep = extension ? 200 - extension.length - 1 : 200;
  return extension ? `${name.slice(0, keep)}.${extension}` : name.slice(0, 200);
}

export const DEFAULT_MAX_FILE_MB = 25;

/** The company's file settings (`tenants.settings.files`); only the owner changes them. */
export const fileSettings = z.object({ maxSizeMb: z.number().int().min(1).max(100) });
export type FileSettings = z.infer<typeof fileSettings>;
export const DEFAULT_FILE_SETTINGS: FileSettings = { maxSizeMb: DEFAULT_MAX_FILE_MB };

export const ATTACHMENT_SUBJECTS = ['task', 'comment', 'letter'] as const;
export type AttachmentSubject = (typeof ATTACHMENT_SUBJECTS)[number];

export const attachment = z.object({
  id: z.uuid(),
  fileName: z.string(),
  size: z.number().int(),
  mime: z.string(),
  kind: z.enum(ATTACHMENT_KINDS),
  uploadedBy: z.object({ id: z.uuid(), displayName: z.string() }),
  createdAt: z.iso.datetime(),
  /** What it is attached to; null while it is a fresh upload. */
  subject: z.object({ type: z.enum(ATTACHMENT_SUBJECTS), id: z.uuid() }).nullable(),
  can: z.object({ delete: z.boolean() }),
});
export type Attachment = z.infer<typeof attachment>;

/** A fresh upload, not yet attached to anything (only its uploader sees it). */
export const upload = attachment.pick({
  id: true,
  fileName: true,
  size: true,
  mime: true,
  kind: true,
});
export type Upload = z.infer<typeof upload>;

export const attachUploadsRequest = z.object({ uploadIds: z.array(z.uuid()).min(1).max(10) });
export type AttachUploadsRequest = z.infer<typeof attachUploadsRequest>;
