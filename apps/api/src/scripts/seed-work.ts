import type { TaskPriority } from '@madar/shared';

/**
 * Demo work for «زرین‌مدار»: projects and ~60 tasks spread over departments, due dates
 * (relative to the seed day), statuses, comments and a few «today» plans.
 */

export interface SeedProject {
  key: string;
  name: string;
  description: string;
  department: string;
  visibility: 'department' | 'tenant' | 'private';
  owner: string;
  members?: string[];
  /** Days from today. */
  dueIn?: number;
}

export const SEED_PROJECTS: SeedProject[] = [
  {
    key: 'app2',
    name: 'نسخه ۲ اپلیکیشن خرید طلا',
    description: 'بازطراحی صفحه خرید و فروش، کیف پول و نمودار قیمت لحظه‌ای.',
    department: 'eng',
    visibility: 'tenant',
    owner: 'kian.nouri',
    members: ['negar.rezaei', 'behrad.mousavi', 'sahar.jafari', 'mahsa.abbasi', 'milad.rahimi'],
    dueIn: 40,
  },
  {
    key: 'autumn',
    name: 'کمپین جشنواره پاییز',
    description: 'هدیه طلای آب‌شده برای خریدهای بالای ۵ گرم؛ بنر، پیامک و همکاری با اینفلوئنسرها.',
    department: 'mkt',
    visibility: 'tenant',
    owner: 'elham.akbari',
    members: ['arash.taheri', 'shiva.kazemi', 'milad.rahimi', 'maryam.ahmadi'],
    dueIn: 14,
  },
  {
    key: 'sla',
    name: 'کاهش زمان پاسخ پشتیبانی',
    description: 'هدف: میانگین پاسخ زیر ۵ دقیقه در ساعات اوج بازار.',
    department: 'support',
    visibility: 'department',
    owner: 'maryam.ahmadi',
    dueIn: 30,
  },
  {
    key: 'kyc',
    name: 'احراز هویت سریع‌تر',
    description: 'کوتاه کردن مسیر احراز هویت کاربران جدید با همکاری فنی و پشتیبانی.',
    department: 'eng',
    visibility: 'department',
    owner: 'amir.hosseini',
    members: ['pouya.ghasemi', 'negar.rezaei', 'maryam.ahmadi'],
    dueIn: 21,
  },
  {
    key: 'hiring',
    name: 'جذب نیروی پاییز',
    description: 'استخدام دو توسعه‌دهنده و یک کارشناس پشتیبانی شیفت شب.',
    department: 'hr',
    visibility: 'private',
    owner: 'fatemeh.najafi',
    members: ['niloufar.sharifi', 'amir.hosseini', 'maryam.ahmadi'],
    dueIn: 45,
  },
];

export interface SeedTask {
  title: string;
  /** Reporter (creates the task). */
  by: string;
  assignee?: string;
  project?: string;
  dueIn?: number;
  status?: 'todo' | 'in_progress' | 'done';
  priority?: TaskPriority;
  /** Set by the reporter when they manage the department. */
  weight?: number;
  description?: string;
  subtasks?: string[];
  comments?: Array<{ by: string; body: string }>;
  /** Put on the assignee's plan for today. */
  today?: boolean;
  /** Was on the assignee's plan yesterday (shows as «از دیروز»). */
  yesterday?: boolean;
}

