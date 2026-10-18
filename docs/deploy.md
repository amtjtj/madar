# راهنمای استقرار مدار

> برای کسی که اولین بار سرور راه می‌اندازد. تصمیم‌ها و دلیل‌ها: `docs/decisions/0016-production-deployment.md`.
> هر فرمان را روی سرور، در پوشه پروژه (`~/madar`)، اجرا کنید مگر اینکه جای دیگری گفته شده باشد.

## ۱. چه چیزی لازم است

| مورد | توضیح |
|---|---|
| **سرور ابری (VPS)** | نه هاست اشتراکی (cPanel). دیتاسنتر داخل ایران. **پیشنهاد:** ۴ هسته، ۸ گیگ رم، ۸۰ گیگ SSD، Ubuntu 24.04، یک IP عمومی ثابت. برای یک دموی کوتاه ۲ هسته و ۴ گیگ هم کار می‌کند (build کندتر است) |
| **دامنه یا زیردامنه** | مثلاً `demo.example.ir`، با یک رکورد `A` که به IP سرور اشاره کند |
| **پورت‌ها** | ۲۲ (SSH)، ۸۰ و ۴۴۳ در فایروال ارائه‌دهنده باز باشند. بقیه بسته |
| **فونت Abar** (اختیاری) | فایل‌های خریداری‌شده `AbarLow-*.woff2`. بدون آن‌ها فونت Vazirmatn نمایش داده می‌شود |

## ۲. آماده‌سازی سرور (یک بار)

```bash
# به‌روزرسانی و ابزارهای پایه
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl ufw

# Docker (از مخزن رسمی، یا آینه داخلی ارائه‌دهنده اگر در دسترس نبود)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # بعد یک بار خارج و دوباره وارد SSH شوید

# فایروال سرور: فقط SSH و وب
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp
sudo ufw enable
```

**اگر Docker Hub یا npm از سرور در دسترس نبود** (تحریم):
1. آینه Docker ارائه‌دهنده را در `/etc/docker/daemon.json` بگذارید و Docker را راه‌اندازی مجدد کنید:
   ```json
   { "registry-mirrors": ["https://<آینه-ارائه‌دهنده>"] }
   ```
2. بعد از ساخت `.env` (قدم ۳)، `BASE_REGISTRY` و `NPM_REGISTRY` را به آینه‌های داخلی تغییر دهید.
3. راه آخر: ایمیج‌ها را روی یک سیستم دیگر بسازید و منتقل کنید (بخش ۹).

## ۳. گرفتن کد و ساخت تنظیمات

```bash
git clone <آدرس مخزن> ~/madar && cd ~/madar

# سرور دمو (شرکت نمونه «زرین‌مدار» با تازه‌سازی شبانه):
scripts/deploy/init-env.sh demo.example.ir you@example.com --demo
# سرور واقعی یک شرکت (بدون داده نمونه):
# scripts/deploy/init-env.sh app.example.ir you@example.com
```

- فایل `.env` با همه رمزها به‌صورت تصادفی ساخته می‌شود.
- **یک نسخه از `.env` را بیرون از سرور نگه دارید** (مثلاً در مدیر رمز). بدون آن، پشتیبان‌ها هم قابل استفاده نیستند.
- در حالت دمو، رمز همه حساب‌های دمو یک بار چاپ می‌شود (`DEMO_PASSWORD` در `.env`).

**فونت Abar** (اختیاری، قبل از استقرار):
```bash
# فایل‌های AbarLow-*.woff2 را با scp به سرور بیاورید، مثلاً در ~/abar، بعد:
mkdir -p apps/web/public/fonts/abar && cp ~/abar/AbarLow-*.woff2 apps/web/public/fonts/abar/
```

## ۴. استقرار

```bash
scripts/deploy/deploy.sh
```

این فرمان به ترتیب این کارها را می‌کند:
1. آخرین کد را می‌گیرد.
2. اگر سرویس‌ها از قبل بالا باشند، اول پشتیبان می‌گیرد.
3. ایمیج‌ها را می‌سازد (بار اول ۵ تا ۱۵ دقیقه).
4. کلید Web Push را در اولین اجرا می‌سازد.
5. مایگریشن را اجرا می‌کند و سرویس‌ها را بالا می‌آورد.
6. در حالت دمو، بار اول شرکت نمونه را می‌سازد.
7. وضعیت را نشان می‌دهد.

