/**
 * The letter body (ADR 0020): plain text with three marks, never HTML.
 *   - a line starting with "- " is a list item
 *   - **text** is bold
 *   - an empty line separates paragraphs
 * `parseLiteText` turns it into blocks the web renders as React elements only.
 */
export type LiteInline = { text: string; bold: boolean };
export type LiteBlock =
  { type: 'paragraph'; lines: LiteInline[][] } | { type: 'list'; items: LiteInline[][] };

export const LITE_TEXT_MAX = 20_000;

/** Splits a line into plain and bold runs; an unclosed ** stays as text. */
export function parseInline(line: string): LiteInline[] {
  const runs: LiteInline[] = [];
  let rest = line;
  for (;;) {
    const open = rest.indexOf('**');
    const close = open === -1 ? -1 : rest.indexOf('**', open + 2);
    if (open === -1 || close === -1) break;
    if (open > 0) runs.push({ text: rest.slice(0, open), bold: false });
    const bold = rest.slice(open + 2, close);
    if (bold) runs.push({ text: bold, bold: true });
    rest = rest.slice(close + 2);
  }
  if (rest) runs.push({ text: rest, bold: false });
  return runs;
}

export function parseLiteText(text: string): LiteBlock[] {
  const blocks: LiteBlock[] = [];
  let paragraph: LiteInline[][] | null = null;
  let list: LiteInline[][] | null = null;
  const flush = () => {
    if (paragraph) blocks.push({ type: 'paragraph', lines: paragraph });
    if (list) blocks.push({ type: 'list', items: list });
    paragraph = null;
    list = null;
  };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    const item = /^\s*[-•]\s+(.*)$/.exec(line);
    if (item) {
      if (paragraph) flush();
      (list ??= []).push(parseInline(item[1] ?? ''));
    } else {
      if (list) flush();
      (paragraph ??= []).push(parseInline(line));
    }
  }
  flush();
  return blocks;
}

/** Plain words only (for previews and search): marks removed. */
export function liteTextPreview(text: string, max = 140): string {
  const plain = text
    .replace(/\*\*/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}
