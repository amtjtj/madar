# مدار (Madar)

سیستم‌عامل کار یکپارچه برای شرکت‌ها: یک هسته مشترک (کار، پروژه، هدف و OKR، درخواست و تایید، گزارش، گیمیفیکیشن) و برای هر دپارتمان یک ماژول قابل تنظیم بدون کد، به‌علاوه دستیار هوش مصنوعی خصوصی که روی همان سرور اجرا می‌شود. فارسی و راست‌به‌چپ از پایه، تقویم شمسی، و قابل اجرا روی سرور داخل ایران بدون هیچ سرویس خارجی.

- شرح محصول: `docs/brief.md`
- معماری: `docs/architecture.md`
- تصمیم‌ها (ADR): `docs/decisions/`
- **راهنمای کامل نصب روی Ubuntu: `docs/deploy.md`**
- اجرای نسخه production روی کامپیوتر خودتان: `docs/local-demo.md`

## فهرست

1. [فناوری‌ها](#فناوریها)
2. [ساختار پروژه](#ساختار-پروژه)
3. [پیش‌نیازها](#پیشنیازها)
4. [اجرای محلی (توسعه)](#اجرای-محلی-توسعه)
5. [متغیرهای محیطی](#متغیرهای-محیطی)
6. [پایگاه داده](#پایگاه-داده)
7. [Build و آزمون‌ها](#build-و-آزمونها)
8. [اجرای production](#اجرای-production)
9. [استقرار روی Ubuntu](#استقرار-روی-ubuntu)
10. [وب‌سرور و HTTPS](#وبسرور-و-https)
11. [لاگ‌ها](#لاگها)
12. [پشتیبان‌گیری](#پشتیبانگیری)
13. [به‌روزرسانی](#بهروزرسانی)
14. [عیب‌یابی](#عیبیابی)

## فناوری‌ها

| لایه | فناوری |
|---|---|
| زبان | TypeScript (strict)؛ سرویس دستیار با Python |
| وب | Next.js 16 (App Router، خروجی `standalone`)، Tailwind CSS 4، PWA |
| API | NestJS 12 روی Node.js 24 (Express)، Socket.IO برای به‌روزرسانی زنده |
| پایگاه داده | PostgreSQL 18 با Row-Level Security و pgvector، ORM: Drizzle |
| صف و کش | Redis 8، BullMQ (worker جدا) |
| ورود | Better Auth (خود میزبان)، نام کاربری و رمز، 2FA (TOTP) برای ادمین‌ها |
| اعتبارسنجی | Zod، مشترک بین وب و API |
| دستیار (اختیاری) | FastAPI، مدل اوپن‌سورس با llama.cpp یا vLLM |
| مونوریپو | Turborepo + pnpm 10 |
| آزمون | Vitest (واحد و یکپارچه)، Playwright (e2e در ۳۶۰ و ۱۴۴۰ پیکسل) |
| استقرار | Docker Compose + Caddy (HTTPS خودکار) روی Ubuntu 24.04 |

## ساختار پروژه

```
apps/
  web/        Next.js (رابط کاربری، PWA)
  api/        NestJS API، worker، اسکریپت‌های seed و demo
  ai/         سرویس دستیار (Python، اختیاری)
packages/
  db/         شمای Drizzle، مایگریشن‌ها (drizzle/*.sql)، RLS
  shared/     قراردادهای Zod، قواعد مشترک، قالب‌های دپارتمان
  ui/         اجزای طراحی و توکن‌های رنگ
  i18n/       متن‌های فارسی
  config/     تنظیمات مشترک tsconfig و ESLint
docker/       Dockerfileها، compose توسعه و production، Caddyfile، اسکریپت پشتیبان
scripts/deploy/  نصب، استقرار، وضعیت، پشتیبان، بازگردانی و آزمون سرور
docs/         شرح محصول، معماری، تصمیم‌ها، راهنماها
```

## پیش‌نیازها

**توسعه:**
- Node.js نسخه 22.12 یا بالاتر (24 LTS پیشنهاد می‌شود)
- pnpm 10 (با `corepack enable`)
- Docker برای PostgreSQL و Redis (یا PostgreSQL 16+ با pgvector و Redis 7+ نصب‌شده روی سیستم)
- برای سرویس دستیار: Python و [`uv`](https://docs.astral.sh/uv/)

**production:** فقط Ubuntu 24.04 و Docker (بخش [استقرار](#استقرار-روی-ubuntu)). Node و pnpm روی سرور لازم نیستند؛ همه چیز داخل ایمیج‌های Docker ساخته می‌شود.

## اجرای محلی (توسعه)

```bash
git clone https://github.com/amtjtj/madar.git && cd madar
corepack enable
cp .env.example .env          # مقادیر توسعه؛ برای production فایل دیگری لازم است
pnpm install
pnpm db:up                    # PostgreSQL (با pgvector) و Redis در Docker
pnpm db:migrate               # ساخت جدول‌ها و نقش‌های madar_app و madar_worker
pnpm db:seed                  # شرکت نمونه «زرین‌مدار» (فقط توسعه و دمو)
pnpm dev                      # وب: http://localhost:3000 ، API: http://localhost:4000 ، worker
```

ورود با هر کاربر نمونه (مثلاً `ali.rezaei`، `maryam.ahmadi`، `leila.sadeghi`) و رمز `SEED_PASSWORD` در `.env` (پیش‌فرض `madar-demo-1234`). حساب مالک (`reza.karimi`) بار اول 2FA می‌خواهد.

فونت Abar مجوز تجاری دارد و در git نیست: `pnpm fonts:install <پوشه-فایل‌ها>`. بدون آن فونت Vazirmatn نمایش داده می‌شود.

## متغیرهای محیطی

یک فایل `.env` در ریشه پروژه برای همه بخش‌ها. هیچ‌وقت در git نمی‌رود (`.gitignore`).

| فایل | کاربرد |
|---|---|
| `.env.example` | الگوی توسعه، با توضیح هر متغیر |
| `.env.production.example` | الگوی production، با توضیح هر متغیر. روی سرور به‌جای نوشتن دستی، `scripts/deploy/init-env.sh` همه رمزها را تصادفی می‌سازد |

مهم‌ترین متغیرهای production:

| متغیر | توضیح |
|---|---|
| `MADAR_DOMAIN` | دامنه عمومی؛ برنامه روی `https://<دامنه>` است |
| `POSTGRES_PASSWORD`، `DATABASE_URL` | نقش مالک پایگاه داده (فقط مایگریشن و پشتیبان) |
| `APP_DATABASE_URL`، `WORKER_DATABASE_URL` | نقش‌های برنامه و worker (زیر RLS) |
| `AUTH_SECRET` | امضای نشست‌ها و رمزنگاری 2FA؛ حداقل ۳۲ نویسه تصادفی |
| `TENANT_SIGNUP_CODE` | کد لازم برای ثبت یک شرکت تازه |
| `STORAGE_DRIVER` | `local` (دیسک سرور) یا `s3` |
| `VAPID_*` | کلیدهای اعلان دستگاه؛ اولین استقرار خودکار می‌سازد |

API در production با مقدار ضعیف، نمونه یا ناقص **اصلاً اجرا نمی‌شود** و پیام روشن می‌دهد (`apps/api/src/config/env.ts`).

## پایگاه داده

- **موتور:** PostgreSQL 18 با افزونه pgvector 0.8.1. در production ایمیج `madar-postgres:18-pgvector0.8.1` از `docker/postgres.Dockerfile` ساخته می‌شود.
- **نام پایگاه داده:** `madar` (`POSTGRES_DB`).
- **نقش‌ها:**
  - `madar_owner`: مالک شما، مایگریشن و پشتیبان.
  - `madar_app`: API، زیر RLS، هرگز صاحب جدول‌ها نیست.
  - `madar_worker`: مثل app، به‌علاوه خواندن صف رویدادها بین شرکت‌ها.
  - دو نقش آخر را خود مایگریشن با رمزهای `APP_DATABASE_URL` و `WORKER_DATABASE_URL` می‌سازد.
- **مایگریشن:**
  - **توسعه:** `pnpm db:migrate`
  - **production:** سرویس `migrate` در هر استقرار پیش از API اجرا می‌شود (`node node_modules/@madar/db/dist/migrate.js`).
  - مایگریشن‌ها فقط رو به جلو هستند و فایل‌هایشان در `packages/db/drizzle/` است.
- **seed:**
  - `pnpm db:seed` فقط برای توسعه است.
  - روی سرور production هیچ seedی اجرا نمی‌شود، مگر سرور دمو (`init-env.sh --demo` که `DEMO_MODE=true` می‌گذارد).
  - اسکریپت تازه‌سازی دمو بدون `DEMO_MODE` کار نمی‌کند.
- **تعریف شمای تازه:** `pnpm db:generate` (Drizzle Kit) فایل مایگریشن می‌سازد.

## Build و آزمون‌ها

| کار | فرمان |
|---|---|
| Build همه بسته‌ها | `pnpm build` |
| بررسی نوع | `pnpm typecheck` |
| Lint | `pnpm lint` |
| آزمون واحد و یکپارچه | `pnpm test` (آزمون‌های پایگاه داده بدون `APP_DATABASE_URL` رد می‌شوند) |
| همه بررسی‌های CI پیش از e2e | `pnpm check` |
| آزمون e2e | `pnpm test:e2e` (Playwright، ۳۶۰ و ۱۴۴۰ پیکسل) |

## اجرای production

در production هر بخش یک کانتینر است (`docker/compose.prod.yml`):

| سرویس | کار | پورت (فقط داخل شبکه Docker) |
|---|---|---|
| `caddy` | HTTPS، هدرهای امنیتی، `/api/*` به API و بقیه به وب | **۸۰ و ۴۴۳ (تنها پورت‌های باز)** |
| `web` | Next.js (`node apps/web/server.js`) | 3000 |
| `api` | NestJS (`node dist/main.js`) | 4000 |
| `worker` | صف‌ها، اعلان‌ها، یادآورها، استریک (`node dist/worker.js`) | — |
| `migrate` | مایگریشن پیش از api و worker، سپس خارج می‌شود | — |
| `postgres` | پایگاه داده (volume `postgres-data`) | 5432 |
| `redis` | صف و پیام زنده (volume `redis-data`) | 6379 |
| `backup` | پشتیبان شبانه با آزمون بازگردانی | — |
| `demo`، `ai`، `llm-cpu`، `llm-gpu`، `embed` | اختیاری، با `COMPOSE_PROFILES` | — |

دستورهای build و اجرا را اسکریپت‌ها اجرا می‌کنند:
- **Build:** `scripts/deploy/deploy.sh` ایمیج‌ها را با `docker build` از `docker/*.Dockerfile` می‌سازد.
- **اجرا:** همان اسکریپت `docker compose --env-file .env -f docker/compose.prod.yml -p madar up -d --wait` را اجرا می‌کند.

## استقرار روی Ubuntu

راهنمای قدم‌به‌قدم از سرور خالی تا HTTPS: **`docs/deploy.md`**. خلاصه:

```bash
# روی سرور تازه Ubuntu 24.04، بعد از اینکه رکورد A دامنه به IP سرور اشاره کرد:
sudo apt update && sudo apt install -y git
sudo mkdir -p /opt/madar && sudo chown $USER: /opt/madar
git clone https://github.com/amtjtj/madar.git /opt/madar && cd /opt/madar
scripts/deploy/install.sh app.example.ir admin@example.ir
```

`install.sh` این کارها را انجام می‌دهد:
- Docker، فایروال و swap را آماده می‌کند؛
- آینه داخلی را پیدا می‌کند؛
- `.env` را با رمزهای تصادفی می‌سازد؛
- استقرار را انجام می‌دهد.

## وب‌سرور و HTTPS

این پروژه به‌جای Nginx و Certbot از **Caddy** استفاده می‌کند (`docker/caddy/Caddyfile`، ADR 0016):
- گواهی HTTPS را خودش می‌گیرد و تمدید می‌کند.
- `http` را به `https` می‌برد.
- HSTS و هدرهای امنیتی را می‌گذارد.
- WebSocket (`/api/socket`) را رد می‌کند.
- حجم درخواست را محدود می‌کند: ۲ مگابایت برای API و ۱۱۰ مگابایت برای بارگذاری فایل.

نصب Nginx جداگانه لازم نیست. اگر روی سرور از قبل Nginx دارید که پورت ۸۰ و ۴۴۳ را گرفته، بخش «عیب‌یابی» در `docs/deploy.md` را ببینید.

گواهی خودتان (بدون صدور خودکار): فایل‌ها را در `docker/caddy/certs/` بگذارید و در `.env` بنویسید `CADDY_TLS=tls /certs/fullchain.pem /certs/privkey.pem`.

## لاگ‌ها

```bash
scripts/deploy/status.sh                                                   # وضعیت کلی، سلامت، خطاهای ۲۴ ساعت
docker compose --env-file .env -f docker/compose.prod.yml -p madar logs -f api   # یا worker، web، caddy، backup
```

- لاگ API و worker JSON است (یک خط برای هر رویداد).
- هر درخواست شناسه `X-Request-Id` دارد که در لاگ Caddy هم هست.
- خطاهای ۵۰۰ با مسیر، وضعیت و زمان ثبت می‌شوند.
- رمز، کوکی، توکن، متن پیام‌ها و query string در لاگ نوشته نمی‌شوند.
- Docker برای هر سرویس حداکثر ۵ فایل ۱۰ مگابایتی نگه می‌دارد.

سلامت: `https://<دامنه>/api/health` وضعیت پایگاه داده، Redis و worker را برمی‌گرداند (`"status":"ok"`).

## پشتیبان‌گیری

- **خودکار:**
  - هر شب ساعت ۳:۳۰ تهران پشتیبان در `backups/daily` گرفته می‌شود.
  - جمعه‌ها یک نسخه هم در `backups/weekly` می‌رود.
  - ۷ نسخه روزانه و ۴ نسخه هفتگی نگه داشته می‌شود.
  - هر پشتیبان شامل dump پایگاه داده و آرشیو فایل‌های پیوست است.
  - بعد از هر پشتیبان، فایل در یک پایگاه موقت بازگردانی و بررسی می‌شود.
- **دستی:** `scripts/deploy/backup-now.sh`
- **بازگردانی:** `scripts/deploy/restore.sh backups/daily/<فایل>.dump`
- **کپی بیرون از سرور:** `BACKUP_S3_*` در `.env`، یا کپی دستی (`docs/deploy.md`).
- **نسخه‌ای از `.env` را بیرون از سرور نگه دارید.** بدون آن پشتیبان‌ها باز نمی‌شوند.

## به‌روزرسانی

```bash
cd /opt/madar
scripts/deploy/deploy.sh             # کد تازه، پشتیبان، build، مایگریشن، اجرا
scripts/deploy/status.sh             # بررسی
scripts/deploy/deploy.sh --rollback  # برگشت به ایمیج قبلی (مایگریشن‌ها برنمی‌گردند)
```

## عیب‌یابی

مشکلات رایج و راه‌حلشان (گواهی HTTPS، اشغال پورت ۸۰، کمبود حافظه هنگام build، بسته بودن Docker Hub یا npm، خطای `Invalid environment`، worker ناسالم، پر شدن دیسک و …) در بخش «عیب‌یابی» `docs/deploy.md` آمده است.
