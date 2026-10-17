/**
 * Persian UI strings. Every user-facing string lives here, never inline in components.
 * Keys are English and grouped by screen or domain.
 */
export const fa = {
  app: {
    name: 'مدار',
    tagline: 'سیستم‌عامل کاری یکپارچه سازمان',
  },
  health: {
    title: 'وضعیت اتصال',
    checking: 'در حال بررسی اتصال…',
    apiUp: 'سرور در دسترس است',
    apiDown: 'سرور در دسترس نیست',
    database: 'پایگاه داده',
    up: 'متصل',
    down: 'قطع',
    version: 'نسخه {version}',
    retry: 'تلاش دوباره',
  },
} as const;

export type Messages = typeof fa;
