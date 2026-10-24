# راهنمای استقرار مدار روی Ubuntu

> این راهنما از یک سرور Ubuntu خالی شروع می‌کند و به برنامه روی `https://<دامنه>` می‌رسد. برای اجرای همین نسخه روی کامپیوتر خودتان: `docs/local-demo.md`. دلیل تصمیم‌ها: `docs/decisions/0016-production-deployment.md`.
>
> - همه فرمان‌ها را روی سرور و در پوشه پروژه، `/opt/madar`، اجرا کنید، مگر جایی که جای دیگری گفته شده.
> - جای `app.example.ir` دامنه خودتان و جای `admin@example.ir` ایمیل خودتان را بگذارید.

## معماری در یک نگاه

```
کاربر ─► DNS (رکورد A) ─► سرور Ubuntu، پورت ۸۰ و ۴۴۳
                              │
                              ▼
                        Caddy (HTTPS خودکار، هدرهای امنیتی)
                     /api/* و WebSocket │ بقیه مسیرها
                              ▼        ▼
                      API (NestJS)   وب (Next.js)
                         │
         ┌───────────────┼────────────────┐
         ▼               ▼                ▼
   PostgreSQL 18     Redis 8          worker (صف‌ها، اعلان‌ها، یادآورها)
   (+ pgvector)                       backup (پشتیبان شبانه)
```

- همه بخش‌ها کانتینرهای Docker هستند و با Docker Compose (`docker/compose.prod.yml`) اجرا می‌شوند.
- فقط Caddy پورت باز دارد (۸۰ و ۴۴۳). پایگاه داده، Redis، API و وب فقط داخل شبکه Docker در دسترس‌اند.

**چرا Docker:** مدار چند سرویس دارد (وب، API، worker، PostgreSQL با افزونه pgvector، Redis و پشتیبان) و یک نسخه مشخص از Node.js و PostgreSQL لازم دارد. Docker همه را با یک فرمان، با نسخه‌های ثابت، بالا می‌آورد و بعد از راه‌اندازی مجدد سرور هم خودش برمی‌گرداند. روی سرور فقط Docker نصب می‌شود؛ Node.js، pnpm و PostgreSQL روی خود سرور لازم نیستند.

**چرا Caddy و نه Nginx:** Caddy گواهی HTTPS را خودش می‌گیرد و تمدید می‌کند و همراه بقیه سرویس‌ها در Docker است. پس Nginx و Certbot جدا نصب نمی‌شوند (قدم ۱۲ و ۱۴).

## راه سریع (یک فرمان)

اگر سرور تازه است و رکورد DNS دامنه را ساخته‌اید (قدم ۱۳)، قدم‌های ۲ تا ۱۱ و ۱۵ را این فرمان خودکار انجام می‌دهد:

```bash
sudo apt update && sudo apt install -y git
sudo mkdir -p /opt/madar && sudo chown "$USER": /opt/madar
git clone https://github.com/amtjtj/madar.git /opt/madar && cd /opt/madar
scripts/deploy/install.sh app.example.ir admin@example.ir
```

این فرمان این کارها را انجام می‌دهد:
- Docker را نصب می‌کند؛
- فایروال را تنظیم می‌کند؛
- روی سرورهای کم‌رم فضای swap می‌سازد؛
- اگر Docker Hub یا npm در دسترس نباشند، آینه داخلی پیدا می‌کند؛
- `.env` را با رمزهای تصادفی می‌سازد؛
- استقرار را انجام می‌دهد.

نکته‌ها:
- اگر وسط کار قطع شد، همان فرمان را دوباره بزنید؛ کارهای انجام‌شده تکرار نمی‌شوند.
- `--demo` در انتها یک سرور دمو با شرکت نمونه «زرین‌مدار» می‌سازد (پیوست «د»).
- بقیه این راهنما همان کارها را قدم‌به‌قدم و دستی توضیح می‌دهد.

## چه چیزی لازم است

| مورد | حداقل | پیشنهاد برای پایلوت (حدود ۲۰۰ نفر) |
|---|---|---|
| سیستم‌عامل | Ubuntu 24.04 LTS (64 بیت) | Ubuntu 24.04 LTS |
| پردازنده | ۲ هسته | ۴ هسته |
| حافظه | ۴ گیگابایت (همراه با swap؛ build کند است) | ۸ گیگابایت |
| دیسک | ۴۰ گیگابایت SSD | ۸۰ گیگابایت SSD یا بیشتر (پشتیبان‌ها و فایل‌ها) |
| شبکه | یک IP عمومی ثابت | همان، دیتاسنتر داخل ایران |
| دامنه | یک دامنه یا زیردامنه با رکورد `A` | — |
| پورت‌ها | ۲۲ (SSH)، ۸۰ و ۴۴۳ (TCP)، ۴۴۳ (UDP، اختیاری برای HTTP/3) | بقیه بسته |

- سرور ابری (VPS) لازم است، نه هاست اشتراکی (cPanel).
- **دستیار هوش مصنوعی** (اختیاری) روی CPU حدود ۱۶ گیگابایت حافظه بیشتر می‌خواهد (پیوست «ه»).

---

## قدم ۱: اتصال به سرور

ارائه‌دهنده IP سرور و رمز یا کلید SSH کاربر `root` (یا `ubuntu`) را به شما می‌دهد. از کامپیوتر خودتان:

```bash
ssh root@<IP-سرور>
```

پیشنهاد می‌شود برای کار روزمره یک کاربر جدا بسازید و دیگر با `root` کار نکنید:

```bash
adduser madar                 # یک رمز برایش بگذارید
usermod -aG sudo madar
# اگر با کلید وارد می‌شوید، کلید را به کاربر تازه هم بدهید:
mkdir -p /home/madar/.ssh && cp ~/.ssh/authorized_keys /home/madar/.ssh/ 2>/dev/null
chown -R madar: /home/madar/.ssh
exit
ssh madar@<IP-سرور>
```

## قدم ۲: به‌روزرسانی Ubuntu

```bash
sudo apt update && sudo apt upgrade -y
sudo timedatectl set-timezone Asia/Tehran      # ساعت سرور (کانتینرها خودشان Asia/Tehran هستند)
[ -f /var/run/reboot-required ] && sudo reboot  # اگر هسته به‌روز شده؛ بعد دوباره SSH کنید
```

