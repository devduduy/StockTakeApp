# Hero Stock Take Mobile & Web

Hero Stock Take adalah sistem stock opname untuk Hero Supermarket dengan tiga lapisan utama:

- Android native untuk HHT/Urovo sebagai alat scan di toko.
- Backend API Express.js + TypeScript sebagai penghubung mobile/web ke SQL Server.
- Web Angular 18 standalone untuk operasional schedule, master rack, monitoring, print, dan recheck.

Mobile dan web tidak terhubung langsung ke database. Semua data aplikasi masuk melalui Backend API agar rules, auth, validasi category, rack scope, print lock, dan status lifecycle konsisten.

## Struktur project

```text
StockTakeApp
├── app/                # Android native Java/XML untuk HHT scanner
├── backend/            # Express.js + TypeScript + SQL Server API
├── frontend/           # Angular 18 standalone operational web
└── documentation/      # PRD, ERD, design reference, connection note lokal
```

## Status fitur utama

- Login JWT berbasis `dbo.MST_USERS` dan `dbo.MST_ROLE`.
- Mapping akses lokasi via `MST_USERS.LOC_CODE`; Inventory Control dapat akses semua lokasi.
- Schedule ALL/PARTIAL dengan `CATEGORY_ID` multi-value dari `MasterData.dbo.MFCATEGORY`.
- Periode schedule memakai `startDate` dan `endDate`.
- Rack scope per schedule melalui `dbo.TR_STOCK_SCHEDULE_RACK`.
- Master rack web dengan create manual dan bulk generator kode `RCK-{2 huruf}-{3 angka}`.
- Mobile dashboard schedule aktif, carousel schedule, rack list, scan barcode, edit/delete draft, submit, dan lock setelah printed.
- Lookup barcode/PLU real dari `MasterData.dbo.MFBARCODE` dan `MasterData.dbo.MFPLU`.
- Validasi scan PARTIAL: category item wajib masuk scope schedule.
- Submit mobile tersimpan ke `dbo.TR_STOCK_TAKE_SCAN`.
- Web monitoring rack real-time, print rack, final qty correction, confirm/reject rack.
- Print rack menghasilkan kertas kerja recheck dengan kolom `Qty Checker`.

## Menjalankan lokal

Backend:

```powershell
npm.cmd --prefix backend install
Copy-Item backend\.env.example backend\.env
npm.cmd --prefix backend run db:migrate
npm.cmd --prefix backend run db:seed
npm.cmd --prefix backend run dev
```

Edit [backend/.env](backend/.env) untuk koneksi lokal, lokasi seed user, password seed, JWT secret, dan guard reset. File `.env` sudah di-ignore oleh Git; template aman ada di [backend/.env.example](backend/.env.example).

Frontend web:

```powershell
npm.cmd --prefix frontend install
npm.cmd --prefix frontend start
```

Android:

```powershell
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat assembleDebug
```

Web dibuka di `http://127.0.0.1:4200/`. Backend default di `http://127.0.0.1:3000/`.

Untuk HHT/Urovo fisik, `stocktake.apiBaseUrl` di `local.properties` harus memakai IP laptop/server backend yang bisa dijangkau device, misalnya:

```properties
stocktake.apiBaseUrl=http://172.16.30.130:3000/
```

Backend lokal untuk device fisik harus listen ke `0.0.0.0`, bukan hanya `127.0.0.1`.

## Database aplikasi

Database aplikasi aktif berada di SQL Server database StockTake. Master perusahaan tetap dibaca dari `MasterData`:

- `MasterData.dbo.MFBARCODE`: mapping barcode ke PLU.
- `MasterData.dbo.MFPLU`: master PLU, deskripsi, dan category.
- `MasterData.dbo.MFDIVISION -> MFDEPARTMENT -> MFCATEGORY`: hierarchy category.
- `MasterData.dbo.MFLOCATION`: nama lokasi/store.

Tabel aplikasi yang dikelola sistem:

- `dbo.MST_ROLE`
- `dbo.MST_STOCK_TYPE`
- `dbo.MST_USERS`
- `dbo.MST_RACK`
- `dbo.MST_SOH`
- `dbo.TR_STOCK_SCHEDULE`
- `dbo.TR_STOCK_SCHEDULE_RACK`
- `dbo.TR_STOCK_TAKE_SCAN`

## Reset data testing

Untuk testing dengan data bersih, backend menyediakan script reset yang menghapus data aplikasi untuk semua lokasi, bukan hanya `6168`.

Dry-run default, tidak menghapus data:

```powershell
npm.cmd --prefix backend run db:reset:test
```

Eksekusi delete betulan:

```powershell
$env:CONFIRM_RESET="YES"
$env:RESET_SCOPE="ALL"
$env:RESET_DRY_RUN="NO"
npm.cmd --prefix backend run db:reset:test
```

Script reset tidak menyentuh database lama `MasterData`.

Setelah reset, jalankan ulang:

```powershell
npm.cmd --prefix backend run db:migrate
npm.cmd --prefix backend run db:seed
```

Seed setelah reset hanya mengisi data minimum untuk login dan reference sistem: role, stock type, dan demo users. Data yang sudah bisa dibuat dari UI seperti `MST_RACK` dan `TR_STOCK_SCHEDULE` tidak dibuat lagi oleh seed.

Untuk membuat user test multi lokasi, isi `SEED_LOC_CODES` sebelum menjalankan seed. Kode numerik pendek otomatis dipadatkan ke 4 digit, jadi `23` menjadi `0023`:

```powershell
$env:SEED_LOC_CODES="6168,23"
npm.cmd --prefix backend run db:seed
```

Contoh user yang dibuat:

- `inventory_control01` untuk akses semua lokasi.
- `scanner01` dan `store_manager01` untuk lokasi pertama.
- `scanner_6168`, `store_manager_6168`, `admin_store_6168`.
- `scanner_0023`, `store_manager_0023`, `admin_store_0023`.

Password default seed adalah `prototype`; bisa diganti dengan:

```powershell
$env:SEED_PASSWORD="password-test-baru"
$env:SEED_LOC_CODES="6168,23"
npm.cmd --prefix backend run db:seed
```

## Build dan validasi

```powershell
npm.cmd --prefix backend run build
npm.cmd --prefix backend run test
npm.cmd --prefix frontend run build
.\gradlew.bat testDebugUnitTest assembleDebug lintDebug
```

## Dokumentasi terkait

- Backend API: [backend/README.md](backend/README.md)
- Web Angular: [frontend/README.md](frontend/README.md)
- Design system: [documentation/stitch_hero_stock_take_system/DESIGNmd/DESIGN.md](documentation/stitch_hero_stock_take_system/DESIGNmd/DESIGN.md)
- Panduan agent/Codex: [AGENTS.md](AGENTS.md)