export const SEED_TASKS: SeedTask[] = [
  // ---------- پشتیبانی ----------
  {
    title: 'پاسخ به تیکت‌های معوق صف طلا',
    by: 'maryam.ahmadi',
    assignee: 'ali.rezaei',
    dueIn: -1,
    priority: 'urgent',
    weight: 3,
    today: true,
    comments: [{ by: 'ali.rezaei', body: 'تا ظهر صف را خالی می‌کنم.' }],
  },
  {
    title: 'بررسی شکایت کارمزد خرید طلا',
    by: 'maryam.ahmadi',
    assignee: 'ali.rezaei',
    dueIn: 0,
    priority: 'high',
    today: true,
  },
  {
    title: 'گزارش روزانه پشتیبانی',
    by: 'ali.rezaei',
    assignee: 'ali.rezaei',
    dueIn: 0,
    today: true,
  },
  {
    title: 'تماس با مشتریان VIP درباره قیمت جدید',
    by: 'maryam.ahmadi',
    assignee: 'ali.rezaei',
    dueIn: 2,
    yesterday: true,
  },
  {
    title: 'گزارش رضایت مشتریان برای جلسه هیئت‌مدیره',
    // Assigned by the CEO: shows the «ابلاغ مدیرعامل» badge and sits near the top (ADR 0017).
    by: 'reza.karimi',
    assignee: 'ali.rezaei',
    dueIn: 1,
    today: true,
    description: 'خلاصه شکایت‌ها و رضایت مشتریان در ماه گذشته، در یک صفحه.',
  },
  {
    title: 'بررسی تیکت‌های مشترک با تیم فنی',
    // A colleague's request (same level, not a manager).
    by: 'zahra.mohammadi',
    assignee: 'ali.rezaei',
    dueIn: 3,
  },
  {
    title: 'به‌روزرسانی پاسخ‌های آماده',
    by: 'maryam.ahmadi',
    assignee: 'zahra.mohammadi',
    project: 'sla',
    status: 'in_progress',
    dueIn: 3,
    subtasks: [
      'پاسخ‌های مربوط به برداشت',
      'پاسخ‌های مربوط به احراز هویت',
      'پاسخ‌های مربوط به کارمزد',
    ],
  },
  {
    title: 'داشبورد زمان پاسخ در ساعات اوج',
    by: 'maryam.ahmadi',
    assignee: 'hossein.yousefi',
    project: 'sla',
    dueIn: 7,
    weight: 4,
    description: 'نمودار میانگین و صدک ۹۰ زمان پاسخ، به تفکیک ساعت.',
  },
  {
    title: 'آموزش تیم شب برای پاسخ به سوالات برداشت',
    by: 'maryam.ahmadi',
    assignee: 'zahra.mohammadi',
    project: 'sla',
    dueIn: 5,
  },
  {
    title: 'تعریف اولویت تیکت‌ها بر اساس مبلغ معامله',
    by: 'maryam.ahmadi',
    assignee: 'maryam.ahmadi',
    project: 'sla',
    status: 'done',
  },
  {
    title: 'پیگیری تراکنش‌های ناموفق دیروز',
    by: 'hossein.yousefi',
    assignee: 'hossein.yousefi',
    dueIn: -2,
    priority: 'high',
  },
  {
    title: 'جمع‌بندی بازخورد کاربران درباره اپ جدید',
    by: 'zahra.mohammadi',
    assignee: 'zahra.mohammadi',
    dueIn: 4,
    comments: [{ by: 'maryam.ahmadi', body: 'نتیجه را برای کیان هم بفرست.' }],
  },
  {
    title: 'بررسی تیکت‌های احراز هویت ردشده',
    by: 'maryam.ahmadi',
    assignee: 'hossein.yousefi',
    project: 'kyc',
    status: 'in_progress',
    dueIn: 1,
  },
  {
    title: 'به‌روزرسانی صفحه سوالات متداول',
    by: 'ali.rezaei',
    assignee: 'ali.rezaei',
    status: 'done',
  },

  // ---------- فنی ----------
  {
    title: 'برنامه پایداری سامانه در روزهای پرنوسان بازار',
    by: 'reza.karimi',
    assignee: 'amir.hosseini',
    dueIn: 4,
    priority: 'high',
  },
  {
    title: 'طراحی API کیف پول طلا',
    by: 'amir.hosseini',
    assignee: 'negar.rezaei',
    project: 'app2',
    status: 'in_progress',
    dueIn: 6,
    priority: 'high',
    weight: 5,
    subtasks: ['مدل داده تراکنش‌ها', 'قفل خوش‌بینانه برای موجودی', 'مستندات API'],
  },
  {
    title: 'نمودار قیمت لحظه‌ای در صفحه خرید',
    by: 'kian.nouri',
    assignee: 'behrad.mousavi',
    project: 'app2',
    dueIn: 10,
  },
  {
    title: 'صفحه خرید و فروش نسخه موبایل',
    by: 'kian.nouri',
    assignee: 'sahar.jafari',
    project: 'app2',
    status: 'in_progress',
    dueIn: 12,
  },
  {
    title: 'طراحی رابط کاربری کیف پول',
    by: 'kian.nouri',
    assignee: 'milad.rahimi',
    project: 'app2',
    status: 'done',
  },
  {
    title: 'سناریوهای تست خرید و فروش',
    by: 'kian.nouri',
    assignee: 'mahsa.abbasi',
    project: 'app2',
    dueIn: 15,
  },
  {
    title: 'رفع باگ نمایش موجودی بعد از فروش',
    by: 'mahsa.abbasi',
    assignee: 'behrad.mousavi',
    dueIn: -1,
    priority: 'urgent',
    comments: [{ by: 'behrad.mousavi', body: 'مشکل از کش سمت کلاینت است، امروز درست می‌شود.' }],
  },
  {
    title: 'پایش خطاهای سرویس قیمت‌گذاری',
    by: 'amir.hosseini',
    assignee: 'pouya.ghasemi',
    status: 'in_progress',
    dueIn: 2,
    weight: 3,
  },
  {
    title: 'پشتیبان‌گیری روزانه پایگاه داده روی سرور دوم',
    by: 'amir.hosseini',
    assignee: 'pouya.ghasemi',
    status: 'done',
  },
  {
    title: 'اتصال سامانه استعلام کد ملی',
    by: 'amir.hosseini',
    assignee: 'negar.rezaei',
    project: 'kyc',
    // Late on purpose: the CEO's dashboard shows this project at risk.
    dueIn: -2,
    weight: 4,
  },
  {
    title: 'کاهش مراحل احراز هویت از ۵ به ۳',
    by: 'amir.hosseini',
    assignee: 'kian.nouri',
    project: 'kyc',
    dueIn: 14,
  },
  {
    title: 'به‌روزرسانی گواهی امنیتی دامنه',
    by: 'pouya.ghasemi',
    assignee: 'pouya.ghasemi',
    dueIn: 3,
    priority: 'high',
  },
  { title: 'بازبینی کد ماژول برداشت', by: 'negar.rezaei', assignee: 'amir.hosseini', dueIn: 1 },
  { title: 'نوشتن تست بار برای ساعات اوج', by: 'mahsa.abbasi', assignee: 'mahsa.abbasi', dueIn: 8 },
  { title: 'جلسه برنامه‌ریزی اسپرینت بعد', by: 'kian.nouri', assignee: 'kian.nouri', dueIn: 4 },
  {
    title: 'مهاجرت لاگ‌ها به سرور داخلی',
    by: 'pouya.ghasemi',
    assignee: 'pouya.ghasemi',
    dueIn: 20,
  },
  {
    title: 'رفع هشدارهای امنیتی وابستگی‌ها',
    by: 'amir.hosseini',
    assignee: 'behrad.mousavi',
    status: 'done',
  },

  // ---------- مارکتینگ ----------
  {
    title: 'طراحی بنر جشنواره پاییز',
    by: 'elham.akbari',
    assignee: 'milad.rahimi',
    project: 'autumn',
    status: 'in_progress',
    dueIn: 2,
    priority: 'high',
    weight: 3,
  },
  {
    title: 'متن پیامک کمپین',
    by: 'elham.akbari',
    assignee: 'shiva.kazemi',
    project: 'autumn',
    dueIn: 3,
    comments: [{ by: 'shiva.kazemi', body: 'دو نسخه می‌نویسم تا تست A/B کنیم.' }],
  },
  {
    title: 'هماهنگی با اینفلوئنسرهای حوزه سرمایه‌گذاری',
    by: 'elham.akbari',
    assignee: 'arash.taheri',
    project: 'autumn',
    dueIn: 6,
  },
  {
    title: 'آماده‌سازی پشتیبانی برای حجم بالای کمپین',
    by: 'elham.akbari',
    assignee: 'maryam.ahmadi',
    project: 'autumn',
    dueIn: 10,
  },
  {
    title: 'تحلیل نتایج کمپین تابستان',
    by: 'elham.akbari',
    assignee: 'arash.taheri',
    status: 'done',
  },
  {
    title: 'مقاله «طلای آب‌شده یا سکه؟» برای بلاگ',
    by: 'shiva.kazemi',
    assignee: 'shiva.kazemi',
    status: 'in_progress',
    dueIn: 5,
  },
  {
    title: 'بودجه تبلیغات آبان',
    by: 'elham.akbari',
    assignee: 'elham.akbari',
    dueIn: 7,
    weight: 3,
  },
  {
    title: 'ویدئوی آموزشی خرید طلا در اپ',
    by: 'elham.akbari',
    assignee: 'milad.rahimi',
    dueIn: 12,
  },
  {
    title: 'گزارش هفتگی شبکه‌های اجتماعی',
    by: 'arash.taheri',
    assignee: 'arash.taheri',
    dueIn: -1,
  },
  {
    title: 'به‌روزرسانی صفحه فرود اپلیکیشن',
    by: 'elham.akbari',
    assignee: 'shiva.kazemi',
    dueIn: 9,
  },
  { title: 'خبرنامه ماهانه مشتریان', by: 'shiva.kazemi', assignee: 'shiva.kazemi', status: 'done' },
  {
    title: 'بررسی رقبا: کارمزد و کمپین‌ها',
    by: 'elham.akbari',
    assignee: 'arash.taheri',
    dueIn: 15,
  },

  // ---------- منابع انسانی ----------
  {
    title: 'آگهی استخدام توسعه‌دهنده بک‌اند',
    by: 'fatemeh.najafi',
    assignee: 'niloufar.sharifi',
    project: 'hiring',
    status: 'done',
  },
  {
    title: 'مصاحبه با نامزدهای پشتیبانی شیفت شب',
    by: 'fatemeh.najafi',
    assignee: 'niloufar.sharifi',
    project: 'hiring',
    dueIn: 2,
    status: 'in_progress',
  },
  {
    title: 'برنامه آشنایی نیروهای جدید',
    by: 'fatemeh.najafi',
    assignee: 'fatemeh.najafi',
    dueIn: 10,
  },
  { title: 'نظرسنجی رضایت کارکنان', by: 'fatemeh.najafi', assignee: 'niloufar.sharifi', dueIn: 18 },
  {
    title: 'به‌روزرسانی آیین‌نامه مرخصی',
    by: 'fatemeh.najafi',
    assignee: 'fatemeh.najafi',
    dueIn: 6,
    weight: 2,
  },
  {
    title: 'تعریف دسترسی‌های همکاران جدید در مدار',
    by: 'fatemeh.najafi',
    assignee: 'sina.moradi',
    dueIn: 1,
  },

  // ---------- مدیریت ارشد ----------
  {
    title: 'جلسه هیئت‌مدیره: گزارش فصل',
    by: 'reza.karimi',
    assignee: 'reza.karimi',
    dueIn: 5,
    priority: 'high',
  },
  { title: 'بررسی گزارش مالی مهر', by: 'reza.karimi', assignee: 'leila.sadeghi', dueIn: 3 },
  {
    title: 'تمدید مجوز فعالیت از بانک مرکزی',
    by: 'reza.karimi',
    assignee: 'leila.sadeghi',
    status: 'in_progress',
    dueIn: 20,
    priority: 'urgent',
  },
  { title: 'اهداف فصل زمستان', by: 'reza.karimi', assignee: 'reza.karimi', dueIn: 25 },
  {
    title: 'بازدید از دفتر پشتیبانی',
    by: 'leila.sadeghi',
    assignee: 'leila.sadeghi',
    status: 'done',
  },
  {
    title: 'جمع‌بندی پیشنهادهای کاهش هزینه سرور',
    by: 'leila.sadeghi',
    assignee: 'leila.sadeghi',
    dueIn: 8,
  },
];