## قدم ۳: نصب پیش‌نیازها

فقط Docker و چند ابزار پایه لازم است. Docker از بسته‌های خود Ubuntu نصب می‌شود؛ سایت Docker از ایران بسته است، ولی مخزن Ubuntu ارائه‌دهنده در دسترس است.

```bash
sudo apt install -y git curl ufw ca-certificates docker.io docker-compose-v2 docker-buildx
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

بعد **یک بار از SSH خارج و دوباره وارد شوید** تا عضویت گروه `docker` اعمال شود. سپس:

```bash
docker compose version     # باید نسخه نشان دهد
docker buildx version      # باید نسخه نشان دهد
docker run --rm hello-world 2>&1 | head -3
```

- اگر بسته `docker-buildx` پیدا نشد، Ubuntu قدیمی است؛ Ubuntu 24.04 بگیرید.
- **Docker Hub از سرور در دسترس نیست (تحریم):** آینه ارائه‌دهنده را بگذارید:
  ```bash
  echo '{ "registry-mirrors": ["https://<آینه-ارائه‌دهنده>"] }' | sudo tee /etc/docker/daemon.json
  sudo systemctl restart docker
  ```
  و بعد از قدم ۶، در `.env` مقدار `BASE_REGISTRY` را به `<آینه>/library` و `NPM_REGISTRY` را به آینه npm داخلی تغییر دهید.

**swap روی سرور با کمتر از ۸ گیگ حافظه** (ساخت ایمیج وب حافظه زیادی می‌خواهد):
```bash
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## قدم ۴: قرار دادن پروژه روی سرور

مسیر پروژه: `/opt/madar`

```bash
sudo mkdir -p /opt/madar && sudo chown "$USER": /opt/madar
git clone https://github.com/amtjtj/madar.git /opt/madar
cd /opt/madar
```

- **مخزن خصوصی:** با یک توکن دسترسی فقط‌خواندنی کلون کنید، یا کلید SSH سرور را به‌عنوان «deploy key» به مخزن اضافه کنید.
- **سرور به GitHub دسترسی ندارد:** روی کامپیوتر خودتان `git archive -o madar.tar.gz HEAD` بگیرید و آن را منتقل کنید:
  ```bash
  scp madar.tar.gz madar@<IP>:/opt/madar/
  tar xzf madar.tar.gz -C /opt/madar
  ```
  در این حالت `deploy.sh` کد تازه نمی‌گیرد؛ برای هر به‌روزرسانی همین انتقال را تکرار کنید.

## قدم ۵: نصب وابستگی‌ها

روی خود سرور `npm install` یا `pnpm install` لازم نیست:
- وابستگی‌های Node.js داخل ساخت ایمیج‌ها (قدم ۹) با `pnpm install --frozen-lockfile` و دقیقاً با نسخه‌های `pnpm-lock.yaml` نصب می‌شوند.
- ایمیج نهایی API فقط وابستگی‌های production را دارد.

تنها مورد اختیاری، **فونت Abar** (مجوز تجاری، در git نیست) است. بدون آن فونت Vazirmatn نمایش داده می‌شود. پیش از قدم ۹:
```bash
# فایل‌های AbarLow-*.woff2 را با scp به سرور بیاورید (مثلاً در ~/abar)، بعد:
mkdir -p apps/web/public/fonts/abar && cp ~/abar/AbarLow-*.woff2 apps/web/public/fonts/abar/
```

## قدم ۶: ساخت تنظیمات (`.env`)

اسکریپت زیر `.env` را با رمزهای تصادفی و درست می‌سازد. فایلی را که از قبل هست هیچ‌وقت بازنویسی نمی‌کند.

```bash
cd /opt/madar
scripts/deploy/init-env.sh app.example.ir admin@example.ir
chmod 600 .env
nano .env        # بازبینی؛ معمولاً تغییری لازم نیست
```

همه متغیرها با توضیح هرکدام در `.env.production.example` آمده‌اند. مهم‌ترین‌ها:

| متغیر | چه چیزی بگذارید |
|---|---|
| `MADAR_DOMAIN` | دامنه (بدون `https://`) |
| `CADDY_GLOBAL_OPTIONS` | `email <ایمیل شما>` برای اطلاعیه‌های گواهی |
| `CADDY_TLS` | خالی: گواهی خودکار. گواهی خودتان: `tls /certs/fullchain.pem /certs/privkey.pem` |
| `BASE_REGISTRY`، `NPM_REGISTRY` | آینه داخلی Docker و npm اگر لازم بود (قدم ۳) |
| `POSTGRES_USER`، `POSTGRES_PASSWORD`، `POSTGRES_DB` | مالک پایگاه داده؛ رمز را اسکریپت می‌سازد |
| `DATABASE_URL` | همان مالک به‌شکل URL (مایگریشن) |
| `APP_DATABASE_URL`، `WORKER_DATABASE_URL` | نقش‌های برنامه و worker؛ رمزشان را اسکریپت می‌سازد و مایگریشن نقش‌ها را با همین رمزها درست می‌کند |
| `AUTH_SECRET` | ۴۸ نویسه تصادفی؛ عوض کردنش همه را از حساب بیرون می‌کند و 2FA را خراب می‌کند |
| `TENANT_SIGNUP_CODE` | کد ثبت شرکت تازه در صفحه `/signup` |
| `VAPID_PUBLIC_KEY`، `VAPID_PRIVATE_KEY` | خالی بگذارید؛ اولین استقرار می‌سازد و دیگر نباید عوض شوند |
| `STORAGE_DRIVER` | `local` (پیش‌فرض) یا `s3` با `S3_*` |
| `BACKUP_AT`، `BACKUP_KEEP_*`، `BACKUP_S3_*` | زمان و تعداد پشتیبان‌ها، کپی اختیاری به S3 |

- مقدار هیچ رمزی را دستی از خودتان نسازید. اگر لازم شد: `openssl rand -hex 32`.
- API با مقدار ضعیف یا نمونه اصلاً بالا نمی‌آید.
- **یک نسخه از `.env` را بیرون از سرور نگه دارید** (مثلاً در مدیر رمز). بدون آن، پشتیبان‌ها هم قابل استفاده نیستند.

