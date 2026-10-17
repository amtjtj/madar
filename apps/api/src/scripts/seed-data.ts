import type { OversightResource, SystemRole } from '@madar/shared';

/**
 * Demo company for development and demos (docs/pilot-assumptions.md §4):
 * a fictional online-gold company with 5 departments and 20 employees.
 */
export const SEED_COMPANY = { name: 'زرین‌مدار', slug: 'zarrin-madar' };

export interface SeedDepartment {
  key: string;
  name: string;
  templateKey: string;
  oversight?: OversightResource[];
}

export const SEED_DEPARTMENTS: SeedDepartment[] = [
  {
    key: 'exec',
    name: 'مدیریت ارشد',
    templateKey: 'executive',
    oversight: ['task', 'project', 'goal', 'metric', 'approval'],
  },
  { key: 'eng', name: 'فنی', templateKey: 'engineering' },
  { key: 'mkt', name: 'مارکتینگ', templateKey: 'marketing' },
  { key: 'support', name: 'پشتیبانی', templateKey: 'support' },
  {
    key: 'hr',
    name: 'منابع انسانی',
    templateKey: 'hr',
    oversight: ['member', 'leave', 'org_chart'],
  },
];

export interface SeedPerson {
  username: string;
  name: string;
  title: string;
  department: string;
  head?: boolean;
  /** Username of the direct manager. */
  manager?: string;
  roles?: SystemRole[];
}

export const SEED_PEOPLE: SeedPerson[] = [
  // The first person is the owner who registers the company.
  {
    username: 'reza.karimi',
    name: 'رضا کریمی',
    title: 'مدیرعامل',
    department: 'exec',
    head: true,
    roles: ['owner'],
  },
  {
    username: 'leila.sadeghi',
    name: 'لیلا صادقی',
    title: 'مدیر عملیات',
    department: 'exec',
    manager: 'reza.karimi',
    roles: ['executive'],
  },

  {
    username: 'amir.hosseini',
    name: 'امیر حسینی',
    title: 'مدیر فنی',
    department: 'eng',
    head: true,
    manager: 'reza.karimi',
  },
  {
    username: 'kian.nouri',
    name: 'کیان نوری',
    title: 'مدیر محصول',
    department: 'eng',
    manager: 'amir.hosseini',
  },
  {
    username: 'negar.rezaei',
    name: 'نگار رضایی',
    title: 'توسعه‌دهنده ارشد بک‌اند',
    department: 'eng',
    manager: 'amir.hosseini',
  },
  {
    username: 'behrad.mousavi',
    name: 'بهراد موسوی',
    title: 'توسعه‌دهنده فرانت‌اند',
    department: 'eng',
    manager: 'amir.hosseini',
  },
  {
    username: 'sahar.jafari',
    name: 'سحر جعفری',
    title: 'توسعه‌دهنده موبایل',
    department: 'eng',
    manager: 'amir.hosseini',
  },
  {
    username: 'pouya.ghasemi',
    name: 'پویا قاسمی',
    title: 'مهندس زیرساخت',
    department: 'eng',
    manager: 'amir.hosseini',
  },
  {
    username: 'mahsa.abbasi',
    name: 'مهسا عباسی',
    title: 'کارشناس تضمین کیفیت',
    department: 'eng',
    manager: 'amir.hosseini',
  },

  {
    username: 'elham.akbari',
    name: 'الهام اکبری',
    title: 'مدیر مارکتینگ',
    department: 'mkt',
    head: true,
    manager: 'reza.karimi',
  },
  {
    username: 'arash.taheri',
    name: 'آرش طاهری',
    title: 'کارشناس تبلیغات',
    department: 'mkt',
    manager: 'elham.akbari',
  },
  {
    username: 'shiva.kazemi',
    name: 'شیوا کاظمی',
    title: 'کارشناس محتوا',
    department: 'mkt',
    manager: 'elham.akbari',
  },
  {
    username: 'milad.rahimi',
    name: 'میلاد رحیمی',
    title: 'طراح گرافیک',
    department: 'mkt',
    manager: 'elham.akbari',
  },

  {
    username: 'maryam.ahmadi',
    name: 'مریم احمدی',
    title: 'مدیر پشتیبانی',
    department: 'support',
    head: true,
    manager: 'leila.sadeghi',
  },
  {
    username: 'ali.rezaei',
    name: 'علی رضایی',
    title: 'کارشناس پشتیبانی',
    department: 'support',
    manager: 'maryam.ahmadi',
  },
  {
    username: 'zahra.mohammadi',
    name: 'زهرا محمدی',
    title: 'کارشناس پشتیبانی',
    department: 'support',
    manager: 'maryam.ahmadi',
  },
  {
    username: 'hossein.yousefi',
    name: 'حسین یوسفی',
    title: 'کارشناس پشتیبانی',
    department: 'support',
    manager: 'maryam.ahmadi',
  },

  {
    username: 'fatemeh.najafi',
    name: 'فاطمه نجفی',
    title: 'مدیر منابع انسانی',
    department: 'hr',
    head: true,
    manager: 'leila.sadeghi',
    roles: ['hr_manager'],
  },
  {
    username: 'sina.moradi',
    name: 'سینا مرادی',
    title: 'ادمین سیستم',
    department: 'hr',
    manager: 'fatemeh.najafi',
    roles: ['admin'],
  },
  {
    username: 'niloufar.sharifi',
    name: 'نیلوفر شریفی',
    title: 'کارشناس جذب',
    department: 'hr',
    manager: 'fatemeh.najafi',
  },
];
