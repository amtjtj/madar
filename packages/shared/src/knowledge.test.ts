import { describe, expect, it } from 'vitest';

import {
  asksToJudgePeople,
  CHUNK_MAX_CHARS,
  chunkText,
  CHUNKS_PER_SOURCE_MAX,
  normalizePersian,
} from './knowledge.js';

const sentence = (i: number) => `این جمله شماره ${i} درباره حذف کارمزد خرید خرد طلا است.`;

describe('chunkText', () => {
  it('keeps a short source in one chunk under its heading', () => {
    expect(chunkText('کار: حذف کارمزد', 'کارمزد زیر یک گرم حذف شد.\nاز آبان.')).toEqual([
      'کار: حذف کارمزد\nکارمزد زیر یک گرم حذف شد. از آبان.',
    ]);
  });

  it('gives the heading alone for an empty body', () => {
    expect(chunkText('  کار:   بدون شرح ', '   ')).toEqual(['کار: بدون شرح']);
  });

  it('cuts at sentences, within the limit, with a little overlap', () => {
    const body = Array.from({ length: 40 }, (_, i) => sentence(i)).join(' ');
    const chunks = chunkText('نامه: کارمزد', body);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      const [head, text = ''] = chunk.split('\n');
      expect(head).toBe('نامه: کارمزد');
      expect(text.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
      expect(text.endsWith('است.')).toBe(true);
    }
    // The last sentence of a chunk opens the next one.
    const first = chunks[0]?.split('\n')[1] ?? '';
    const last = first.slice(first.lastIndexOf('این جمله'));
    const second = chunks[1]?.split('\n')[1] ?? '';
    expect(second.indexOf(last)).toBeGreaterThan(-1);
    expect(second.indexOf(last)).toBeLessThan(CHUNK_MAX_CHARS / 4);
  });

  it('cuts a sentence longer than a chunk at spaces', () => {
    const long = Array.from({ length: 300 }, () => 'کلمه').join(' ');
    const chunks = chunkText('کار: طولانی', long);
    expect(chunks.length).toBe(2);
    expect(chunks.every((c) => (c.split('\n')[1] ?? '').length <= CHUNK_MAX_CHARS)).toBe(true);
  });

  it('indexes at most a fixed number of chunks per source', () => {
    const body = Array.from({ length: 1000 }, (_, i) => sentence(i)).join(' ');
    expect(chunkText('کار: بزرگ', body)).toHaveLength(CHUNKS_PER_SOURCE_MAX);
  });
});

describe('normalizePersian', () => {
  it('unifies Arabic letters, joiners and spaces', () => {
    expect(normalizePersian(' رتبه‌بندي  كارمندان ')).toBe('رتبه بندی کارمندان');
  });
});

describe('asksToJudgePeople', () => {
  it.each([
    'چه کسی از همه کمتر کار کرده؟',
    'کی بیشترین تاخیر را داشته؟',
    'رتبه‌بندی کارمندان پشتیبانی',
    'عملکرد همکاران فنی را مقایسه کن',
    'ضعیف‌ترین نیروی تیم کیست؟',
    'کدام همکار دیرتر کارهایش را انجام می‌دهد؟',
    'چه کسی را باید اخراج کنیم؟',
  ])('refuses «%s»', (q) => {
    expect(asksToJudgePeople(q)).toBe(true);
  });

  it.each([
    'آخرین تصمیم درباره قیمت‌گذاری کارمزد چه بود؟',
    'وضع پروژه اپ موبایل چیست؟',
    'جلسه بررسی OKR کی برگزار شد؟',
    'یکی از کارهای عقب‌افتاده پروژه طلا چیست؟',
    'مسئول کار حذف کارمزد کیست؟',
    'بیشترین شکایت مشتری‌ها درباره چه بوده؟',
  ])('answers «%s»', (q) => {
    expect(asksToJudgePeople(q)).toBe(false);
  });
});