## قدم ۷: آماده‌سازی پایگاه داده

نصب یا ساخت دستی پایگاه داده لازم نیست:

| مورد | مقدار |
|---|---|
| موتور | PostgreSQL 18 با افزونه pgvector 0.8.1 (ایمیج `madar-postgres:18-pgvector0.8.1`، از `docker/postgres.Dockerfile`) |
| نام پایگاه داده | `madar` (`POSTGRES_DB`) |
| مالک | `madar_owner`: ساخت شما، مایگریشن، پشتیبان |
| کاربر برنامه | `madar_app`: API، همیشه زیر Row-Level Security |
| کاربر worker | `madar_worker`: صف رویدادها |
| محل داده | volume `madar_postgres-data` (با راه‌اندازی مجدد و به‌روزرسانی از بین نمی‌رود) |
| دسترسی از بیرون | ندارد؛ پورت ۵۴۳۲ منتشر نمی‌شود |

در اولین استقرار (قدم ۱۰):
1. کانتینر `postgres` با `POSTGRES_USER` و `POSTGRES_PASSWORD` پایگاه داده `madar` را می‌سازد.
2. سرویس `migrate` جدول‌ها، سیاست‌های RLS و دو نقش `madar_app` و `madar_worker` را می‌سازد.

ورود به پایگاه داده برای بررسی:
```bash
docker compose --env-file .env -f docker/compose.prod.yml -p madar exec postgres psql -U madar_owner madar
```

**seed:**
- روی سرور واقعی هیچ داده نمونه‌ای ساخته نمی‌شود.
- شرکت نمونه فقط با `--demo` (پیوست «د») ساخته می‌شود، چون اسکریپت آن بدون `DEMO_MODE=true` اجرا نمی‌شود.
- `pnpm db:seed` فقط برای کامپیوتر توسعه است و روی سرور اجرا نمی‌شود.

## قدم ۸: مایگریشن

مایگریشن در هر استقرار خودکار و **پیش از** API و worker اجرا می‌شود. API تا پایان موفق آن بالا نمی‌آید.

اجرای دستی (مثلاً برای دیدن خطا):
```bash
docker compose --env-file .env -f docker/compose.prod.yml -p madar run --rm migrate
docker compose --env-file .env -f docker/compose.prod.yml -p madar logs migrate
```

- مایگریشن‌ها فقط رو به جلو هستند (`packages/db/drizzle/*.sql`).
- دوباره اجرا کردنشان بی‌خطر است، چون هر کدام یک بار اعمال می‌شود.
- پیش از هر استقرار پشتیبان گرفته می‌شود.

## قدم ۹: Build

```bash
cd /opt/madar
scripts/deploy/deploy.sh
```

`deploy.sh` ایمیج‌ها را می‌سازد و قدم‌های ۸ و ۱۰ را هم انجام می‌دهد. بار اول ۵ تا ۱۵ دقیقه طول می‌کشد. فرمان‌های build که اجرا می‌کند:

```bash
docker build -f docker/postgres.Dockerfile -t madar-postgres:18-pgvector0.8.1 .   # فقط بار اول
docker build -f docker/api.Dockerfile -t madar-api:<نسخه> .
docker build -f docker/web.Dockerfile -t madar-web:<نسخه> .
```

- **API:** با `pnpm install --frozen-lockfile` و `turbo run build` ساخته می‌شود و فقط وابستگی‌های production در ایمیج می‌ماند. کاربر کانتینر `node` است، نه root.
- **وب:** با `next build` و خروجی `standalone` ساخته می‌شود.
- **نسخه:** شناسه commit git است.
- **پشت پراکسی با گواهی خودش:** `MADAR_BUILD_CA=/path/to/proxy-ca.crt scripts/deploy/deploy.sh`

## قدم ۱۰: اولین اجرا و بررسی

`deploy.sh` (قدم ۹) به ترتیب این کارها را می‌کند:
1. کد تازه را می‌گیرد.
2. پشتیبان می‌گیرد، اگر سرویس‌ها بالا باشند.
3. ایمیج‌ها را می‌سازد.
4. کلید Web Push را در اولین اجرا می‌سازد.
5. با `docker compose up -d --wait` همه را بالا می‌آورد: مایگریشن، سپس API و worker، سپس وب و Caddy.
6. منتظر می‌ماند تا همه سالم شوند.
7. در پایان `status.sh` را نشان می‌دهد.

بررسی:
```bash
scripts/deploy/status.sh
curl -s https://app.example.ir/api/health
```

خروجی سالم:
```json
{"status":"ok","service":"madar-api","version":"<commit>","time":"…","dependencies":{"database":"up","redis":"up","worker":"up"}}
```

- **`"status":"degraded"`:** یکی از وابستگی‌ها `down` است. ببینید کدام، و بخش عیب‌یابی را نگاه کنید.
- **کد HTTP:** این endpoint در هر دو حالت `200` برمی‌گرداند.
- **سلامت کانتینرها:** `healthcheck` داخلی Docker این را جدا می‌سنجد و در `status.sh` با `healthy` دیده می‌شود.

**اولین شرکت:**
1. `https://app.example.ir/signup` را باز کنید.
2. نام شرکت، نام و نام کاربری مدیر، رمز (حداقل ۱۰ نویسه) و `TENANT_SIGNUP_CODE` از `.env` را وارد کنید:
   ```bash
   grep TENANT_SIGNUP_CODE .env
   ```
3. مدیر شرکت بار اول باید تایید دومرحله‌ای (برنامه Authenticator) را فعال کند.
4. بقیه افراد را مدیر از «اعضا» می‌سازد. هر نفر یک نام کاربری و رمز موقت می‌گیرد و بار اول رمزش را عوض می‌کند.

## قدم ۱۱: مدیریت پروسه‌ها (بعد از راه‌اندازی مجدد و crash)

