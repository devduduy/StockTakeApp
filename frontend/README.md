# Hero Stock Take Web

Frontend web operasional Hero Stock Take menggunakan Angular 18 standalone.
Web memakai Backend API yang sama dengan aplikasi Android sehingga schedule,
rack, hasil scan, dan status print tetap berasal dari satu sumber data.

## Tahap 1 — Fondasi (selesai)

- Login JWT melalui `POST /api/auth/login`.
- Session disimpan di `sessionStorage` dan otomatis dibersihkan saat token tidak valid.
- Auth guard dan interceptor Bearer token.
- Responsive app shell dengan sidebar dan mobile drawer.
- Dashboard live dari data schedule/rack real.
- Daftar schedule dengan pencarian dan filter ALL/PARTIAL.
- Monitoring rack dengan status Belum Scan, Sudah Submit, dan Sudah Print.
- Detail item tersubmit per rack.
- Auto-refresh dashboard 15 detik dan monitoring rack 10 detik.
- Loading, empty, dan error state untuk semua request utama.

## Menjalankan lokal

Jalankan backend terlebih dahulu dari root project:

```powershell
npm.cmd --prefix backend run dev
```

Lalu jalankan frontend:

```powershell
npm.cmd --prefix frontend start
```

Buka `http://127.0.0.1:4200/`. Development server meneruskan request `/api`
ke `http://127.0.0.1:3000` melalui `proxy.conf.json`.

Untuk build dan test:

```powershell
npm.cmd --prefix frontend run build
npm.cmd --prefix frontend test -- --watch=false --browsers=ChromeHeadless
```

## Struktur

```text
src/app
├── core
│   ├── api       # HTTP service dan normalisasi error
│   ├── auth      # session, guard, interceptor
│   └── models    # kontrak response Backend API
├── features
│   ├── login
│   ├── dashboard
│   ├── schedules
│   └── racks
└── layout        # responsive app shell
```

## Tahapan berikutnya

1. Backend CRUD schedule dan form web pembuatan/edit schedule ALL/PARTIAL.
2. Master lokasi, rack, user, role, dan category selector bertingkat.
3. Live scan monitoring lintas HHT dengan filter dan pagination server-side.
4. Recheck dan quantity correction dengan audit trail.
5. Print preview, penerbitan `PRINT_NO`, locking rack, dan laporan.
6. Role-based access control, audit log, dan hardening deployment.