/**
 * Finished work from earlier weeks, so the dashboards' «done per week» trend has a history:
 * per department, the head records routine tasks and the members finish them.
 */
export const SEED_HISTORY: Array<{ by: string; people: string[]; titles: string[] }> = [
  {
    by: 'maryam.ahmadi',
    people: ['ali.rezaei', 'zahra.mohammadi', 'hossein.yousefi'],
    titles: [
      'پاسخ به تیکت‌های صف',
      'پیگیری تراکنش ناموفق',
      'تماس با مشتری',
      'به‌روزرسانی پاسخ آماده',
    ],
  },
  {
    by: 'amir.hosseini',
    people: ['negar.rezaei', 'behrad.mousavi', 'sahar.jafari', 'pouya.ghasemi', 'mahsa.abbasi'],
    titles: ['رفع باگ', 'بازبینی کد', 'نوشتن تست', 'به‌روزرسانی وابستگی‌ها'],
  },
  {
    by: 'elham.akbari',
    people: ['arash.taheri', 'shiva.kazemi', 'milad.rahimi'],
    titles: ['انتشار پست', 'طراحی بنر', 'گزارش کمپین'],
  },
  {
    by: 'fatemeh.najafi',
    people: ['niloufar.sharifi'],
    titles: ['مصاحبه', 'به‌روزرسانی پرونده پرسنلی'],
  },
];