PM2 یا سرویس systemd جدا لازم نیست:
- **بعد از crash:** هر سرویس در `docker/compose.prod.yml` با `restart: unless-stopped` اجرا می‌شود. اگر پروسه‌ای بیفتد، Docker دوباره بالایش می‌آورد.
- **بعد از راه‌اندازی مجدد سرور:** سرویس `docker` با `systemctl enable` فعال است و کانتینرها خودشان برمی‌گردند.
- **پایش:** API، worker و وب `healthcheck` دارند و وضعیتشان در `docker ps` و `status.sh` دیده می‌شود.

آزمون:
```bash
sudo reboot
# بعد از یکی دو دقیقه، دوباره SSH:
cd /opt/madar && scripts/deploy/status.sh
```

| کار | فرمان |
|---|---|
| وضعیت همه | `scripts/deploy/status.sh` |
| راه‌اندازی مجدد یک سرویس | `docker compose --env-file .env -f docker/compose.prod.yml -p madar restart api` (یا `worker`، `web`، `caddy`) |
| توقف همه (داده می‌ماند) | `docker compose --env-file .env -f docker/compose.prod.yml -p madar stop` |
| شروع دوباره | `docker compose --env-file .env -f docker/compose.prod.yml -p madar start` |

اگر این پیشوند طولانی را زیاد لازم دارید، یک نام کوتاه بسازید:
```bash
echo "alias madar='docker compose --env-file /opt/madar/.env -f /opt/madar/docker/compose.prod.yml -p madar'" >> ~/.bashrc && source ~/.bashrc
madar ps
```

## قدم ۱۲: وب‌سرور (Caddy به‌جای Nginx)

**Nginx نصب نکنید.** وب‌سرور جلویی مدار Caddy است، داخل Docker و همراه بقیه سرویس‌ها. تنظیمش در `docker/caddy/Caddyfile` است و دستی کاری لازم ندارد:

| کار | تنظیم |
|---|---|
| دامنه | از `MADAR_DOMAIN` در `.env` |
| HTTPS | گواهی خودکار و تمدید خودکار؛ `http://` به `https://` می‌رود |
| مسیرها | `/api/*` و WebSocket `/api/socket` به API (پورت ۴۰۰۰)، بقیه به وب (پورت ۳۰۰۰) |
| حجم درخواست | ۲ مگابایت برای API، ۱۱۰ مگابایت برای بارگذاری فایل (`/api/uploads`) |
| هدرهای امنیتی | HSTS، `X-Content-Type-Options`، `X-Frame-Options: DENY`، `Referrer-Policy`، `Permissions-Policy`، Content-Security-Policy |
| فشرده‌سازی | zstd و gzip |
| لاگ | یک خط JSON برای هر درخواست، بدون query string، با `X-Request-Id` |

- اعمال تغییر در `Caddyfile`: `docker compose --env-file .env -f docker/compose.prod.yml -p madar restart caddy`.
- **اگر Nginx یا Apache از قبل روی سرور هست:** پورت ۸۰ و ۴۴۳ را گرفته و Caddy بالا نمی‌آید. اگر لازمش ندارید غیرفعالش کنید:
  ```bash
  sudo systemctl disable --now nginx   # یا apache2
  ```
  اگر سایت دیگری روی همان سرور دارید، مدار را روی سرور جدا بگذارید؛ این راهنما فرض می‌کند پورت‌های ۸۰ و ۴۴۳ مال مدار است.

## قدم ۱۳: دامنه (DNS)

در پنل DNS دامنه (ثبت‌کننده دامنه یا سرویس DNS ارائه‌دهنده):

| نوع | نام | مقدار | TTL |
|---|---|---|---|
| `A` | `app` (برای `app.example.ir`)، یا `@` برای خود دامنه | IP عمومی سرور | ۳۰۰ تا ۳۶۰۰ |
| `AAAA` (فقط اگر سرور IPv6 دارد و پورت‌هایش باز است) | همان | IPv6 سرور | همان |

- اگر سرور IPv6 ندارد یا روی IPv6 بسته است، رکورد `AAAA` نسازید؛ گرفتن گواهی را خراب می‌کند.
- اگر از CDN ارائه‌دهنده (مثلاً «پروکسی ابری») استفاده می‌کنید، تا گرفتن اولین گواهی آن را خاموش بگذارید.

بررسی، از سرور یا کامپیوتر خودتان (چند دقیقه بعد از ساخت رکورد):
```bash
dig +short app.example.ir          # باید IP سرور را برگرداند
```

## قدم ۱۴: HTTPS

Caddy گواهی را خودکار از Let's Encrypt (یا ZeroSSL) می‌گیرد و پیش از انقضا تمدید می‌کند. Certbot لازم نیست. شرط‌ها:
1. رکورد `A` دامنه به همین سرور اشاره کند (قدم ۱۳).
2. پورت‌های ۸۰ و ۴۴۳ از اینترنت باز باشند (قدم ۱۵ و فایروال پنل ارائه‌دهنده).
3. `MADAR_DOMAIN` در `.env` درست باشد.

بعد از `deploy.sh`، گواهی معمولاً در چند ثانیه گرفته می‌شود. بررسی:
```bash
curl -sI https://app.example.ir | head -3        # HTTP/2 200
curl -sI http://app.example.ir | grep -i location # https://app.example.ir/
docker compose --env-file .env -f docker/compose.prod.yml -p madar logs caddy | grep -iE "certificate|error" | tail
```

**اگر سرور به سرویس صدور گواهی دسترسی ندارد** (برخی دیتاسنترها)، گواهی خودتان را بگذارید. آن را از ارائه‌دهنده یا یک CA بگیرید؛ زنجیره کامل لازم است:
```bash
cp fullchain.pem privkey.pem /opt/madar/docker/caddy/certs/
nano .env      # CADDY_TLS=tls /certs/fullchain.pem /certs/privkey.pem
scripts/deploy/deploy.sh
```
در این حالت تمدید گواهی با شماست: پیش از انقضا فایل‌ها را جایگزین و `caddy` را restart کنید.

## قدم ۱۵: فایروال

روی سرور فقط SSH و وب باز باشد:
```bash
sudo ufw allow 22/tcp          # اگر SSH روی پورت دیگری است، همان پورت
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp         # HTTP/3، اختیاری
sudo ufw enable
sudo ufw status verbose
```

