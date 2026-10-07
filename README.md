# Inventory & Work Order Admin — Production v2

Versi ini menggunakan server Node.js + PostgreSQL sehingga data tersimpan terpusat dan dapat diakses dari laptop, Android, dan iPhone melalui browser.

## Fitur
- Login Admin
- Session tersimpan di PostgreSQL
- Dashboard
- Material Master
- Low Stock Alert
- Work Order
- Update status Work Order
- Purchase / Receiving
- Stock otomatis bertambah
- Weighted Average Price sederhana
- Material Usage ke Work Order
- Stock otomatis berkurang
- Validasi stok tidak boleh minus
- Work Order Material Cost
- Report biaya material per WO
- Audit Log
- Backup data ke file JSON
- Responsive desktop / Android / iPhone
- PWA manifest

## Cara tercepat menjalankan — Docker

### 1. Install
- Docker Desktop

### 2. Jalankan
Di folder project:

```bash
docker compose up --build
```

Buka:
- http://localhost:3000

Login default:
- Username: `admin`
- Password: `Admin123!`

**PENTING:** ganti password/credential sebelum dipasang ke internet.

## Konfigurasi produksi
Salin `.env.example` menjadi `.env`, lalu ganti:

- `DATABASE_URL`
- `SESSION_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

Jika reverse proxy HTTPS sudah aktif, dapat tambahkan:
- `FORCE_HTTPS=true`

## Sinkron antar perangkat
Semua perangkat harus mengakses URL server yang sama. Karena data disimpan di PostgreSQL pusat, perubahan dari laptop akan terlihat di HP setelah refresh.

Contoh jika server berada di jaringan lokal:
- `http://192.168.1.10:3000`

Untuk akses dari luar jaringan, deploy ke VPS / Render / Railway / Fly.io / server perusahaan.

## Backup
Menu **Backup** menyediakan backup JSON operasional.

Untuk backup PostgreSQL penuh di server:
```bash
pg_dump "$DATABASE_URL" > inventory-full-backup.sql
```

Untuk restore:
```bash
psql "$DATABASE_URL" < inventory-full-backup.sql
```

## Catatan keamanan
Sebelum internet/public deployment:
1. Ganti `SESSION_SECRET`
2. Ganti password Admin
3. Aktifkan HTTPS
4. Batasi akses database agar tidak terbuka ke internet
5. Simpan `.env` hanya di server
6. Jadwalkan `pg_dump`
7. Gunakan reverse proxy seperti Nginx/Caddy atau platform hosting dengan HTTPS otomatis


# Deployment Cloud — Render (tanpa Docker di laptop kantor)

Project ini sudah disiapkan agar dapat dijalankan langsung di Render.

## Alur
Browser laptop/Android/iPhone → Render Web Service → Render PostgreSQL.

## Upload source code tanpa install Git
1. Buat akun GitHub melalui browser.
2. Buat repository baru, misalnya `inventory-admin-v2`.
3. Ekstrak ZIP project ini.
4. Di repository GitHub pilih **Add file → Upload files**.
5. Upload seluruh isi folder project, termasuk `server.js`, `package.json`, `render.yaml`, folder `public`, `scripts`, dan `sql`.
6. Commit changes.

JANGAN upload file `.env` yang berisi password/secret.

## Deploy ke Render
1. Login ke Render.
2. Pilih **New → Blueprint**.
3. Hubungkan repository GitHub `inventory-admin-v2`.
4. Render membaca file `render.yaml`.
5. Isi secret `ADMIN_PASSWORD` saat diminta.
6. Deploy.

Render akan membuat Web Service Node.js dan PostgreSQL database, lalu mengisi `DATABASE_URL` otomatis.

## Login
Username default: `admin`
Password: password yang Anda isi pada environment variable `ADMIN_PASSWORD`.

## Catatan Free Plan
Web service gratis dapat sleep setelah tidak aktif, sehingga akses pertama berikutnya mungkin lebih lambat.

## Keamanan
- Gunakan password admin yang kuat.
- Jangan taruh password/database URL di GitHub.
- Gunakan HTTPS Render.
- Untuk penggunaan kantor serius, pertimbangkan paket database/web berbayar dan backup terjadwal.