بعد `https://demo.example.ir` را باز کنید. Caddy گواهی HTTPS را در همان چند ثانیه اول می‌گیرد.

**به‌روزرسانی بعدی:** همان `scripts/deploy/deploy.sh`.
**برگشت به نسخه قبل:** `scripts/deploy/deploy.sh --rollback`. مایگریشن‌ها برنمی‌گردند؛ اگر نسخه جدید داده را خراب کرده، از پشتیبان بازگردانی کنید (بخش ۶).

### اگر گواهی HTTPS گرفته نشد
- **رکورد DNS:** `dig +short demo.example.ir` باید IP سرور را برگرداند.
- **پورت‌ها:** ۸۰ و ۴۴۳ باید از اینترنت باز باشند (فایروال ارائه‌دهنده و `ufw`).
- **لاگ:** `docker compose --env-file .env -f docker/compose.prod.yml -p madar logs caddy`
- **راه جایگزین:** اگر سرور به سرویس گواهی دسترسی ندارد، گواهی را از ارائه‌دهنده یا یک CA بگیرید:
  1. فایل‌ها را در `docker/caddy/certs/fullchain.pem` و `privkey.pem` بگذارید.
  2. در `.env` بنویسید: `CADDY_TLS=tls /certs/fullchain.pem /certs/privkey.pem`
  3. دوباره `deploy.sh` را اجرا کنید.

## ۵. وضعیت و لاگ

```bash
scripts/deploy/status.sh
```

این فرمان نشان می‌دهد:
- سلامت هر سرویس؛
- `/api/health` (دیتابیس، Redis، worker)؛
- آخرین پشتیبان و نتیجه آزمایش بازگردانی آن؛
- فضای دیسک؛
- تعداد خطاهای ۲۴ ساعت گذشته.

| کار | فرمان |
|---|---|
| لاگ زنده یک سرویس | `docker compose --env-file .env -f docker/compose.prod.yml -p madar logs -f api` (یا `worker`، `web`، `caddy`، `backup`، `demo`) |
| فقط خطاها | `... logs --since 24h api \| grep '"level":"error"'` |
| راه‌اندازی مجدد یک سرویس | `... restart worker` |

- لاگ‌ها JSON هستند و هر خطا شناسه درخواست (`requestId`) دارد؛ همان شناسه در لاگ Caddy هم هست.
- Docker برای هر سرویس حداکثر ۵ فایل ۱۰ مگابایتی نگه می‌دارد.
- رمز، کوکی و توکن در لاگ نوشته نمی‌شوند.

## ۶. پشتیبان و بازگردانی

**خودکار:**
- هر شب ساعت ۳:۳۰ به وقت تهران (`BACKUP_AT`) پشتیبان در `backups/daily` گرفته می‌شود.
- جمعه‌ها یک نسخه هم در `backups/weekly` می‌رود.
- ۷ نسخه روزانه و ۴ نسخه هفتگی نگه داشته می‌شود.
- بعد از هر پشتیبان، فایل در یک دیتابیس موقت بازگردانی و شمارش جدول‌ها مقایسه می‌شود. نتیجه در `backups/last-check.json` است و `status.sh` آن را نشان می‌دهد.

**دستی:**
```bash
scripts/deploy/backup-now.sh
```

**کپی بیرون از سرور (به‌شدت توصیه می‌شود):** یکی از این دو راه:
- ذخیره‌ساز S3 سازگار ارائه‌دهنده: `BACKUP_S3_ENDPOINT`، `BACKUP_S3_BUCKET`، `BACKUP_S3_ACCESS_KEY` و `BACKUP_S3_SECRET_KEY` را در `.env` پر کنید و `deploy.sh` را اجرا کنید.
- یا هر چند وقت یک بار از سیستم خودتان: `scp -r user@server:~/madar/backups ./madar-backups`

**بازگردانی** (همه داده فعلی با فایل پشتیبان جایگزین می‌شود):
```bash
scripts/deploy/restore.sh backups/daily/madar_1405-..._0330.dump
```
اسکریپت تایید می‌خواهد، برنامه را متوقف می‌کند، دیتابیس را از فایل می‌سازد و دوباره بالا می‌آورد.
**تمرین:** بعد از اولین استقرار یک بار این را روی سرور دمو امتحان کنید تا روزی که لازم شد غافلگیر نشوید.