- پورت‌های ۵۴۳۲ (PostgreSQL)، ۶۳۷۹ (Redis)، ۴۰۰۰ (API) و ۳۰۰۰ (وب) را **باز نکنید**. compose آن‌ها را منتشر نمی‌کند و فقط داخل شبکه Docker در دسترس‌اند.
- فایروال پنل ارائه‌دهنده («Security Group») هم باید ۲۲، ۸۰ و ۴۴۳ را باز داشته باشد.
- **یادداشت:** Docker برای پورت‌های منتشرشده (فقط ۸۰ و ۴۴۳ Caddy) قوانین خودش را مستقیم در iptables می‌گذارد و از `ufw` رد می‌شود. برای این دو پورت که باید باز باشند، این مشکلی نیست.

## قدم ۱۶: به‌روزرسانی و تغییرات بعدی

| کار | فرمان |
|---|---|
| **نسخه تازه کد** | `cd /opt/madar && scripts/deploy/deploy.sh` |
| بررسی بعد از آن | `scripts/deploy/status.sh` |
| برگشت به نسخه قبل | `scripts/deploy/deploy.sh --rollback` |
| تغییر `.env` (بدون کد تازه) | `nano .env` و بعد `scripts/deploy/deploy.sh` (یا فقط `madar up -d --wait`) |
| پشتیبان پیش از کار پرخطر | `scripts/deploy/backup-now.sh` |

`deploy.sh` این کارها را انجام می‌دهد:
- `git pull` می‌کند؛
- پشتیبان می‌گیرد؛
- ایمیج‌ها را با وابستگی‌های تازه می‌سازد. «وابستگی جدید» جدا نصب نمی‌شود؛ `pnpm-lock.yaml` داخل build خوانده می‌شود.
- مایگریشن‌های تازه را اعمال می‌کند؛
- سرویس‌ها را بدون پاک کردن داده جایگزین می‌کند؛
- ایمیج‌های قدیمی را پاک می‌کند.

`--rollback` درباره مایگریشن‌ها:
- مایگریشن‌ها برنمی‌گردند. نسخه‌های پشت‌سرهم با شمای جدید سازگارند.
- اگر نسخه جدید داده را خراب کرده، از پشتیبان بازگردانی کنید (پیوست «الف»).

## قدم ۱۷: لاگ‌ها

| چه چیزی | فرمان |
|---|---|
| خلاصه سلامت و خطاهای ۲۴ ساعت | `scripts/deploy/status.sh` |
| لاگ زنده API | `madar logs -f api` |
| لاگ worker (صف‌ها، اعلان‌ها، یادآورها) | `madar logs -f worker` |
| لاگ وب | `madar logs -f web` |
| لاگ درخواست‌ها و HTTPS | `madar logs -f caddy` |
| لاگ پایگاه داده | `madar logs --tail 200 postgres` |
| لاگ مایگریشن | `madar logs migrate` |
| لاگ پشتیبان | `madar logs --tail 50 backup` و `sudo cat backups/last-check.json` |
| فقط خطاهای API | `madar logs --since 24h api \| grep '"level":"error"'` |
| درخواست‌های ۵۰۰ (با شناسه) | `madar logs --since 24h api \| grep '"status":5'` |
| درخواست‌های ناموفق در Caddy | `madar logs --since 1h caddy \| grep -E '"status":(4\|5)[0-9][0-9]'` |
| crash و restart کانتینرها | `docker ps --format 'table {{.Names}}\t{{.Status}}'` (عدد `Restarting` یا زمان کوتاه `Up`) و `docker events --since 24h --filter event=die` |
| سرویس Docker | `journalctl -u docker --since today` |
| فایروال و SSH | `sudo journalctl -u ssh --since today`، `sudo ufw status` |

(`madar` همان نام کوتاه قدم ۱۱ است؛ بدون آن، جای `madar` بنویسید `docker compose --env-file .env -f docker/compose.prod.yml -p madar`.)

- لاگ‌های API و worker JSON هستند: `level`، `context`، پیام، و برای هر خطای ۵۰۰ `requestId`، مسیر، وضعیت و زمان.
- همان `requestId` در هدر `X-Request-Id` پاسخ و لاگ Caddy هم هست.
- بالا آمدن API با پیام `API listening` و worker با `Worker started` در لاگ دیده می‌شود.
- خطای اتصال به پایگاه داده یا Redis هم در لاگ می‌آید و در `/api/health` با `down` دیده می‌شود.
- **چیزهایی که هرگز در لاگ نوشته نمی‌شوند:** رمز، کوکی، توکن، کلید، query string و متن نامه‌ها و پیام‌ها.
- **چرخش لاگ:** Docker برای هر سرویس حداکثر ۵ فایل ۱۰ مگابایتی نگه می‌دارد، پس دیسک پر نمی‌شود.

## قدم ۱۸: عیب‌یابی

