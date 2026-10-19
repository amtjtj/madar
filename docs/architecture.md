# معماری مدار — پیش‌نویس برای بررسی

> وضعیت: **تایید شده** · تاریخ: ۲۵ مهر ۱۴۰۵ (2026-10-17) · تصمیم‌ها در بخش ۹ و `docs/decisions/` ثبت شده‌اند
> مرجع محدوده: `docs/brief.md` · قواعد: `CLAUDE.md`
>
> هر جا بین دو گزینه تصمیم لازم بود، گزینه‌ها با مزیت و عیب آمده‌اند و یکی با برچسب **پیشنهاد** مشخص شده است. فهرست کامل تصمیم‌هایی که منتظر تایید شماست در بخش ۹ آمده است.

---

## ۰. خلاصه در یک نگاه

| موضوع | پیشنهاد |
|---|---|
| جداسازی شرکت‌ها | یک دیتابیس و یک اسکیما، ستون `tenant_id` در همه جدول‌ها، RLS با `FORCE` و متغیر تراکنشی `app.tenant_id`؛ کلید خارجی مرکب `(tenant_id, id)` به‌عنوان لایه دوم |
| شناسه‌ها | UUIDv7 (ترتیب زمانی، بدون تداخل هنگام انتقال شرکت به دیتابیس اختصاصی) |
| هویت کاربر | هویت سراسری (Better Auth) + عضویت جدا برای هر شرکت (`members`)؛ ورود با نام کاربری و رمزی که ادمین می‌دهد، بعداً موبایل + کد پیامکی |
| ماژول دپارتمانی | یک «سند کانفیگ» نسخه‌دار JSONB که با Zod اعتبارسنجی می‌شود؛ ماژول‌های آماده فقط قالب‌های از پیش ساخته‌اند |
| دسترسی | RBAC با «دامنه» (کل شرکت / دپارتمان / زیرشاخه دپارتمان / فقط خودم)، تعریف‌شده در `packages/shared`، اعمال در API |
| رویدادهای دامنه | Transactional Outbox در Postgres + BullMQ؛ مصرف‌کننده‌های idempotent |
| گیمیفیکیشن | دفتر کل افزایشی (ledger) برای XP، جدول روزانه استریک با تقویم کاری و مرخصی، نشان مبتنی بر شمارنده |
| API | REST روی NestJS با قراردادهای Zod مشترک بین web و api |
| فایل‌ها | ذخیره‌ساز سازگار با S3 (MinIO در توسعه، ذخیره‌ساز ابری ایرانی در تولید)، مسیر با پیشوند شرکت |

---

## ۱. ساختار monorepo و مسئولیت هر پکیج

```
madar/
├─ apps/
│  ├─ web/          Next.js (App Router) — PWA، واکنش‌گرا، RTL
│  ├─ api/          NestJS — دو entrypoint: main.ts (HTTP + WebSocket) و worker.ts (BullMQ)
│  └─ ai/           Python/FastAPI — از فاز ۳
├─ packages/
│  ├─ db/           اسکیمای Drizzle، مایگریشن‌ها، سیاست‌های RLS، seed، کمک‌کننده withTenant، تست‌های RLS
│  ├─ shared/       اسکیماهای Zod، قراردادهای API، تعریف مجوزها و موتور can()، تعریف رویدادها،
│  │                اسکیمای کانفیگ دپارتمان و قالب‌های آماده، فرمول سطح/XP، ثابت‌ها
│  ├─ ui/           توکن‌ها، کامپوننت‌ها، فونت Vazirmatn، ابزار تاریخ شمسی و اعداد فارسی
│  ├─ i18n/         رشته‌های فارسی (کلیدها در کد، متن در فایل‌ها)
│  └─ config/       tsconfig، ESLint و Prettier مشترک (پکیج ابزاری، بدون کد اجرایی)
├─ docs/
│  ├─ brief.md, architecture.md
│  └─ decisions/    ADR ها
├─ docker/          docker-compose توسعه: postgres و redis (minio هنگام اضافه شدن فایل‌ها)
└─ turbo.json, pnpm-workspace.yaml
```

### مسئولیت‌ها و مرزها

| پکیج | چه چیزی داخلش هست | چه چیزی **نیست** | وابسته به |
|---|---|---|---|
| `apps/web` | صفحه‌ها، چیدمان هر نقش، نماهای اختصاصی ماژول‌ها (`src/modules/<key>/`)، TanStack Query برای Optimistic UI | منطق مجوز واقعی (فقط پنهان‌سازی UI)، دسترسی مستقیم به دیتابیس | shared، ui، i18n |
| `apps/api` | یک ماژول Nest برای هر دامنه (`tenancy`، `members`، `departments`، `tasks`، `goals`، `approvals`، `forms`، `metrics`، `notifications`، `gamification`، `audit`، `import`)، گیت‌وی WebSocket، کارگرهای BullMQ | دسترسی به دیتابیس بدون `withTenant` | db، shared |
| `packages/db` | تنها جایی که اتصال دیتابیس ساخته می‌شود | منطق کسب‌وکار | shared (فقط تایپ) |
| `packages/shared` | هرچه هم سرور و هم کلاینت لازم دارند | وابستگی به Node یا React | zod |
| `packages/ui` | کامپوننت‌های بدون داده (presentational) | فراخوانی API | i18n |

**قاعده‌های مرزی که با ESLint اجباری می‌شوند:**
- import مستقیم کلاینت خام دیتابیس خارج از `packages/db` ممنوع است؛ فقط `withTenant()` و `withPlatform()` (برای عملیات سطح پلتفرم) صادر می‌شوند.
- ماژول‌های Nest فقط از طریق «سرویس عمومی» یا رویداد با هم حرف می‌زنند (`no-restricted-imports` روی مسیرهای داخلی ماژول دیگر).
- در `apps/web/src/modules/<a>` import از `modules/<b>` ممنوع است.

### چرا worker جدا نیست؟

| گزینه | مزیت | عیب |
|---|---|---|
| `apps/worker` جدا | مرز روشن | کد سرویس‌ها و ماژول‌ها تکرار یا به پکیج دیگری منتقل می‌شود |
| **پیشنهاد:** همان کد api با entrypoint دوم (`worker.ts`) که در کانتینر جدا اجرا می‌شود | یک کد، یک DI، مقیاس‌پذیری جدا در تولید | باید مراقب بود ماژول‌های HTTP در worker بالا نیایند |

### ارتباط web و api و احراز هویت

- یک reverse proxy (Caddy) روی یک دامنه: `app.example.ir/` → web و `app.example.ir/api/*` → api. نتیجه: کوکی first-party، بدون CORS.
- Better Auth **داخل api** اجرا می‌شود (handler روی مسیر `/api/auth/*`)، تا یک منبع حقیقت برای نشست داشته باشیم. web در middleware فقط وجود نشست را با یک فراخوانی سبک چک می‌کند.
- قرارداد API: اسکیماهای Zod در `packages/shared/contracts`؛ کنترلرهای Nest آن‌ها را برای اعتبارسنجی و web برای کلاینت تایپ‌دار استفاده می‌کند. انتخاب کتابخانه اتصال (ts-rest یا nestjs-zod + تولید OpenAPI) در قدم ۲ با بررسی مستندات روز تثبیت و در ADR ثبت می‌شود.

| گزینه سبک API | مزیت | عیب |
|---|---|---|
| **پیشنهاد:** REST + قرارداد Zod مشترک | ساده، قابل کش، مناسب کلاینت‌های آینده (اپ native، یکپارچه‌سازی مشتری) | کمی کد بیشتر از tRPC |
| tRPC | تایپ سرتاسری بی‌دردسر | با NestJS جفت طبیعی ندارد؛ برای API عمومی آینده مناسب نیست |
| GraphQL | انعطاف کوئری داشبوردها | پیچیدگی، کش سخت، سطح حمله بزرگ‌تر |

---

## ۲. مدل داده هسته و جداسازی شرکت‌ها با RLS

### ۲.۱ دو صفحه داده: کنترل و داده

| صفحه | جدول‌ها | `tenant_id` دارد؟ |
|---|---|---|
| **کنترل (control plane)** | `tenants`، `tenant_routes`، `users`، `sessions`، `accounts`، `verifications`، `two_factors`، `platform_admins` | خیر |
| **داده (data plane)** | همه جدول‌های دیگر | **بله، بدون استثنا** — حتی جدول‌های واسط |

