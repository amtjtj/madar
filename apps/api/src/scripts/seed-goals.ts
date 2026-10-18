/**
 * Goals for the demo company: the current season in three levels, with check-in history and a few
 * tasks and projects linked to key results (phase 1, step 7).
 */
import type { CheckinStatus, GoalLevel, KeyResultKind } from '@madar/shared';

export interface SeedCheckin {
  daysAgo: number;
  value: number;
  status: CheckinStatus;
  note?: string;
}

export interface SeedKeyResult {
  key: string;
  title: string;
  kind: KeyResultKind;
  start?: number;
  target?: number;
  unit?: string;
  weight?: number;
  /** Oldest first; the last one is recorded through the service (it sets the current value). */
  checkins?: SeedCheckin[];
}

export interface SeedGoal {
  key: string;
  level: GoalLevel;
  /** Department key for department and personal goals. */
  department?: string;
  owner: string;
  parent?: string;
  title: string;
  keyResults: SeedKeyResult[];
}

export const SEED_GOALS: SeedGoal[] = [
  // Company (created by the CEO)
  {
    key: 'growth',
    level: 'company',
    owner: 'reza.karimi',
    title: 'رسیدن به ۵۰ هزار کاربر فعال ماهانه',
    keyResults: [
      {
        key: 'mau',
        title: 'کاربر فعال ماهانه',
        kind: 'number',
        start: 32_000,
        target: 50_000,
        unit: 'نفر',
        weight: 3,
        checkins: [
          { daysAgo: 21, value: 34_500, status: 'on_track' },
          { daysAgo: 14, value: 36_800, status: 'on_track' },
          { daysAgo: 7, value: 38_200, status: 'at_risk', note: 'رشد هفته قبل کند شد.' },
          { daysAgo: 1, value: 40_100, status: 'on_track', note: 'کمپین پاییز اثرش را نشان داد.' },
        ],
      },
      {
        key: 'retention',
        title: 'نگهداشت ماه دوم',
        kind: 'percent',
        start: 38,
        target: 50,
        checkins: [
          { daysAgo: 14, value: 40, status: 'on_track' },
          { daysAgo: 2, value: 42, status: 'at_risk' },
        ],
      },
    ],
  },
  {
    key: 'trust',
    level: 'company',
    owner: 'leila.sadeghi',
    title: 'بهترین تجربه پشتیبانی در بازار طلای آنلاین',
    keyResults: [
      {
        key: 'csat',
        title: 'رضایت مشتری از پشتیبانی',
        kind: 'percent',
        start: 72,
        target: 90,
        checkins: [
          { daysAgo: 10, value: 76, status: 'on_track' },
          { daysAgo: 3, value: 79, status: 'on_track' },
        ],
      },
    ],
  },
  {
    key: 'installments',
    level: 'company',
    owner: 'reza.karimi',
    title: 'راه‌اندازی خرید اقساطی طلا',
    keyResults: [
      { key: 'license', title: 'مجوز بانک مرکزی برای خرید اقساطی', kind: 'boolean' },
      {
        key: 'pilot',
        title: 'کاربران آزمایشی خرید اقساطی',
        kind: 'number',
        start: 0,
        target: 500,
        unit: 'نفر',
        checkins: [{ daysAgo: 5, value: 60, status: 'off_track', note: 'منتظر مجوز هستیم.' }],
      },
    ],
  },

  // Departments (created by their heads)
  {
    key: 'support-speed',
    level: 'department',
    department: 'support',
    owner: 'maryam.ahmadi',
    parent: 'trust',
    title: 'پاسخ سریع‌تر به تیکت‌ها',
    keyResults: [
      {
        key: 'response',
        title: 'میانگین زمان اولین پاسخ',
        kind: 'number',
        start: 6,
        target: 1,
        unit: 'ساعت',
        weight: 2,
        checkins: [
          { daysAgo: 20, value: 5.5, status: 'on_track' },
          { daysAgo: 13, value: 4.5, status: 'on_track' },
          { daysAgo: 6, value: 4, status: 'at_risk', note: 'شیفت شب هنوز کم‌نیرو است.' },
          { daysAgo: 1, value: 3.2, status: 'on_track' },
        ],
      },
      {
        key: 'backlog',
        title: 'تیکت‌های معوق بیش از ۲۴ ساعت',
        kind: 'number',
        start: 120,
        target: 10,
        unit: 'تیکت',
        checkins: [{ daysAgo: 3, value: 65, status: 'on_track' }],
      },
    ],
  },
  {
    key: 'eng-app',
    level: 'department',
    department: 'eng',
    owner: 'amir.hosseini',
    parent: 'growth',
    title: 'اپلیکیشن نسخه ۲ برای همه کاربران',
    keyResults: [
      {
        key: 'rollout',
        title: 'سهم کاربران روی نسخه ۲',
        kind: 'percent',
        start: 0,
        target: 100,
        checkins: [
          { daysAgo: 12, value: 10, status: 'on_track' },
          { daysAgo: 2, value: 35, status: 'on_track' },
        ],
      },
      {
        key: 'kyc-steps',
        title: 'تعداد مراحل احراز هویت',
        kind: 'number',
        start: 5,
        target: 3,
        unit: 'مرحله',
        checkins: [{ daysAgo: 4, value: 4, status: 'at_risk' }],
      },
    ],
  },
  {
    key: 'mkt-autumn',
    level: 'department',
    department: 'mkt',
    owner: 'elham.akbari',
    parent: 'growth',
    title: 'جذب کاربر تازه با کمپین پاییز',
    keyResults: [
      {
        key: 'signups',
        title: 'ثبت‌نام از کمپین',
        kind: 'number',
        start: 0,
        target: 8_000,
        unit: 'نفر',
        checkins: [
          { daysAgo: 9, value: 1_800, status: 'on_track' },
          { daysAgo: 2, value: 3_900, status: 'on_track' },
        ],
      },
      {
        key: 'cac',
        title: 'هزینه جذب هر کاربر',
        kind: 'number',
        start: 450_000,
        target: 300_000,
        unit: 'تومان',
        checkins: [{ daysAgo: 2, value: 410_000, status: 'at_risk' }],
      },
    ],
  },

  // Personal (each person under their department goal)
  {
    key: 'ali-night',
    level: 'individual',
    department: 'support',
    owner: 'ali.rezaei',
    parent: 'support-speed',
    title: 'آماده کردن پاسخ‌های آماده برای سوالات برداشت',
    keyResults: [
      {
        key: 'templates',
        title: 'پاسخ آماده تازه',
        kind: 'number',
        start: 0,
        target: 20,
        unit: 'پاسخ',
        checkins: [{ daysAgo: 3, value: 12, status: 'on_track' }],
      },
    ],
  },
  {
    key: 'zahra-vip',
    level: 'individual',
    department: 'support',
    owner: 'zahra.mohammadi',
    parent: 'support-speed',
    title: 'پیگیری ویژه مشتریان VIP',
    keyResults: [{ key: 'vip-calls', title: 'تماس با همه مشتریان VIP', kind: 'boolean' }],
  },
  {
    key: 'negar-wallet',
    level: 'individual',
    department: 'eng',
    owner: 'negar.rezaei',
    parent: 'eng-app',
    title: 'تحویل API کیف پول طلا',
    keyResults: [
      {
        key: 'endpoints',
        title: 'سرویس‌های کیف پول آماده',
        kind: 'percent',
        start: 0,
        target: 100,
        checkins: [{ daysAgo: 2, value: 60, status: 'on_track' }],
      },
    ],
  },
];

/** Seed tasks (by title) and projects (by key) linked to key results. */
export const SEED_TASK_LINKS: Record<string, string> = {
  'پاسخ به تیکت‌های معوق صف طلا': 'backlog',
  'داشبورد زمان پاسخ در ساعات اوج': 'response',
  'آموزش تیم شب برای پاسخ به سوالات برداشت': 'response',
  'به‌روزرسانی پاسخ‌های آماده': 'templates',
  'تماس با مشتریان VIP درباره قیمت جدید': 'vip-calls',
  'طراحی API کیف پول طلا': 'endpoints',
  'کاهش مراحل احراز هویت از ۵ به ۳': 'kyc-steps',
  'طراحی بنر جشنواره پاییز': 'signups',
  'تمدید مجوز فعالیت از بانک مرکزی': 'license',
};

export const SEED_PROJECT_LINKS: Record<string, string> = {
  app2: 'rollout',
  autumn: 'signups',
  sla: 'response',
};