| # | نشانه | علت | راه‌حل |
|---|---|---|---|
| ۱ | `deploy.sh` با `permission denied … docker.sock` متوقف می‌شود | کاربر هنوز عضو گروه `docker` نیست یا دوباره وارد نشده | `sudo usermod -aG docker $USER`، خروج کامل از SSH و ورود دوباره |
| ۲ | ساخت ایمیج با `429 Too Many Requests`، `403` یا timeout روی `registry-1.docker.io` می‌ایستد | Docker Hub از سرور بسته یا محدود است | آینه ارائه‌دهنده در `/etc/docker/daemon.json` (قدم ۳) و `BASE_REGISTRY=<آینه>/library` در `.env`، یا `install.sh` که خودش آینه پیدا می‌کند |
| ۳ | ساخت در `pnpm install` با `ETIMEDOUT` یا `ECONNRESET` می‌ایستد | npm در دسترس نیست | `NPM_REGISTRY=<آینه npm داخلی>` در `.env`؛ اگر پراکسی گواهی خودش را دارد: `MADAR_BUILD_CA=<فایل>` |
| ۴ | ساخت ایمیج وب با `Killed` یا `JavaScript heap out of memory` قطع می‌شود | حافظه کم برای `next build` | swap بسازید (قدم ۳) یا ایمیج‌ها را روی سیستم دیگری بسازید و منتقل کنید (پیوست «و») |
| ۵ | API بالا نمی‌آید و در `madar logs api` خطای `Invalid environment` هست | مقدار ضعیف، نمونه یا ناقص در `.env` (مثلاً `AUTH_SECRET` کوتاه، `TENANT_SIGNUP_CODE` خالی) | پیام دقیقاً متغیر را نام می‌برد؛ آن را در `.env` درست کنید (یا `.env` را با `init-env.sh` از نو بسازید) و `deploy.sh` |
| ۶ | `migrate` با خطای `password authentication failed` شکست می‌خورد | `.env` بعد از ساخت پایگاه داده عوض شده یا پاک و از نو ساخته شده | رمز `POSTGRES_PASSWORD` همانی باشد که پایگاه داده با آن ساخته شده (از نسخه پشتیبان `.env`). روی سرور تازه و بدون داده: `madar down -v` و دوباره `deploy.sh` (**همه داده پاک می‌شود**) |
| ۷ | مرورگر خطای گواهی می‌دهد یا سایت باز نمی‌شود؛ در لاگ Caddy `challenge failed` یا `no such host` | رکورد DNS هنوز نرسیده، `AAAA` اشتباه، پورت ۸۰ یا ۴۴۳ بسته، یا CDN روشن | `dig +short <دامنه>`، باز بودن پورت‌ها در `ufw` و پنل، حذف `AAAA` اشتباه، خاموش کردن CDN؛ بعد `madar restart caddy`. یا گواهی دستی (قدم ۱۴) |
| ۸ | Caddy با `address already in use :80` بالا نمی‌آید | Nginx، Apache یا برنامه دیگری روی ۸۰ یا ۴۴۳ است | `sudo ss -ltnp \| grep -E ':80 \|:443 '` و غیرفعال کردن آن سرویس (قدم ۱۲) |
| ۹ | `/api/health` می‌گوید `"worker":"down"` و اعلان‌ها و یادآورها نمی‌آیند | کانتینر worker افتاده یا به Redis وصل نیست | `madar logs --tail 100 worker`، `madar restart worker`؛ اگر `"redis":"down"` هم هست: `madar logs redis` و فضای دیسک |
| ۱۰ | `/api/health` می‌گوید `"database":"down"` | Postgres در حال راه‌اندازی، دیسک پر، یا رمز نقش برنامه اشتباه | `madar logs --tail 100 postgres`، `df -h`؛ رمز `APP_DATABASE_URL` باید با آخرین مایگریشن یکی باشد (`madar run --rm migrate` نقش‌ها را با رمز `.env` همگام می‌کند) |
| ۱۱ | بارگذاری فایل با `413` یا «فایل بزرگ است» رد می‌شود | فایل از سقف شرکت (پیش‌فرض ۲۵ مگابایت) یا سقف Caddy (۱۱۰ مگابایت) بزرگ‌تر است | سقف را مالک شرکت در «سازمان ← فایل‌ها» تنظیم می‌کند؛ بیش از ۱۰۰ مگابایت پشتیبانی نمی‌شود |
| ۱۲ | ورود بعد از چند تلاش با «تعداد تلاش زیاد» رد می‌شود | محدودیت ورود (۲۰ تلاش در دقیقه برای هر IP، ۵ تلاش 2FA) | یک دقیقه صبر کنید؛ در یک دفتر با یک IP، همه پشت یک IP شمرده می‌شوند |
| ۱۳ | دیسک پر است (`no space left on device`) | ایمیج‌ها، cache ساخت، پشتیبان‌ها یا فایل‌ها | `df -h`، `sudo du -sh /opt/madar/backups`، `docker system df`؛ پاک‌سازی: `docker builder prune -f` و `docker image prune -f`؛ کم کردن `BACKUP_KEEP_*` یا انتقال پشتیبان‌ها به S3 |
| ۱۴ | اعلان روی گوشی نمی‌آید ولی اعلان درون برنامه هست | سرویس push مرورگرها (خارج از ایران) از سرور در دسترس نیست | `PUSH_PROXY_URL` در `.env` (پیوست «ج»)؛ آیفون: فقط از نسخه نصب‌شده روی صفحه اصلی |
| ۱۵ | به‌روزرسانی زنده (WebSocket) کار نمی‌کند و صفحه فقط با refresh عوض می‌شود | یک پراکسی یا CDN بین کاربر و سرور WebSocket را قطع می‌کند | CDN را برای `/api/socket` خاموش کنید یا مستقیم به سرور وصل شوید |
| ۱۶ | بعد از `git pull` خطای `Your local changes would be overwritten` | فایلی از مخزن روی سرور دستی تغییر کرده | `git status`؛ تغییر را به `.env` منتقل کنید و فایل را با `git checkout -- <فایل>` برگردانید |

---

## پیوست الف: پشتیبان و بازگردانی

**خودکار** (سرویس `backup`):
- **زمان‌بندی:**
  - هر شب ساعت ۳:۳۰ به وقت تهران (`BACKUP_AT`) پشتیبان در `backups/daily` گرفته می‌شود.
  - جمعه‌ها یک نسخه هم در `backups/weekly` می‌رود.
  - ۷ نسخه روزانه و ۴ نسخه هفتگی نگه داشته می‌شود.
- **آزمون بازگردانی:**
  - بعد از هر پشتیبان، فایل در یک پایگاه موقت بازگردانی و شمارش جدول‌ها مقایسه می‌شود.
  - نتیجه در `backups/last-check.json` است و `status.sh` آن را نشان می‌دهد.
  - پشتیبانی که بازگردانی نشود با پسوند `.failed` کنار گذاشته می‌شود و جای پشتیبان سالم را نمی‌گیرد.
- **پشتیبان‌های دستی و پیش از استقرار:** در `backups/manual` می‌روند (۵ نسخه آخر).
- **فایل‌های پیوست:**
  - کنار هر پشتیبان یک آرشیو `.files.tar.gz` دارند.
  - هر پشتیبان یک نسخه کامل از فایل‌هاست؛ فضای دیسک را با `status.sh` زیر نظر داشته باشید.