این تقسیم برای «انتقال مشتری بزرگ به دیتابیس اختصاصی» طراحی شده: صفحه کنترل مشترک می‌ماند و برای انتقال، همه سطرهای صفحه داده با `WHERE tenant_id = X` کپی می‌شوند. چون شناسه‌ها UUIDv7 هستند تداخلی پیش نمی‌آید. `tenant_routes` مشخص می‌کند داده هر شرکت روی کدام کلاستر است؛ از روز اول همه کد از `getPoolForTenant(tenantId)` اتصال می‌گیرد که فعلاً همیشه یک pool برمی‌گرداند.

### ۲.۲ نقش‌های دیتابیس

```sql
-- مالک اسکیما، فقط برای مایگریشن
CREATE ROLE madar_owner LOGIN;
-- API و worker؛ مالک جدول‌ها نیست و BYPASSRLS ندارد
CREATE ROLE madar_app LOGIN NOBYPASSRLS;
-- فقط جدول‌های Better Auth
CREATE ROLE madar_auth LOGIN NOBYPASSRLS;
```

### ۲.۳ سازوکار RLS

```sql
CREATE SCHEMA app;

CREATE FUNCTION app.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

-- الگوی تکرارشونده برای هر جدول صفحه داده (با یک helper در مایگریشن‌ها تولید می‌شود)
CREATE TABLE tasks (
  id         uuid PRIMARY KEY,
  tenant_id  uuid NOT NULL DEFAULT app.current_tenant_id() REFERENCES tenants(id),
  ...
  UNIQUE (tenant_id, id)
);
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tasks
  USING      (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
```

**جریان هر درخواست:**

