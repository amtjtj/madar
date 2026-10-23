/**
 * Rules of the company knowledge index and «از مدار بپرس» (plan phase-3-step-16b, ADR 0026) that the
 * API and its tests share: how a source is cut into chunks, and which questions the assistant
 * refuses because they would rank or judge people (CLAUDE.md AI and gamification red lines).
 */

/** Longest chunk body in characters (about 250–350 bge-m3 tokens of Persian). */
export const CHUNK_MAX_CHARS = 800;
/** Characters of the previous chunk repeated at the start of the next one. */
export const CHUNK_OVERLAP_CHARS = 120;
/** Most chunks one source may have; text past it is not indexed. */
export const CHUNKS_PER_SOURCE_MAX = 12;

/** Sentence ends (Persian and Latin), kept with the sentence. */
const SENTENCE = /[^.!?؟\n]+(?:[.!?؟]+|\n+|$)/g;

function sentencesOf(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(SENTENCE)) {
    const sentence = match[0].replace(/\s+/g, ' ').trim();
    if (!sentence) continue;
    // A sentence longer than a chunk is cut at spaces.
    if (sentence.length <= CHUNK_MAX_CHARS) {
      out.push(sentence);
      continue;
    }
    let rest = sentence;
    while (rest.length > CHUNK_MAX_CHARS) {
      const cut = rest.lastIndexOf(' ', CHUNK_MAX_CHARS);
      const at = cut > CHUNK_MAX_CHARS / 2 ? cut : CHUNK_MAX_CHARS;
      out.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) out.push(rest);
  }
  return out;
}

/**
 * Cuts a source's text into chunks of whole sentences, each starting with `heading` (for example
 * «کار: …») so a chunk read alone still says what it is about. Consecutive chunks share a little
 * text so an answer that spans the cut is still found. Empty text gives the heading alone.
 */
export function chunkText(heading: string, body: string): string[] {
  const head = heading.replace(/\s+/g, ' ').trim();
  const sentences = sentencesOf(body);
  if (sentences.length === 0) return [head];
  const chunks: string[] = [];
  let current: string[] = [];
  let length = 0;
  for (const sentence of sentences) {
    if (length > 0 && length + sentence.length + 1 > CHUNK_MAX_CHARS) {
      chunks.push(current.join(' '));
      if (chunks.length === CHUNKS_PER_SOURCE_MAX) break;
      // Overlap: the last sentences of this chunk, up to CHUNK_OVERLAP_CHARS.
      const carried: string[] = [];
      let carriedLength = 0;
      for (let i = current.length - 1; i >= 0; i--) {
        const s = current[i] ?? '';
        if (carriedLength + s.length > CHUNK_OVERLAP_CHARS) break;
        carried.unshift(s);
        carriedLength += s.length + 1;
      }
      current = carried;
      length = carriedLength;
    }
    current.push(sentence);
    length += sentence.length + 1;
  }
  if (current.length > 0 && chunks.length < CHUNKS_PER_SOURCE_MAX) chunks.push(current.join(' '));
  return chunks.map((chunk) => `${head}\n${chunk}`);
}

/** Arabic letters typed on some keyboards, zero-width joiners and extra spaces, made uniform. */
export function normalizePersian(text: string): string {
  return text
    .replace(/ي/g, 'ی')
    .replace(/ى/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c|\u200d|\u200e|\u200f/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Words that judge, compare or rank. */
const JUDGING =
  /(رتبه ?بندی|رتبه|مقایسه|ارزیابی|اخراج|تنبیه|ترفیع|پاداش|ضعیف ?ترین|بدترین|بهترین|کم ?کارترین|پرکارترین|تنبل|کم ?کار|کندترین|عملکرد|بازدهی|بهره ?وری)/;
/** Words that point at people. */
const PEOPLE =
  /(کارمند|کارکنان|همکار|نفر|افراد|فرد|شخص|اعضا|عضو|پرسنل|نیرو|کسی|چه کسانی|(?<=^|\s)کی(?=[\s؟?]|$)|کدام یک|کدوم|چه کس)/;
/** «who … the most / the least …». */
const WHO = /(چه کسی|(?<=^|\s)کی(?=[\s؟?]|$)|کدام (همکار|کارمند|نفر|عضو|یک)|کدوم)/;
const MOST = /(بیشترین|کمترین|بیشتر از همه|کمتر از همه|از همه|بیشتر|کمتر|دیرتر|زودتر)/;
const WORK = /(کار|تسک|تاخیر|تأخیر|انجام|دیر|غیبت|مرخصی|پیشرفت)/;

/**
 * True for a question that asks the assistant to rank, compare or judge people, which it never
 * answers («چه کسی از همه کمتر کار کرده؟»، «ارزیابی عملکرد همکاران»). A best-effort first line: the
 * model's instructions forbid it too.
 */
export function asksToJudgePeople(question: string): boolean {
  const q = normalizePersian(question);
  if (JUDGING.test(q) && PEOPLE.test(q)) return true;
  return WHO.test(q) && MOST.test(q) && WORK.test(q);
}