- **دسترسی:** فایل‌ها داده همه شرکت‌ها را دارند و فقط root می‌تواند بخواندشان.

**دستی:** `scripts/deploy/backup-now.sh`

**کپی بیرون از سرور (به‌شدت توصیه می‌شود)، یکی از این دو راه:**
- **S3:**
  - `BACKUP_S3_ENDPOINT`، `BACKUP_S3_BUCKET`، `BACKUP_S3_ACCESS_KEY` و `BACKUP_S3_SECRET_KEY` را در `.env` بگذارید و `deploy.sh` را اجرا کنید.
  - bucket خصوصی باشد. فایل‌ها رمزنگاری نمی‌شوند.
  - پاک کردن نسخه‌های قدیمی با «قانون چرخه عمر» پنل ارائه‌دهنده است.
- **دستی:**
  ```bash
  sudo tar czf ~/backups.tgz -C /opt/madar backups && sudo chown $USER ~/backups.tgz
  # روی کامپیوتر خودتان:
  scp madar@<IP>:~/backups.tgz .
  ```

**بازگردانی** (همه داده فعلی با فایل پشتیبان جایگزین می‌شود):
```bash
sudo ls backups/daily backups/manual
scripts/deploy/restore.sh backups/daily/madar_2026-10-18_0330.dump
```
اسکریپت به این ترتیب کار می‌کند:
1. تایید می‌خواهد.
2. از داده فعلی پشتیبان می‌گیرد.
3. فایل را در پایگاه جدا بازگردانی می‌کند. اگر شکست بخورد، پایگاه فعلی دست‌نخورده می‌ماند.
4. فقط بعد از بازگردانی کامل، برنامه را متوقف و پایگاه‌ها را جابه‌جا می‌کند.
5. داده قبلی را تا بازگردانی بعدی به نام `madar_before_restore` نگه می‌دارد.
6. فایل‌های پیوست را هم برمی‌گرداند.

بعد از اولین استقرار یک بار این را تمرین کنید.

**انتقال به سرور جدید:**
1. روی سرور جدید قدم‌های ۱ تا ۵ را انجام دهید.
2. همان `.env` قدیمی را بگذارید.
3. `deploy.sh` را اجرا کنید.
4. فایل پشتیبان را به `backups/manual/` منتقل کنید و `restore.sh` را اجرا کنید.

## پیوست ب: فایل‌های پیوست

| مورد | مقدار |
|---|---|
| محل ذخیره | volume `madar_files-data` (داخل کانتینرها `/data/files`)؛ هر فایل زیر پوشه شناسه شرکت خودش |
| مالک و دسترسی | کاربر `node` داخل کانتینر؛ از بیرون فقط با `sudo`. پوشه‌ای روی سرور لازم نیست ساخته شود |
| بعد از restart یا به‌روزرسانی | می‌ماند؛ volume با `deploy.sh`، restart و reboot پاک نمی‌شود (فقط `down -v` پاکش می‌کند) |
| آدرس فایل‌ها | فقط از راه API (`/api/attachments/...`) و بعد از بررسی دسترسی همان لحظه؛ آدرس مستقیم یا عمومی ندارد |
| سقف حجم | تنظیم مالک شرکت در «سازمان ← فایل‌ها» (پیش‌فرض ۲۵ مگابایت، حداکثر ۱۰۰)؛ Caddy بالای ۱۱۰ مگابایت را رد می‌کند |
| اعتبارسنجی | فهرست مجاز نوع فایل، تشخیص نوع واقعی از محتوای فایل (نه نام آن)، پاک‌سازی نام فایل؛ نام کلید ذخیره از شناسه ساخته می‌شود، نه از نام فایل (جلوی path traversal) |
| فایل‌های رهاشده | worker فایل‌هایی را که به چیزی وصل نشدند یا حذف شدند، پاک می‌کند |

**S3 به‌جای دیسک سرور** (وقتی فایل‌ها از چند ده گیگابایت بیشتر شدند):
- در `.env` بگذارید `STORAGE_DRIVER=s3` و `S3_ENDPOINT`، `S3_BUCKET`، `S3_ACCESS_KEY` و `S3_SECRET_KEY` را پر کنید (bucket خصوصی). بعد `deploy.sh` را اجرا کنید.
- فایل‌های قبلی خودکار منتقل نمی‌شوند.
- پشتیبان فایل‌ها در این حالت کار ذخیره‌ساز است، مثلاً نسخه‌بندی bucket.

## پیوست ج: اعلان روی گوشی (Web Push)

- کلیدها در اولین استقرار ساخته می‌شوند. **هرگز عوضشان نکنید**؛ همه دستگاه‌ها باید دوباره اعلان را روشن کنند.
- سرویس push مرورگرها خارج از ایران است. اگر سرور به آن نمی‌رسد، یک پراکسی خروجی در `PUSH_PROXY_URL` بگذارید. اعلان درون برنامه و به‌روزرسانی زنده در هر حال کار می‌کنند.
- آیفون: اعلان فقط وقتی کار می‌کند که مدار از Safari به صفحه اصلی اضافه شده باشد.

## پیوست د: سرور دمو

با `init-env.sh <دامنه> <ایمیل> --demo` (یا `install.sh … --demo`):

| مورد | توضیح |
|---|---|
| حساب‌ها | `leila.sadeghi` (مدیرعامل)، `maryam.ahmadi` (مدیر پشتیبانی)، `ali.rezaei` (کارمند)، `reza.karimi` (مالک؛ بار اول 2FA). رمز همه: `DEMO_PASSWORD` در `.env` |
| تازه‌سازی | هر شب ساعت ۵ تهران (`DEMO_RESET_AT`) داده پاک و از نو ساخته می‌شود |
| تازه‌سازی دستی | `madar exec demo node dist/scripts/demo-reset.js` |
| آزمون خودکار | با Node و pnpm روی سرور (`pnpm install` و `pnpm --filter @madar/web exec playwright install chromium`): `scripts/deploy/smoke.sh` (یا `--restore` برای تمرین بازگردانی) |

متن جلسه دمو: `docs/demo-script.md`. **هرگز سرور دمو را برای داده واقعی استفاده نکنید**؛ هر شب پاک می‌شود.