1. Guard احراز هویت نشست را از Better Auth می‌خواند → `user_id` و `active_tenant_id`.
2. Guard شرکت بررسی می‌کند کاربر عضو فعال آن شرکت است و شرکت قفل نیست؛ `TenantContext { tenantId, memberId, permissions }` در AsyncLocalStorage (nestjs-cls) ذخیره می‌شود.
3. هر دسترسی به دیتابیس از `withTenant(fn)` می‌گذرد:
   ```ts
   await db.transaction(async (tx) => {
     await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true),
                                 set_config('app.member_id', ${memberId}, true)`);
     return fn(tx);
   });
   ```
   پارامتر سوم `true` یعنی مقدار فقط تا پایان تراکنش زنده است → با PgBouncer در حالت transaction سازگار است و هیچ‌وقت به درخواست بعدی نشت نمی‌کند.
4. اگر کسی فراموش کند tenant را تنظیم کند، `current_tenant_id()` برابر `NULL` است و **هیچ سطری** برنمی‌گردد و هیچ insert ای رد نمی‌شود (fail closed).

**لایه‌های دفاعی اضافه:**

- **کلید خارجی مرکب:** `FOREIGN KEY (tenant_id, project_id) REFERENCES projects (tenant_id, id)`؛ حتی با باگ در کد، یک تسک نمی‌تواند به پروژه شرکت دیگر اشاره کند.
- **همه ایندکس‌ها با `tenant_id` شروع می‌شوند**، که هم کارایی RLS را تضمین می‌کند و هم برای انتقال مفید است.
- **Redis:** کلیدها فقط از طریق `tenantKey(tenantId, ...)` ساخته می‌شوند (`t:{tenantId}:...`)؛ کلید خام ممنوع (قاعده lint).
- **BullMQ:** هر job در payload خود `tenantId` دارد؛ پایه کلاس worker قبل از اجرای handler، `withTenant` را باز می‌کند. job بدون tenant رد می‌شود.
- **فایل‌ها:** کلید شیء همیشه `tenants/{tenantId}/{yyyy}/{mm}/{uuid}`؛ دانلود فقط با URL امضاشده کوتاه‌مدت پس از چک مجوز.
- **WebSocket:** اتاق‌ها `tenant:{id}:member:{id}` و `tenant:{id}:dept:{id}`؛ پیوستن به اتاق فقط در سرور بعد از چک مجوز.
- **AI (فاز ۳):** جدول‌های embedding هم `tenant_id` و RLS دارند؛ سرویس AI با همان سازوکار `set_config` کوئری می‌زند.

**عملیات بین‌شرکتی کنترل‌شده** (ثبت‌نام شرکت، فهرست شرکت‌های یک کاربر هنگام ورود، پنل ادمین پلتفرم) فقط از طریق تابع‌های `SECURITY DEFINER` محدود با خروجی حداقلی انجام می‌شود، مثلاً `app.list_memberships(user_id)` که فقط `tenant_id, tenant_name, member_status` برمی‌گرداند.

### ۲.۴ تست‌های RLS

1. **تست هر جدول:** helper `expectTenantIsolation(table, factory)` دو شرکت می‌سازد و ثابت می‌کند شرکت الف نمی‌تواند سطر شرکت ب را SELECT، UPDATE، DELETE کند یا با `tenant_id` ب INSERT کند.
2. **تست متا (نگهبان فراموشی):** با کوئری روی `pg_catalog` بررسی می‌شود هر جدولی که ستون `tenant_id` دارد `relrowsecurity` و `relforcerowsecurity` فعال و حداقل یک policy دارد، و هر جدول صفحه داده که در فهرست استثنا نیست ستون `tenant_id` دارد. اگر کسی جدول جدیدی بدون RLS بسازد، CI قرمز می‌شود.
3. تست‌ها روی Postgres واقعی (کانتینر docker-compose یا Testcontainers) با نقش `madar_app` اجرا می‌شوند، نه با نقش مالک.

### ۲.۵ جدول‌های هسته

> قرارداد مشترک همه جدول‌های صفحه داده: `id uuid` (v7)، `tenant_id`، `created_at`، `updated_at` (timestamptz، UTC)، و در صورت نیاز `created_by` (member_id)، `deleted_at` (حذف نرم)، `version int` (کنترل هم‌زمانی خوش‌بینانه).

**سازمان و افراد**

| جدول | ستون‌های کلیدی | توضیح |
|---|---|---|
| `tenants` *(کنترل)* | `name`، `slug`، `status` (`active`/`read_only`/`locked`/`closing`)، `plan`، `timezone` (پیش‌فرض `Asia/Tehran`)، `week_start` (شنبه)، `settings jsonb` | |
| `users` *(کنترل)* | `username` (یکتا، حروف کوچک)، `email?`، `phone?`، `name`، `must_change_password`، `two_factor_enabled` | Better Auth (plugin نام کاربری)؛ `phone` از الان هست تا ورود پیامکی بعداً بدون مایگریشن سنگین اضافه شود |
| `members` | `user_id`، `display_name`، `avatar_key`، `title`، `manager_id` → members، `status` (`invited`/`active`/`suspended`/`left`)، `employment_type`، `joined_at` | هر فرد در هر شرکت؛ `manager_id` خط گزارش‌دهی چارت |
| `departments` | `parent_id` → departments، `name`، `module_config_id`، `head_member_id`، `color`، `icon`، `sort` | درخت دپارتمان‌ها (ltree یا `path` برای کوئری زیرشاخه) |
| `department_memberships` | `department_id`، `member_id`، `dept_role` (`head`/`manager`/`member`/`viewer`)، `is_primary` | یک نفر می‌تواند در چند دپارتمان باشد |
| `roles` | `key`، `name`، `is_system` | نقش‌های سطح شرکت |
| `role_grants` | `role_id`، `permission`، `scope` | بخش ۴ |
| `member_roles` | `member_id`، `role_id` | |
| `invitations` | `email`/`phone`، `token_hash`، `role_id`، `department_id`، `expires_at`، `accepted_at`، `invited_by` | **بعد از MVP**؛ در MVP ادمین حساب را مستقیم می‌سازد (ADR 0003) |
| `work_calendars` | `weekly_off_days`، `holidays jsonb`، `working_hours` | برای استریک و ساعت سکوت |
| `leaves` | `member_id`، `from`، `to`، `kind`، `approval_request_id` | از ماژول منابع انسانی |

**کار**

| جدول | ستون‌های کلیدی | توضیح |
|---|---|---|
| `projects` | `department_id?`، `type_key`، `name`، `status_category`، `owner_id`، `visibility` (`department`/`tenant`/`private`)، `start_at`، `due_at`، `key_result_id?`، `fields jsonb` | «کمپین» در مارکتینگ یا «ریلیز» در فنی همان project با `type_key` متفاوت است |
| `project_members` | `project_id`، `member_id`، `role` | برای پروژه‌های بین‌دپارتمانی و خصوصی |
| `tasks` | `department_id`، `project_id?`، `parent_id?`، `cycle_id?`، `type_key`، `status_key`، `status_category` (`todo`/`in_progress`/`done`/`canceled`)، `priority`، `title`، `description jsonb`، `assignee_id`، `reporter_id`، `start_at`، `due_at`، `completed_at`، `weight` (۱..۵، تعیین‌شده توسط مدیر)، `fields jsonb`، `sort_key` (fractional index)، `search tsvector`، `key_result_id?`، `version` | تیکت، باگ، محتوا، مصوبه... همه tasks هستند. جلسه از فاز ۲الف موجودیت جدا دارد (بخش ۱۰) |
| `task_collaborators` | `task_id`، `member_id`، `kind` (`collaborator`/`watcher`) | مسئول اصلی همیشه یک نفر (`assignee_id`) است تا «کار مال کیست» مبهم نباشد |
| `task_links` | `from_task_id`، `to_task_id`، `kind` (`blocks`/`relates`/`duplicates`/`converted_from`) | تبدیل تیکت به باگ |
| `cycles` | `department_id`، `name`، `start_at`، `end_at`، `goal` | اسپرینت به‌صورت مفهوم عمومی هسته؛ هر تیمی می‌تواند استفاده کند |
| `daily_plan_items` | `member_id`، `date` (روز محلی شرکت)، `task_id` | «امروز چه کار کنم» و مبنای استریک |
| `comments` | `subject_type`، `subject_id`، `body jsonb`، `author_id`، `mentions uuid[]` | چندریختی؛ یکپارچگی با تریگر چک می‌شود |
| `attachments` | `subject_type`، `subject_id`، `object_key`، `file_name`، `mime`، `size`، `checksum`، `scan_status` | |
| `activities` | `subject_type`، `subject_id`، `actor_id`، `verb`، `diff jsonb` | تاریخچه قابل‌دیدن برای کاربر (با AuditLog فرق دارد) |

**هدف**

| جدول | ستون‌های کلیدی | توضیح |
|---|---|---|
| `goal_periods` | `name` (مثلاً «پاییز ۱۴۰۵»)، `start_at`، `end_at` | فصل‌ها به تقویم شمسی |
| `goals` | `period_id`، `level` (`company`/`department`/`individual`)، `department_id?`، `owner_id`، `parent_goal_id?`، `title`، `status`، `progress` (محاسبه‌ای، کش) | سه‌سطحی با زنجیره هم‌راستایی |
| `key_results` | `goal_id`، `title`، `kind` (`number`/`percent`/`boolean`/`milestone`/`metric`)، `start_value`، `target_value`، `current_value`، `unit`، `metric_key?`، `weight` | `kind=metric` یعنی از شاخص خودکار تغذیه می‌شود |
| `key_result_checkins` | `key_result_id`، `value`، `confidence`، `note`، `author_id` | |

**درخواست و تایید**

| جدول | ستون‌های کلیدی | توضیح |
|---|---|---|
| `module_configs` | `department_id?`، `template_key`، `template_version`، `version`، `config jsonb`، `is_active` | بخش ۳؛ هر تغییر نسخه جدید می‌سازد |
| `form_submissions` | `department_id`، `form_key`، `config_version`، `data jsonb`، `submitted_by`، `task_id?` | درخواست هزینه، مرخصی، درخواست طراحی... |
| `approval_requests` | `department_id`، `flow_key`، `config_version`، `subject_type`، `subject_id`، `requester_id`، `status` (`pending`/`approved`/`rejected`/`canceled`)، `current_step`، `snapshot jsonb` | snapshot مراحل در لحظه ثبت تا تغییر کانفیگ روی درخواست‌های باز اثر نگذارد |
| `approval_steps` | `request_id`، `step_index`، `approver_member_id`، `decision`، `comment`، `decided_at` | فقط افزودنی |

**شاخص، اعلان، ممیزی، رویداد**

| جدول | ستون‌های کلیدی | توضیح |
|---|---|---|
| `metric_snapshots` | `department_id?`، `metric_key`، `date`، `value` | پر شده توسط job شبانه برای نمودار روند |
| `metric_manual_values` | `metric_key`، `date`، `value`، `author_id` | شاخص‌هایی که خارج از سیستم‌اند (مثلاً هزینه جذب) |
| `notifications` | `recipient_id`، `kind`، `payload jsonb`، `read_at`، `deliver_after` | `deliver_after` برای احترام به ساعت سکوت |
| `notification_preferences` | `member_id`، `channels jsonb`، `quiet_hours` | پیش‌فرض: خاموش خارج از ساعت کاری |
| `audit_logs` | `actor_member_id`، `actor_user_id`، `action`، `subject_type`، `subject_id`، `before jsonb`، `after jsonb`، `ip`، `user_agent`، `prev_hash`، `hash` | فقط افزودنی؛ پارتیشن ماهانه |
| `domain_events` | `type`، `version`، `payload jsonb`، `actor_id`، `occurred_at`، `published_at` | outbox؛ بخش ۵ |
| `processed_events` | `consumer`، `event_id` | idempotency |
| `data_exports` | `requested_by`، `status`، `object_key`، `expires_at` | خروجی کامل داده شرکت |

**AuditLog غیرقابل تغییر:**
- `REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM madar_app;`
- زنجیره هش برای هر شرکت: `hash = sha256(prev_hash || canonical_json(row))`، درج از طریق تابعی که با advisory lock روی tenant ترتیب را تضمین می‌کند. هر دستکاری مستقیم (حتی توسط DBA) با بررسی زنجیره آشکار می‌شود.
- در فازهای بعد: کپی دوره‌ای به ذخیره‌ساز WORM.

**تعلیق شرکت:** `tenants.status`. Guard در API برای `read_only` همه متدهای نوشتنی را رد می‌کند و برای `locked` فقط صفحه پرداخت/خروجی داده را مجاز می‌کند. داده دست نمی‌خورد.

**جست‌وجوی فارسی:** Postgres stemmer فارسی ندارد. پیشنهاد MVP: نرمال‌سازی (ي→ی، ك→ک، حذف اعراب، یکسان‌سازی نیم‌فاصله و اعداد) در یک تابع SQL + `pg_trgm` برای جست‌وجوی تقریبی + `tsvector` با پیکربندی `simple`. اگر کافی نبود، Meilisearch self-hosted (تصمیم بعدی).

---

## ۳. «قالب دپارتمان»

### ۳.۱ ایده

ماژول دپارتمانی = **یک سند کانفیگ** روی موجودیت‌های هسته. موتور هسته (tasks، forms، approvals، metrics، dashboard) این سند را می‌خواند و رفتار را می‌سازد. ماژول‌های آماده (پشتیبانی، مارکتینگ، فنی، مدیریت ارشد) فقط **قالب‌های از پیش نوشته‌شده** از همین سند هستند، به‌علاوه تعداد کمی «نمای اختصاصی» ثبت‌شده در web.

```
قالب (کد، نسخه‌دار، در packages/shared/templates)
     │  کپی هنگام ساخت دپارتمان
     ▼
module_configs (داده شرکت، قابل ویرایش توسط ادمین، نسخه‌دار)
     │  خوانده می‌شود توسط
     ▼
موتور هسته: tasks · forms · approvals · metrics · dashboard · views
```

### ۳.۲ اسکیمای کانفیگ (Zod در `packages/shared/module-config`)

```ts
const ModuleConfig = z.object({
  schemaVersion: z.literal(1),
  vocabulary: z.object({            // واژگان دپارتمان
    task: z.string(),               // «تیکت»، «محتوا»، «تسک»
    taskPlural: z.string(),
    project: z.string(),            // «کمپین»، «ریلیز»، «پروژه»
    projectPlural: z.string(),
  }),
  fields: z.array(FieldDef),        // فیلدهای سفارشی قابل استفاده در انواع کار و فرم‌ها
  workflows: z.array(WorkflowDef),  // وضعیت‌ها و انتقال‌ها
  workItemTypes: z.array(WorkItemTypeDef),
  projectTypes: z.array(ProjectTypeDef),
  forms: z.array(FormDef),
  approvalFlows: z.array(ApprovalFlowDef),
  metrics: z.array(MetricDef),
  dashboard: DashboardDef,
  views: z.array(ViewDef),
  automations: z.array(AutomationDef).default([]),   // MVP: مجموعه کوچک و بسته
  xp: z.object({ defaultWeight: z.number().int().min(1).max(5) }).optional(),
});

