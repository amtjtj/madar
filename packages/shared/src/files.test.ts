import { describe, expect, it } from 'vitest';

import { extensionOf, fileTypeFor, sanitizeFileName } from './files.js';

const head = (...values: Array<number | string>) =>
  new Uint8Array(
    values.flatMap((v) => (typeof v === 'string' ? [...v].map((c) => c.charCodeAt(0)) : [v])),
  );

describe('fileTypeFor', () => {
  it('accepts allowed files whose bytes match their extension', () => {
    expect(fileTypeFor('قرارداد.PDF', head('%PDF-1.7'))).toMatchObject({
      kind: 'pdf',
      extension: 'pdf',
    });
    expect(fileTypeFor('a.png', head(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a))?.mime).toBe('image/png');
    expect(fileTypeFor('a.jpg', head(0xff, 0xd8, 0xff, 0xe0))?.kind).toBe('image');
    expect(fileTypeFor('a.docx', head('PK', 3, 4))?.kind).toBe('document');
    expect(fileTypeFor('a.xls', head(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1))?.kind).toBe(
      'document',
    );
    expect(fileTypeFor('a.webp', head('RIFF', 0, 0, 0, 0, 'WEBP'))?.kind).toBe('image');
    expect(fileTypeFor('a.mp4', head(0, 0, 0, 0x18, 'ftypmp42'))?.mime).toBe('video/mp4');
    expect(fileTypeFor('گزارش.csv', head('نام,تعداد\n'))?.kind).toBe('document');
  });

  it('refuses unknown extensions, mismatched bytes and markup', () => {
    expect(fileTypeFor('a.svg', head('<svg>'))).toBeNull();
    expect(fileTypeFor('a.html', head('<html>'))).toBeNull();
    expect(fileTypeFor('a.exe', head('MZ'))).toBeNull();
    expect(fileTypeFor('noext', head('%PDF-'))).toBeNull();
    expect(fileTypeFor('a.pdf', head('<html><script>'))).toBeNull();
    expect(fileTypeFor('a.png', head('%PDF-'))).toBeNull();
    expect(fileTypeFor('a.txt', head('  <!DOCTYPE html>'))).toBeNull();
    expect(fileTypeFor('a.txt', head('a', 0, 'b'))).toBeNull();
  });
});

describe('sanitizeFileName', () => {
  it('keeps a readable last segment without control or direction characters', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\Users\\ali\\قرارداد  نهایی.pdf')).toBe('قرارداد نهایی.pdf');
    expect(sanitizeFileName('a\u202Efdp.exe')).toBe('afdp.exe');
    expect(sanitizeFileName('\u2067report\u2069\u061C.pdf')).toBe('report.pdf');
    expect(sanitizeFileName('...')).toBe('file');
    const long = sanitizeFileName(`${'ا'.repeat(300)}.xlsx`);
    expect(long.length).toBe(200);
    expect(extensionOf(long)).toBe('xlsx');
  });
});