## پیوست ه: دستیار مدار (اختیاری)

دستیار (ADR 0025) روی همین سرور و با مدل اوپن‌سورس اجرا می‌شود:
- سرویس دستیار و مدل روی شبکه داخلی Docker (`ai`) هستند که راهی به اینترنت ندارد، پس هیچ داده‌ای از سرور بیرون نمی‌رود.
- بدون این بخش، مدار کامل کار می‌کند و گزینه‌های دستیار دیده نمی‌شوند.

**روی CPU (حدود ۱۶ گیگ حافظه بیشتر):**
1. فایل مدل را یک بار در `models/` کنار مخزن بگذارید، مثلاً `qwen2.5-7b-instruct-q4_k_m.gguf` (حدود ۴٫۷ گیگ). مدل جست‌وجو را هم بگذارید: `bge-m3-Q8_0.gguf` (حدود ۶۰۰ مگ).
   ```bash
   mkdir -p /opt/madar/models
   # روی کامپیوتر خودتان:
   scp qwen2.5-7b-instruct-q4_k_m.gguf bge-m3-Q8_0.gguf madar@<IP>:/opt/madar/models/
   ```
2. در `.env`:
   ```bash
   COMPOSE_PROFILES=ai,llm-cpu
   AI_SERVICE_URL=http://ai:4200
   LLM_THREADS=4
   EMBED_THREADS=2
   AI_ASK_MAX_DISTANCE=0.6
   ```
3. `scripts/deploy/deploy.sh` را اجرا کنید. ایمیج‌های مدل از `ghcr.io` هستند؛ اگر در دسترس نیستند، از آینه داخلی بکشید و نامش را در `LLM_CPU_IMAGE` بگذارید.
4. بررسی: `status.sh` در بخش «Assistant» باید `reachable` بنویسد.
5. ادمین هر شرکت در «سازمان ← دستیار» آن را روشن می‌کند.

**روی GPU** (حداقل ۲۴ گیگ حافظه کارت، درایور NVIDIA و `nvidia-container-toolkit`): وزن‌ها را در `models/Qwen2.5-7B-Instruct/` بگذارید و `COMPOSE_PROFILES=ai,llm-gpu` کنید.

**اگر PyPI در دسترس نیست:** `PIP_INDEX_URL` را در `.env` به آینه داخلی بدهید.

## پیوست و: ساخت ایمیج بدون اینترنت روی سرور

1. روی سیستمی با دسترسی و همان نسخه کد:
   ```bash
   TAG=$(git rev-parse --short HEAD)
   docker build -f docker/api.Dockerfile -t madar-api:$TAG .
   docker build -f docker/web.Dockerfile -t madar-web:$TAG .
   docker build -f docker/postgres.Dockerfile -t madar-postgres:18-pgvector0.8.1 .
   docker pull postgres:18-alpine && docker pull redis:8-alpine && docker pull caddy:2-alpine
   docker save madar-api:$TAG madar-web:$TAG madar-postgres:18-pgvector0.8.1 postgres:18-alpine redis:8-alpine caddy:2-alpine | gzip > madar-images.tar.gz
   ```
2. روی سرور (در `.env`: `BASE_REGISTRY=docker.io/library`):
   ```bash
   gunzip -c madar-images.tar.gz | docker load
   scripts/deploy/deploy.sh --no-build <TAG>
   ```

## پیوست ز: چه چیزی کجاست

| مورد | Git | روی سرور |
|---|---|---|
| کد، Dockerfileها، `docker/compose.prod.yml`، `Caddyfile`، اسکریپت‌ها، `pnpm-lock.yaml`، مایگریشن‌ها | بله | با `git clone` و `git pull` |
| `.env.example`، `.env.production.example` | بله (فقط الگو، بدون رمز واقعی) | — |
| `.env` | **هرگز** | ساخته‌شده با `init-env.sh`، دسترسی ۶۰۰، با نسخه‌ای بیرون از سرور |
| `node_modules`، `dist`، `.next`، `.turbo` | هرگز | لازم نیست؛ داخل ایمیج‌ها ساخته می‌شوند |
| ایمیج‌های Docker | — | ساخته‌شده با `deploy.sh` |
| داده پایگاه داده، Redis، فایل‌ها، گواهی‌ها | — | volumeهای Docker: `madar_postgres-data`، `madar_redis-data`، `madar_files-data`، `madar_caddy-data` |
| `backups/` | هرگز | ساخته‌شده توسط سرویس `backup` |
| `.deploy/` | هرگز | نسخه فعلی و قبلی برای `--rollback` |
| `models/`، فونت Abar، `docker/caddy/certs/*.pem` | هرگز (حجم زیاد یا مجوز جدا) | دستی، در صورت نیاز |

برای اجرای production این‌ها روی سرور لازم نیستند و می‌توانید نادیده بگیرید:
- `apps/*/test`، `e2e/`، `docs/` (به‌جز این راهنما)؛
- `docker/docker-compose.yml` (فقط توسعه)؛
- `scripts/deploy/local-demo.sh`.

پاک کردنشان از نسخه git لازم نیست و `deploy.sh` به آن‌ها کاری ندارد.

## چک‌لیست بعد از استقرار

- [ ] `https://<دامنه>` با قفل سبز باز می‌شود و `http://` به `https://` می‌رود
- [ ] `scripts/deploy/status.sh`: همه سرویس‌ها `healthy`، سلامت API `ok`
- [ ] `/signup` با `TENANT_SIGNUP_CODE`، فعال کردن 2FA مدیر، ساخت یک عضو و ورود او
- [ ] بارگذاری یک فایل روی یک کار و باز کردن دوباره آن
- [ ] نصب روی صفحه اصلی گوشی (اندروید: منوی Chrome ← «نصب برنامه»؛ آیفون: Safari ← اشتراک‌گذاری ← «افزودن به صفحه اصلی»)
- [ ] `sudo reboot` و برگشت خودکار همه سرویس‌ها
- [ ] فردای استقرار: `sudo cat backups/last-check.json` با `"ok":true`
- [ ] یک بار تمرین `restore.sh`
- [ ] نسخه‌ای از `.env` بیرون از سرور