const FieldDef = z.object({
  key: Slug,                        // تغییرناپذیر پس از ساخت
  label: z.string(),
  type: z.enum(['text','longtext','number','money','date','datetime','select',
                'multiselect','member','department','customer','url','file','rating','boolean']),
  required: z.boolean().default(false),
  options: z.array(z.object({ key: Slug, label: z.string(), color: Token.optional() })).optional(),
});

const WorkflowDef = z.object({
  key: Slug,
  statuses: z.array(z.object({
    key: Slug, label: z.string(),
    category: z.enum(['todo','in_progress','done','canceled']),
    color: Token,
  })),
  transitions: z.array(z.object({
    from: Slug.or(z.literal('*')), to: Slug,
    requiresApproval: Slug.optional(),   // کلید approvalFlow
    allowedDeptRoles: z.array(DeptRole).optional(),
  })).optional(),                         // نبود = همه انتقال‌ها آزاد
});

const WorkItemTypeDef = z.object({
  key: Slug, label: z.string(), icon: IconKey,
  workflow: Slug, fields: z.array(Slug), defaultWeight: z.number().int().min(1).max(5).optional(),
  sla: z.object({ firstResponseMinutes: z.number(), resolveMinutes: z.number() }).optional(),
});

const ApprovalFlowDef = z.object({
  key: Slug, label: z.string(),
  steps: z.array(z.object({
    approver: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('requesterManager') }),
      z.object({ kind: z.literal('departmentHead'), department: z.enum(['own']).or(DepartmentRef) }),
      z.object({ kind: z.literal('role'), role: Slug }),
      z.object({ kind: z.literal('member'), memberId: z.string().uuid() }),
    ]),
    when: Condition.optional(),            // مثلاً amount > 50_000_000
  })),
});

const MetricDef = z.object({
  key: Slug, label: z.string(), unit: z.string().optional(),
  direction: z.enum(['up_is_good','down_is_good']),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('count'), filter: TaskFilter }),            // تیکت باز
    z.object({ kind: z.literal('duration'), from: TimeAnchor, to: TimeAnchor,
               agg: z.enum(['avg','p50','p90']), filter: TaskFilter }),   // زمان پاسخ
    z.object({ kind: z.literal('sum'), field: Slug, filter: TaskFilter }),// بودجه مصرف‌شده
    z.object({ kind: z.literal('ratio'), numerator: Slug, denominator: Slug }),
    z.object({ kind: z.literal('manual') }),                               // هزینه جذب
  ]),
  target: z.number().optional(),
});
```

`TaskFilter` یک زبان کوچک و بسته است (نوع کار، دسته وضعیت، بازه زمانی، مقدار فیلد) که در API به SQL امن تبدیل می‌شود؛ هیچ‌وقت SQL خام از کانفیگ اجرا نمی‌شود.

### ۳.۳ قاعده‌های مهم

- **کلیدها تغییرناپذیرند.** برچسب قابل تغییر است، کلید نه. سطرهای `tasks` فقط `type_key` و `status_key` ذخیره می‌کنند به‌علاوه `status_category` دنرمال‌شده، تا گزارش‌های بین‌دپارتمانی (مثلاً «کارهای باز کل شرکت») بدون فهمیدن کانفیگ هر دپارتمان کار کنند.
- **حذف وضعیت یا فیلد** فقط با «نگاشت» مجاز است (سطرهای موجود به وضعیت دیگر منتقل می‌شوند)؛ ویرایشگر UI این را اجباری می‌کند.
- **نسخه‌گذاری:** هر ذخیره، یک سطر جدید `module_configs` با `version+1`. درخواست‌های تایید باز روی snapshot خودشان ادامه می‌دهند.
- **متن کانفیگ:** قالب‌های آماده در کد به کلیدهای i18n اشاره می‌کنند؛ هنگام ساخت دپارتمان متن فارسی حل‌شده در کانفیگ شرکت کپی می‌شود چون از آن لحظه «داده شرکت» است و ادمین می‌تواند تغییرش دهد. (چندزبانگی خارج از MVP است؛ اگر بعداً لازم شد، فیلدهای برچسب به نقشه `{fa, en}` ارتقا می‌یابند.)
- **ارتقای قالب:** وقتی قالب آماده نسخه جدید می‌گیرد، به ادمین یک diff پیشنهاد می‌شود؛ خودکار اعمال نمی‌شود. (پیاده‌سازی بعد از MVP؛ `template_version` از الان ذخیره می‌شود.)
- **اول کانفیگ، بعد جدول.** جدول اختصاصی ماژول فقط وقتی مجاز است که داده واقعاً به هیچ موجودیت هسته نخورد (مثلاً `canned_responses` پشتیبانی) و همان قواعد RLS را دارد. هر مورد یک ADR.

### ۳.۴ نماهای اختصاصی

قالب می‌تواند به نمای ثبت‌شده در web اشاره کند: `views: [{ kind: 'custom', component: 'support.inbox' }]`. web یک رجیستری دارد (`apps/web/src/modules/registry.ts`). نماهای عمومی که هر دپارتمانی می‌تواند استفاده کند: `list`، `kanban`، `calendar`، `table`، `timeline`.

### ۳.۵ ماژول‌های کامل MVP روی این طرح

| ماژول | انواع کار | گردش کار | فرم و تایید | شاخص‌ها | نمای اختصاصی / جدول اضافه |
|---|---|---|---|---|---|
| **مدیریت ارشد** | `meeting`، `resolution` (مصوبه، فرزند جلسه)، `task` | باز ← در حال اجرا ← انجام‌شده | تایید درخواست‌های ارجاعی سایر دپارتمان‌ها | پیشرفت OKR شرکت، گلوگاه‌ها (کارهای عقب‌افتاده به تفکیک دپارتمان) | `executive.home` (داشبورد ۳۰ ثانیه‌ای) — بدون جدول جدید |
| **پشتیبانی** | `ticket` (فیلد: کانال، مشتری، دسته، اولویت؛ SLA) | جدید ← باز ← منتظر مشتری ← حل‌شده ← بسته | — | زمان اولین پاسخ، تیکت باز، تیکت بحرانی، رضایت | `support.inbox`؛ جدول `canned_responses`؛ مشتری فعلاً فیلد متنی، موجودیت `customers` بعد از MVP |
| **مارکتینگ** | `content` (کانال، تاریخ انتشار)، `task`؛ نوع پروژه `campaign` (بودجه، کانال، هدف) | ایده ← پیش‌نویس ← در انتظار تایید ← زمان‌بندی‌شده ← منتشرشده | «تایید محتوا» (مدیر برند)؛ «درخواست بودجه تبلیغات» → گردش تایید مالی | محتوای منتشرشده، بودجه مصرفی/مصوب، لید (دستی)، هزینه جذب (دستی) | `marketing.contentCalendar` — بدون جدول جدید |
| **فنی (محصول + مهندسی)** | `story`، `bug`، `task`، `roadmap_item`؛ نوع پروژه `release` | بک‌لاگ ← آماده ← در حال انجام ← بازبینی ← انجام‌شده | — | سرعت تیم (بر اساس `cycles`)، تحویل به‌موقع، باگ باز | `engineering.board` (کانبان + cycle)؛ از `cycles` هسته |

ماژول‌های سبک (فروش، منابع انسانی، مالی، انطباق) فقط قالب‌اند، بدون نمای اختصاصی. مثلاً منابع انسانی: فرم «مرخصی» با تایید `requesterManager` که پس از تایید یک سطر `leaves` می‌سازد (از طریق اتوماسیون بسته `onApproved: createLeave`).

---

## ۴. مدل نقش و دسترسی

### ۴.۱ سه سطح

| سطح | منبع | نمونه |
|---|---|---|
| **پلتفرم** | `platform_admins` (صفحه کنترل) | تیم ما؛ هیچ دسترسی پیش‌فرضی به داده شرکت ندارد، دسترسی پشتیبانی فقط با «اجازه موقت» ثبت‌شده در AuditLog |
| **شرکت** | `member_roles` → `roles` → `role_grants` | `owner`، `admin`، `executive` (مدیرعامل/هیئت‌مدیره: دید کل شرکت)، `hr_manager`، `finance_approver`، `member` |
| **دپارتمان** | `department_memberships.dept_role` | `head`، `manager`، `member`، `viewer` |
| **منبع** | مالکیت و مشارکت | سازنده، مسئول، همکار، عضو پروژه |

### ۴.۲ مجوز = عمل + دامنه

```ts
// packages/shared/permissions.ts
export const PERMISSIONS = {
  'task.read': {}, 'task.create': {}, 'task.update': {}, 'task.assign': {}, 'task.set_weight': {},
  'project.manage': {}, 'goal.manage': {}, 'approval.decide': {},
  'member.invite': {}, 'member.change_role': {}, 'department.configure': {},
  'audit.read': {}, 'data.export': {}, 'tenant.billing': {}, ...
} as const;