## ۷. حالت دمو

| مورد | توضیح |
|---|---|
| حساب‌ها | `leila.sadeghi` (مدیرعامل)، `maryam.ahmadi` (مدیر پشتیبانی)، `ali.rezaei` (کارمند)، `reza.karimi` (مالک؛ بار اول 2FA می‌خواهد). رمز همه: `DEMO_PASSWORD` |
| تازه‌سازی | هر شب ساعت ۵ صبح تهران (`DEMO_RESET_AT`) داده پاک و از نو ساخته می‌شود؛ تاریخ‌ها نسبت به همان روز‌اند |
| تازه‌سازی دستی پیش از جلسه | `docker compose --env-file .env -f docker/compose.prod.yml -p madar exec demo node dist/scripts/demo-reset.js` |
| ثبت شرکت تازه | با کد `TENANT_SIGNUP_CODE` از `.env` |

متن جلسه دمو: `docs/demo-script.md`.

## ۸. اعلان روی گوشی (Web Push)

- کلیدها در اولین استقرار ساخته می‌شوند. **هرگز عوضشان نکنید**، وگرنه همه دستگاه‌ها باید دوباره اعلان را روشن کنند.
- **سرویس push مرورگرها از سرور در دسترس نیست:** این سرویس‌ها خارج از ایران‌اند (مثلاً سرویس گوگل برای کروم اندروید). اگر سرور مستقیم به آن‌ها نرسد، یک پراکسی خروجی در `PUSH_PROXY_URL` بگذارید. اعلان درون برنامه و به‌روزرسانی زنده در هر حال کار می‌کنند.
- **آیفون:** اعلان فقط وقتی کار می‌کند که مدار از Safari به صفحه اصلی اضافه شده باشد.

## ۹. ساخت ایمیج بدون اینترنت روی سرور

اگر سرور به هیچ رجیستری‌ای دسترسی ندارد:
1. **روی سیستمی با دسترسی:**
   ```bash
   docker build -f docker/api.Dockerfile -t madar-api:latest .
   docker build -f docker/web.Dockerfile -t madar-web:latest .
   docker save madar-api:latest madar-web:latest postgres:18-alpine redis:8-alpine caddy:2-alpine | gzip > madar-images.tar.gz
   ```
2. **روی سرور:**
   ```bash
   gunzip -c madar-images.tar.gz | docker load
   docker compose --env-file .env -f docker/compose.prod.yml -p madar up -d --wait
   ```
   در این حالت در `.env` بنویسید: `BASE_REGISTRY=docker.io/library`.

**پراکسی با گواهی خودش:** اگر build از پشت پراکسی‌ای انجام می‌شود که گواهی خودش را دارد:
```bash
MADAR_BUILD_CA=/path/to/proxy-ca.crt scripts/deploy/deploy.sh
```

## ۱۰. آزمون خودکار سرور دمو

روی سرور دمو، اگر Node و pnpm نصب‌اند (`pnpm install` و `pnpm --filter @madar/web exec playwright install chromium`):
```bash
scripts/deploy/smoke.sh            # پورت‌ها، ورود سه نقش روی HTTPS، WebSocket، گزارش، پشتیبان
scripts/deploy/smoke.sh --restore  # به‌علاوه تمرین کامل بازگردانی
```
همین آزمون در CI روی هر push اجرا می‌شود.

## ۱۱. چک‌لیست بعد از استقرار

- [ ] `https://<دامنه>` با قفل سبز باز می‌شود و `http://` به `https://` می‌رود
- [ ] `scripts/deploy/status.sh`: همه سرویس‌ها `healthy` و سلامت API `ok`
- [ ] ورود با حساب مدیرعامل دمو، روی گوشی و دسکتاپ
- [ ] نصب روی صفحه اصلی گوشی (اندروید: منوی کروم ← «نصب برنامه»؛ آیفون: Safari ← اشتراک‌گذاری ← «افزودن به صفحه اصلی»)
- [ ] فردای استقرار: `backups/last-check.json` با `"ok":true`
- [ ] یک بار تمرین `restore.sh` روی سرور دمو
- [ ] نسخه‌ای از `.env` بیرون از سرور