type Scope = 'tenant' | 'department_tree' | 'department' | 'own';
```

- `role_grants(role_id, permission, scope)`: مثلاً `executive` → `task.read:tenant`، `member` → `task.update:own`.
- `dept_role` ها مجوزهای ثابتی در دامنه همان دپارتمان می‌دهند (در کد تعریف شده): `manager` → `task.assign:department`، `task.set_weight:department`، `approval.decide` برای گام‌هایی که به او ارجاع شده.
- **موتور:** دو تابع خالص در `shared`:
  - `can(actor, permission, resource)` → boolean، برای چک یک منبع (در API و برای پنهان‌سازی UI).
  - در `packages/db`: `scopeFilter(actor, permission, table)` → شرط Drizzle برای کوئری‌های فهرستی (`department_id IN (...)` یا `assignee_id = me`).
- **دیدپذیری در شرکت (تصمیم‌شده، ADR 0005):** هر کس فقط داده دپارتمان(های) خودش را می‌بیند؛ افراد درگیر (مسئول، همکار، عضو پروژه) همیشه آن کار را می‌بینند؛ پروژه با `visibility=tenant` برای همه قابل دیدن است.
- **دپارتمان‌های ناظر:** دپارتمانی مثل مدیریت ارشد یا منابع انسانی تنظیم `oversight` دارد که به اعضایش دید کل شرکت روی **منابع مشخص** می‌دهد:
  - مدیریت ارشد: `task`، `project`، `goal`، `metric`، `approval` (فقط خواندن) در کل شرکت.
  - منابع انسانی: `member`، `department`، `leave`، چارت سازمانی در کل شرکت؛ **نه** محتوای کار دپارتمان‌های دیگر.
  - این تنظیم را فقط `owner` تغییر می‌دهد و هر تغییرش در AuditLog ثبت می‌شود. در `scopeFilter` به‌صورت دامنه `tenant` برای همان منابع ترجمه می‌شود.
- **ورود دومرحله‌ای:** برای اعضای دارای نقش `owner` یا `admin` اجباری است (TOTP با اپ‌هایی مثل Google Authenticator، بدون نیاز به اینترنت خارجی)؛ اگر فعال نباشد، نشست فقط به صفحه فعال‌سازی 2FA دسترسی دارد.
- **حساب‌سازی توسط ادمین:** ادمین برای هر عضو نام کاربری و رمز اولیه می‌سازد؛ در اولین ورود تغییر رمز اجباری است؛ ادمین می‌تواند رمز را بازنشانی کند (ثبت در AuditLog). تلاش ناموفق ورود محدودیت نرخ و قفل موقت دارد.
- **هر تغییر در `member_roles`، `role_grants`، `department_memberships`** یک رکورد AuditLog می‌سازد (در همان تراکنش).

| گزینه موتور مجوز | مزیت | عیب |
|---|---|---|
| **پیشنهاد:** موتور کوچک خودمان (RBAC + دامنه) | کاملاً قابل فهم، تولید مستقیم شرط SQL برای فهرست‌ها، بدون وابستگی | باید خودمان تست کنیم |
| CASL | ایزومورفیک و جاافتاده | تبدیل شرط به Drizzle آماده ندارد؛ برای فهرست‌ها باز هم کد خودمان لازم است |
| RLS برای مجوزهای درون‌شرکتی هم | دفاع در عمق | پیچیدگی و کندی زیاد، دیباگ سخت؛ RLS را برای جداسازی شرکت‌ها نگه می‌داریم |

نقش‌های سفارشی (ساخت نقش جدید از UI) بعد از MVP؛ ساختار جدول از الان آن را پشتیبانی می‌کند.

---

## ۵. رویدادهای دامنه بین ماژول‌ها

### ۵.۱ سازوکار

| گزینه | مزیت | عیب |
|---|---|---|
| EventEmitter درون‌پردازه‌ای | ساده‌ترین | با crash رویداد گم می‌شود؛ با چند نمونه API کار نمی‌کند |
| Postgres LISTEN/NOTIFY | بدون زیرساخت جدید | تضمین تحویل ندارد |
| Kafka / NATS | مقیاس بالا | زیرساخت سنگین برای MVP |
| **پیشنهاد:** Transactional Outbox + BullMQ | رویداد دقیقاً هم‌زمان با تغییر داده commit می‌شود؛ تحویل حداقل یک‌بار با تکرار؛ Redis را که داریم استفاده می‌کند | باید مصرف‌کننده‌ها idempotent باشند |

**جریان:**
1. سرویس در همان تراکنش `withTenant` تغییر داده را انجام می‌دهد و `emit(event)` یک سطر در `domain_events` می‌نویسد.
2. relay در worker سطرهای منتشرنشده را (با `FOR UPDATE SKIP LOCKED`) برمی‌دارد و برای هر مصرف‌کننده ثبت‌شده یک job در BullMQ می‌گذارد، سپس `published_at` را پر می‌کند.
3. مصرف‌کننده در `withTenant(event.tenantId)` اجرا می‌شود و با `processed_events(consumer, event_id)` از اجرای دوباره جلوگیری می‌کند.

### ۵.۲ تعریف رویدادها

در `packages/shared/events.ts` با Zod و نسخه: `{ type: 'task.completed', version: 1, tenantId, actorId, occurredAt, payload }`.

رویدادهای MVP: `member.joined`، `member.role_changed`، `task.created`، `task.assigned`، `task.status_changed`، `task.completed`، `task.reopened`، `task.converted`، `comment.created`، `approval.requested`، `approval.step_decided`، `approval.completed`، `form.submitted`، `goal.checked_in`، `kudos.given`، `leave.approved`، `daily_plan.completed`.

مصرف‌کننده‌های عمومی: اعلان‌ها، گیمیفیکیشن، ارسال realtime به WebSocket، به‌روزرسانی کش شاخص‌ها، (فاز ۳) ایندکس AI.

> AuditLog **از طریق رویداد نوشته نمی‌شود**؛ هم‌زمان و در همان تراکنش نوشته می‌شود تا هیچ عمل حساسی بدون ثبت commit نشود.

### ۵.۳ مثال: تیکت پشتیبانی → باگ فنی

1. کارشناس پشتیبانی روی تیکت «تبدیل به باگ فنی» را می‌زند. این یک **فرمان هسته** است (`tasks.convert`)، نه کد ماژول پشتیبانی که ماژول فنی را صدا بزند.
2. هسته در یک تراکنش: تسک جدید در دپارتمان فنی با `type_key=bug` و فیلدهای نگاشت‌شده می‌سازد، `task_links(kind=converted_from)` ثبت می‌کند و رویداد `task.converted` منتشر می‌کند. تیکت به وضعیت «منتظر تیم فنی» می‌رود.
3. وقتی باگ به `status_category=done` رسید، `task.completed` منتشر می‌شود. اتوماسیون بسته هسته `linkedTaskCompleted` (که در کانفیگ پشتیبانی فعال شده) تیکت مرتبط را به «آماده پاسخ به مشتری» می‌برد و به مسئول تیکت اعلان می‌دهد.

### ۵.۴ مثال: درخواست بودجه مارکتینگ → تایید مالی

فرم `ad_budget_request` در کانفیگ مارکتینگ به `approvalFlow` با گام‌های `departmentHead(own)` و سپس `departmentHead(finance)` با شرط `amount > X` اشاره می‌کند. پس از `approval.completed` با نتیجه تایید، فیلد بودجه کمپین به‌روز و شاخص «بودجه مصوب» دوباره محاسبه می‌شود.

---

## ۶. ساختار داده گیمیفیکیشن

| جدول | ستون‌ها | توضیح |
|---|---|---|
| `gamification_settings` | `xp_rules jsonb`، `kudos_per_week`، `enabled_mechanics` | یک سطر برای هر شرکت |
| `xp_ledger` | `member_id`، `amount` (می‌تواند منفی باشد)، `reason` (`task_completed`/`on_time_bonus`/`helped`/`report_on_time`/`kudos_received`/`reversal`)، `source_event_id` (UNIQUE با reason)، `task_id?`، `created_at` | دفتر کل افزایشی؛ هیچ‌وقت ویرایش نمی‌شود؛ بازگشایی تسک = سطر معکوس |
| `member_stats` | `member_id`، `xp_total`، `level`، `current_streak`، `longest_streak`، `streak_updated_for` | کش قابل بازسازی از ledger |
| `streak_days` | `member_id`، `date`، `status` (`completed`/`missed`/`excused_holiday`/`excused_leave`/`off_day`) | استریک قابل ممیزی و قابل محاسبه مجدد |
| `badge_definitions` | `key`، `name`، `icon`، `criteria jsonb` (`{counter: 'tickets_resolved', gte: 100}`)، `is_system` | نشان‌های آماده در کد seed می‌شوند؛ نشان سفارشی بعد از MVP |
| `member_counters` | `member_id`، `counter_key`، `value` | پیشرفت به سمت نشان |
| `member_badges` | `member_id`، `badge_key`، `awarded_at`، `source_event_id` | |
| `kudos` | `from_member_id`، `to_member_id`، `message`، `value_tag?`، `created_at` | سهمیه هفتگی بر اساس هفته شمسی (شنبه تا جمعه) |

**قاعده‌ها:**
- **XP:** `XP = base × weight` برای تکمیل تسک (وزن ۱ تا ۵ را مدیر تعیین می‌کند)، پاداش به‌موقع بودن، XP کوچک برای همکار و برای دریافت قدردانی. **سقف روزانه** برای جلوگیری از سوءاستفاده (مثلاً ساخت و بستن تسک‌های الکی). تسکی که خود فرد ساخته و خودش بسته بدون وزن مدیر، XP حداقلی دارد.
- **استریک:** job پایان روز (بر اساس timezone شرکت) برای هر عضو تعیین می‌کند روز کاری بود یا نه (`work_calendars` + `leaves`). روز تعطیل و مرخصی `excused` است و استریک را **نمی‌شکند و اضافه هم نمی‌کند**. **روز کامل** (ADR 0007): عضو برای آن روز «برنامه امروز» با حداقل یک آیتم داشته باشد و حداقل ۷۰٪ آیتم‌ها تا پایان روز انجام شوند. درصد در `gamification_settings` قابل تنظیم است.
- **سطح** از XP با فرمول ثابت در `shared` محاسبه می‌شود (جدول ندارد).
- **خطوط قرمز در معماری:**
  - هیچ endpoint ای رتبه‌بندی فردی کل شرکت برنمی‌گرداند. لیگ تیمی (بعد از MVP) فقط تجمیع تیمی است.
  - داده گیمیفیکیشن در API ارزیابی عملکرد منابع انسانی استفاده نمی‌شود؛ ماژول `hr` حق import از ماژول `gamification` ندارد (قاعده lint) و این در ADR ثبت می‌شود.
  - اعلان‌های گیمیفیکیشن از همان صف اعلان با `deliver_after` و ساعت سکوت عبور می‌کنند.

---

## ۷. نقشه کلی انتقال از میزیتو

**مجهول اصلی:** نمی‌دانیم میزیتو چه خروجی‌ای می‌دهد (Excel از UI؟ API؟ خروجی پشتیبان؟). **اولین قدم:** گرفتن یک خروجی نمونه واقعی از شرکت پایلوت.

**طراحی خط لوله (مستقل از منبع):**

```
Extract (آداپتور منبع)  →  Stage  →  Map  →  Validate (dry-run)  →  Load  →  Verify
```

1. **آداپتور منبع:** رابط `SourceAdapter` با پیاده‌سازی‌های `MizitoExcelAdapter` و در صورت وجود `MizitoApiAdapter`. خروجی: رکوردهای خام.
2. **Stage:** `import_jobs` (`status`، `source`، `stats`) و `import_records` (`job_id`، `entity`، `source_id`، `raw jsonb`) — جدول‌های صفحه داده با RLS.
3. **Map (با UI برای ادمین):**
   - کاربران میزیتو → اعضا (تطبیق با ایمیل/موبایل/نام؛ موارد مبهم را ادمین تعیین می‌کند)
   - تیم‌ها/واحدها → دپارتمان‌ها و انتخاب قالب برای هرکدام
   - پروژه‌ها → projects؛ وضعیت‌های میزیتو → `status_key` های گردش کار مقصد
   - تسک‌ها، زیرتسک‌ها، کامنت‌ها، پیوست‌ها، برچسب‌ها → tasks، comments، attachments، فیلد select
   - تاریخ‌های شمسی → UTC
4. **Validate:** اجرای کامل بدون commit و گزارش: تعداد، رکوردهای ناقص، کاربران بی‌نگاشت.
5. **Load:** در `withTenant`، با حفظ `created_at` و نویسنده اصلی. جدول `import_id_map(source, entity, source_id, target_id)` اجرای دوباره را idempotent می‌کند → در دوره استفاده موازی می‌توان **همگام‌سازی تکمیلی** (delta) اجرا کرد.
6. **Verify:** مقایسه شمارش‌ها و نمونه‌برداری تصادفی با ادمین شرکت.

انتقال کاربران به‌معنی دعوت است، نه ساخت رمز عبور: پس از Load برای همه اعضا دعوت‌نامه ارسال می‌شود. XP تاریخی ساخته نمی‌شود (همه از صفر شروع می‌کنند).

---

## ۸. ریسک‌های فنی

| ریسک | اثر | راهکار |
|---|---|---|
| **تحریم زیرساخت توسعه:** Docker Hub و برخی رجیستری‌ها آی‌پی ایران را مسدود می‌کنند | build تولید روی ابر ایرانی شکست می‌خورد | آینه رجیستری داخلی (مثلاً آینه‌های ابرهای ایرانی) برای Docker و npm و PyPI؛ تصاویر پایه را در رجیستری خصوصی خودمان نگه داریم |
| **فراموشی `withTenant` یا نشت تنظیم tenant** | نشت داده بین شرکت‌ها | fail closed با `NULL`، `set_config` تراکنشی، lint بر import خام، تست متا روی همه جدول‌ها |
| **موتور کانفیگ به یک پلتفرم low-code بی‌انتها تبدیل شود** | MVP دیر می‌شود | سطح کانفیگ MVP را دقیقاً به نیاز ۸ ماژول محدود کنیم؛ اتوماسیون‌ها مجموعه بسته؛ هر گسترش با ADR |
| **تکامل اسکیمای کانفیگ** | کانفیگ‌های قدیمی شکسته | `schemaVersion` + مایگریشن کد برای کانفیگ‌ها + تست روی همه قالب‌ها |
| **بلوغ Better Auth** برای نام کاربری، 2FA، OTP پیامکی (بعدی) و سفارشی‌سازی نشست (`active_tenant_id`) | کار اضافی یا محدودیت | در قدم ۴ یک spike کوچک؛ اگر نشد، plugin سفارشی |
| **ارسال ایمیل و پیامک در ایران** | دعوت‌نامه نمی‌رسد | SMTP داخلی و سرویس پیامک داخلی پشت یک رابط `Messenger`؛ Mailpit در توسعه |
| **جست‌وجوی فارسی ضعیف در Postgres** | جست‌وجوی بد | نرمال‌سازی + pg_trgm؛ گزینه Meilisearch |
| **سرعت زیر ۲ ثانیه روی موبایل ایران** | تجربه بد | RSC برای پوسته، bundle کوچک، فونت محلی subset شده، کش PWA، اندازه‌گیری با Lighthouse در CI |
| **Next.js بدون Vercel** | قابلیت‌های وابسته به Vercel | خروجی `standalone`، `next/font/local`، بهینه‌سازی تصویر با sharp روی سرور خودمان |
| **مقیاس WebSocket با چند نمونه API** | پیام‌ها به همه نمی‌رسد | Socket.IO Redis adapter |
| **ترتیب و تکرار رویدادها** | XP دوبل، اعلان تکراری | idempotency با `processed_events` و UNIQUE روی `xp_ledger(source_event_id, reason)` |
| **سوءاستفاده از گیمیفیکیشن** | داده بی‌ارزش | وزن مدیر، سقف روزانه، XP حداقلی برای کارهای خودساخته |
| **ساختار داده میزیتو نامعلوم** | انتقال دیر یا ناقص | خروجی نمونه در اسرع وقت؛ طراحی آداپتوری |
| **هزینه GPU و کیفیت فارسی مدل‌های کوچک** (فاز ۳) | AI ضعیف | خارج از فاز صفر؛ داده‌ها از الان با رویداد و `tenant_id` آماده ایندکس‌اند |
| **پارتیشن و حجم `audit_logs` و `domain_events`** | کندی | پارتیشن ماهانه، پاک‌سازی رویدادهای منتشرشده پس از N روز |

---

## ۹. تصمیم‌های گرفته‌شده

| # | موضوع | تصمیم | تصمیم‌گیرنده | ADR |
|---|---|---|---|---|
| ۱ | هویت کاربر | هویت سراسری + عضویت در هر شرکت | Claude | 0003 |
| ۲ | روش ورود | **MVP:** نام کاربری + رمز که ادمین می‌سازد؛ تغییر رمز در ورود اول. **بعداً:** موبایل + کد پیامکی. 2FA ادمین با TOTP | مالک محصول | 0003 |
| ۳ | Better Auth organization plugin | استفاده نمی‌شود؛ Better Auth فقط برای هویت | Claude | 0003 |
| ۴ | محل کانفیگ دپارتمان | سند JSONB نسخه‌دار با Zod | Claude | 0004 |
| ۵ | دیدپذیری | هر کس دپارتمان خودش؛ دپارتمان‌های ناظر (مدیریت، منابع انسانی) دید کل شرکت روی منابع مشخص | مالک محصول | 0005 |
| ۶ | مسئول تسک | یک مسئول + همکاران | Claude | 0004 |
| ۷ | روز کامل استریک | برنامه امروز با حداقل یک آیتم و ≥۷۰٪ انجام‌شده | Claude | 0007 |
| ۸ | API | REST + قرارداد Zod مشترک | Claude | 0006 |
| ۹ | worker | entrypoint دوم در `apps/api` | Claude | 0006 |
| ۱۰ | ذخیره فایل | رابط S3؛ MinIO در توسعه | Claude | 0006 |
| ۱۱ | تعطیلات هفتگی پیش‌فرض | جمعه + پنجشنبه نیمه‌وقت، قابل تنظیم؛ تعطیلات رسمی ایران seed می‌شود | Claude | 0007 |
| ۱۲ | `packages/config` | اضافه شد؛ CLAUDE.md به‌روز شد | Claude | — |

ADR های ۰۰۰۲ تا ۰۰۰۷ در `docs/decisions/` هستند. ADR ۰۰۰۱ (نسخه دقیق کتابخانه‌ها) در قدم ۲ نوشته شد.

**هنوز از شرکت پایلوت لازم است:** خروجی نمونه میزیتو، روزها و ساعت کاری، و اینکه الان در میزیتو چه کسی چه چیزی را می‌بیند.

---

## ۱۰. فاز ۲الف: برابری با میزیتو

> وضعیت: **پیشنهاد، منتظر تایید مالک محصول** · تاریخ: ۲۷ مهر ۱۴۰۵
> منبع: `docs/feedback/1405-07-27-team-review.md`. جزئیات هر قدم در پلن همان قدم (`docs/plans/phase-2-step-<n>.md`) می‌آید و تصمیم‌های ساختاری در ADR.

### ۱۰.۱ چرا

شرکت پایلوت با میزیتو کار می‌کند. میزیتو نامه، جلسه، تقویم و چت دارد، و تا مدار این‌ها را نداشته باشد، تیم‌ها نمی‌توانند میزیتو را خاموش کنند. این بخش‌ها روی هسته سوار می‌شوند و به آن وصل‌اند: مصوبه جلسه کار می‌سازد، نامه و پیام شاهد انجام کار می‌شوند، و کار و جلسه در تقویم دیده می‌شوند.

### ۱۰.۲ جدول‌های تازه در یک نگاه

همه جدول‌ها `tenant_id`، RLS اجباری (`app.enable_tenant_rls`)، کلید خارجی مرکب `(tenant_id, x)` و تست جداسازی دارند (بخش ۲).

| قدم | جدول یا تغییر | ستون‌های کلیدی | توضیح |
|---|---|---|---|
| ۱۰ | `tasks` (ستون‌های تازه) | `source` (`personal`/`assigned`/`request`/`meeting`)، `source_member_id`، `progress` (۰..۱۰۰)، `progress_mode` (`auto`/`manual`) | منبع یک بار هنگام ساخت تعیین و دیگر عوض نمی‌شود؛ برای کارهای موجود با مایگریشن داده پر می‌شود. کار دارای زیرکار پیش‌فرض `auto` است |
| ۱۰ | `activities` (بدون جدول تازه) | ردیف `progress` با `{from, to, note}` | تاریخچه ثبت پیشرفت همان تاریخچه کار است |
| ۱۰ | `member_task_order` | `member_id`، `task_id`، `sort_key` | ترتیب دستی «کارهای من» برای هر نفر. «امروز» همان `daily_plan_items.sort_key` موجود است. `tasks.sort_key` ترتیب مشترک برد می‌ماند |
| ۱۰ | `tenants.settings.priority` (کانفیگ) | ضریب‌های امتیاز اولویت، با Zod در `packages/shared` | تابع امتیاز خالص در `packages/shared` |
| ۱۰ | `project_role` (enum) | افزودن `observer` | ناظر پروژه فقط می‌بیند |
| ۱۱ | `attachments` (طراحی‌شده در ۲.۵) | `subject_type`، `subject_id`، `object_key`، `file_name`، `mime`، `size`، `checksum`، `status` (`pending`/`ready`) | عمومی برای کار، کامنت، نامه، صورت‌جلسه و پیام. کلید شیء `tenants/{tenantId}/…`، دانلود با لینک امضاشده کوتاه‌مدت بعد از بررسی دسترسی (ADR 0006) |
| ۱۲ | `letters` | `number` (`۱۴۰۵/۰۰۱۲۳`)، `subject`، `body jsonb`، `sender_id`، `urgency`، `confidential`، `thread_id`، `reply_to_id`، `sent_at` (پیش‌نویس = `null`) | |
| ۱۲ | `letter_recipients` | `letter_id`، `member_id`، `kind` (`to`/`cc`/`referral`)، `referral_note`، `referred_by`، `read_at`، `archived_at` | پوشه‌های هر نفر از همین جدول درمی‌آیند |
| ۱۲ | `letter_counters` | `jalali_year`، `last_number` | شماره بدون شکاف: `SELECT … FOR UPDATE` روی سطر سال، در همان تراکنش ارسال |
| ۱۲ | `task_evidence` | `task_id`، `kind` (`letter`/`message`/`minutes`)، `subject_id`، `pinned_by`، `created_at` | «شاهد کار» (۱۰.۴)؛ یکتا روی `(task_id, kind, subject_id)` |
| ۱۳ | `meetings` | `type` (`regular`/`okr_review`/`one_on_one`)، `title`، `starts_at`، `ends_at`، `location`، `link`، `agenda`، `organizer_id`، `series_id?`، `department_id?` | هر بار از جلسه تکرارشونده یک سطر است، با صورت‌جلسه جدا |
| ۱۳ | `meeting_series` | قاعده تکرار (هفتگی، روز و ساعت)، تا تاریخ | نمونه‌های آینده تا چند هفته جلوتر ساخته می‌شوند |
| ۱۳ | `meeting_participants` | `meeting_id`، `member_id`، `response` | |
| ۱۳ | `meeting_minutes` | `meeting_id`، `body jsonb`، `recorded_by`، `recorded_at` | فایل صورت‌جلسه در `attachments` |
| ۱۳ | `meeting_decisions` | `meeting_id`، `text`، `task_id?`، `key_result_id?` | مصوبه با یک کلیک کار می‌شود (`source = meeting`) |
| ۱۴ | (بدون جدول تازه) | | تقویم یک API تجمیعی روی کارها، برنامه امروز، جلسات، دوره‌ها و نتیجه‌های کلیدی، پروژه‌ها و `work_calendars` است |
| ۱۵ | `conversations` | `kind` (`project`/`department`/`direct`/`group`)، `project_id?`، `department_id?`، `title?` | کانال پروژه و دپارتمان خودکار ساخته و همگام می‌شود |
| ۱۵ | `conversation_members` | `conversation_id`، `member_id`، `last_read_message_id`، `muted` | خوانده‌نشده برای هر نفر |
| ۱۵ | `messages` | `conversation_id`، `author_id`، `body`، `reply_to_id`، `edited_at`، `deleted_at` | ایندکس `(tenant_id, conversation_id, id)` برای صفحه‌بندی؛ شناسه‌ها UUIDv7 (به ترتیب زمان) |
| ۱۵ | `message_reactions`، `message_mentions` | | |

### ۱۰.۳ رویدادهای outbox تازه

| رویداد | سازنده | مصرف‌کننده‌ها |
|---|---|---|
| `task.progress_updated` | ثبت پیشرفت | اعلان به ابلاغ‌کننده، realtime، گیمیفیکیشن (بعداً) |
| `project.member_added` (نوع اعلانش از قبل هست) | افزودن عضو یا ناظر | اعلان، همگام‌سازی کانال پروژه |
| `attachment.uploaded` | تایید آپلود | realtime |
| `letter.sent`، `letter.referred` | ارسال و ارجاع نامه | اعلان و push، realtime |
| `task.evidence_pinned` | سنجاق نامه، پیام یا صورت‌جلسه | اعلان به مسئول و ابلاغ‌کننده، realtime |
| `meeting.scheduled`، `meeting.updated`، `meeting.canceled` | جلسه | اعلان دعوت، realtime تقویم |
| `meeting.minutes_recorded` | ثبت صورت‌جلسه | اعلان به شرکت‌کنندگان |
| `meeting.decision_converted` | مصوبه به کار | همان `task.created` با `source = meeting`، به‌علاوه پیوند برگشت |
| `message.created` | پیام چت | realtime به اتاق گفت‌وگو، push (با بی‌صدا و ساعت سکوت)، اعلان منشن |
| `conversation.member_added` | همگام‌سازی کانال | realtime |

یادآوری «جلسه تا ۱۰ دقیقه دیگر» رویداد نیست؛ مثل یادآوری سررسید در زمان‌بند worker ساخته می‌شود (ADR 0011).

### ۱۰.۴ «شاهد کار»: سازوکار عمومی سنجاق

کار «پیگیری فلان موضوع» با نامه‌ای که زده شده، پیامی که داده شده یا مصوبه‌ای که گرفته شده ثابت می‌شود. یک سازوکار برای همه:

- **جدول:** `task_evidence(task_id, kind, subject_id)`. هر نوع شاهد یک «تامین‌کننده» در API دارد که دو کار می‌کند:
  1. می‌گوید چه کسی اجازه سنجاق دارد: فقط کسی که خود آن نامه، پیام یا صورت‌جلسه را می‌بیند و کار را هم می‌بیند.
  2. یک خلاصه فقط‌خواندنی برمی‌گرداند (موضوع، شماره، فرستنده، گیرنده، تاریخ، خوانده‌شده یا نه).
- **دسترسی:** هر کسی که کار را می‌بیند، همان یک مورد سنجاق‌شده را فقط‌خواندنی می‌بیند، نه رشته نامه یا گفت‌وگوی کامل. این تنها جایی است که دیدن یک چیز از دیدن چیز دیگر می‌آید، پس صریح است:
  - موقع سنجاق به کاربر گفته می‌شود چه کسانی آن را خواهند دید؛
  - نامه محرمانه سنجاق نمی‌شود؛
  - سنجاق در AuditLog ثبت می‌شود.
- **پایداری:** اگر منبع حذف شود، شاهد «حذف‌شده» نمایش داده می‌شود و رد آن در تاریخچه کار می‌ماند.
- **قدم‌ها:** قدم ۱۲ جدول و نوع `letter` را می‌سازد. قدم ۱۳ نوع `minutes` و قدم ۱۵ نوع `message` را اضافه می‌کنند، بدون تغییر در جدول.

### ۱۰.۵ دسترسی‌ها (افزوده به بخش ۴)

| منبع | چه کسی می‌بیند |
|---|---|
| نامه | فقط فرستنده، گیرندگان، رونوشت و ارجاع‌شده‌ها. نه ناظر، نه ادمین، نه مالک شرکت |
| جلسه | شرکت‌کنندگان و دپارتمان‌های ناظر روی `meeting` (منبع تازه در `OVERSIGHT_RESOURCES`). جلسه یک‌به‌یک فقط برای دو طرف |
| پیوست | هر کس منبع آن (کار، کامنت، نامه، صورت‌جلسه، پیام) را می‌بیند |
| کانال پروژه | اعضا و ناظران پروژه؛ ناظران دپارتمانی نه (پیش‌فرض فیدبک) |
| کانال دپارتمان | اعضای دپارتمان |
| گفت‌وگوی خصوصی و گروه | فقط اعضای آن. هیچ مدیر یا ادمینی در اپ نمی‌بیند |
| تقویم دیگران | فقط آنچه طبق ADR 0005 از کار و جلسه دیده می‌شود |

همه این‌ها مثل `work/access.ts` شرط SQL هستند و در حافظه فیلتر نمی‌شوند (ADR 0010).

### ۱۰.۶ تضادها با طراحی فعلی و پیشنهاد حل

1. **جلسه به‌عنوان نوع کار:** جدول ۲.۵ می‌گوید «جلسه، مصوبه… همه tasks هستند». فیدبک جلسه را با زمان، شرکت‌کننده، تکرار و صورت‌جلسه می‌خواهد. **پیشنهاد:** جلسه موجودیت جدا (`meetings`)؛ مصوبه همچنان کار است (`source = meeting`).
2. **پیام realtime بدون داده** (ADR 0011: فقط اشاره، کلاینت دوباره می‌خواند). برای چت، رفت‌وبرگشت برای هر پیام کند است. **پیشنهاد:** فقط در اتاق گفت‌وگو، که عضویتش در سرور بررسی شده، خود پیام فرستاده شود؛ بقیه رویدادها همان اشاره بمانند. ADR در قدم ۱۵.
3. **خروجی کامل داده شرکت** (قاعده امنیتی CLAUDE.md) **در برابر حریم گفت‌وگوی خصوصی** (خط قرمز فیدبک). **پیشنهاد:** خروجی شرکت کانال‌های پروژه و دپارتمان را دارد، ولی گفت‌وگوهای خصوصی و گروه را نه. خروجی چت فقط برای ادمین است و در AuditLog ثبت می‌شود. سوال از مالک محصول.
4. **تعریف «پروژه در خطر»** (ADR 0014) روی نسبت کارهای انجام‌شده است. با پیشرفت درصدی کار، پیشرفت پروژه میانگین وزنی پیشرفت کارها می‌شود. **پیشنهاد:** داشبورد و گزارش هفتگی هم از همین عدد استفاده کنند، و ADR 0014 به‌روز شود.
5. **«ابلاغ مدیرعامل» در امتیاز اولویت:** «مدیرعامل» در داده نیست. **پیشنهاد:** کسی که در زنجیره مدیریتی (`members.manager_id`) بالاتری ندارد و نقش «مدیریت ارشد» یا «مالک» دارد. «بالادست» یعنی زنجیره `manager_id`، یا مدیر و سرپرست دپارتمانی که کار در آن است.
6. **کارهای چندمسئوله** (`task_collaborators`): منبع نسبت به مسئول اصلی (`assignee_id`) تعیین می‌شود.
7. **ترتیب:** `tasks.sort_key` ترتیب مشترک برد است و نباید شخصی شود؛ ترتیب شخصی جدول جدا دارد (بالا).
8. **حجم پیام‌ها:** جدول `messages` برای یک شرکت ۲۰۰ نفره سریع رشد می‌کند. **پیشنهاد:** ایندکس بالا از روز اول؛ پارتیشن ماهانه وقتی لازم شد، مثل `audit_logs` (بخش ۸).

### ۱۰.۷ ترتیب قدم‌ها

| قدم | محتوا | پیش‌نیاز |
|---|---|---|
| ۱۰ | منبع کار، اولویت خودکار + ترتیب دستی، پیشرفت درصدی، تکمیل اعضای پروژه | — |
| ۱۱ | ذخیره فایل و پیوست | — |
| ۱۲ | نامه داخلی + «شاهد کار» | ۱۱ |
| ۱۳ | جلسات، صورت‌جلسه، مصوبه به کار | ۱۰، ۱۱، ۱۲ (شاهد کار) |
| ۱۴ | تقویم | ۱۳ |
| ۱۵ | چت | ۱۱، ۱۲ (شاهد کار) |

پیشنهاد تغییر ترتیب با دلیل در پیام قدم صفر به مالک محصول داده شده و پس از تصمیم همین‌جا ثبت می‌شود.

## ۱۱. قدم بعد

فاز ۱ (قدم‌های ۰ تا ۹) تمام شده است. قدم بعد اولین قدم بخش ۱۰ است، بعد از تایید ترتیب.
