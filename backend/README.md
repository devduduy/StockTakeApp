# Hero Stock Take API

Backend Express.js + TypeScript untuk mobile HHT dan web Hero Stock Take. Backend menjadi satu-satunya akses aplikasi ke SQL Server agar rules bisnis, auth, validasi scan, dan status lifecycle tidak tersebar di client.

## Scope saat ini

- Login JWT dari `dbo.MST_USERS` + `dbo.MST_ROLE`.
- Role dan lokasi:
  - `SCANNER` hanya untuk scan mobile.
  - Store role mengikuti `MST_USERS.LOC_CODE`.
  - Tim user per schedule aktif disimpan di `dbo.TR_STOCK_SCHEDULE_USER`.
  - User dengan `LOC_CODE` sama seperti lokasi schedule otomatis menjadi peserta schedule; user bantuan dari lokasi lain ditambahkan dari Tim Schedule.
  - `INVENTORY_CONTROL` dapat akses semua lokasi.
- Schedule:
  - Nomor unik format `ST/yyyy/MM/0001`.
  - `START_DATE` memakai kolom `SCHEDULE_DATE`.
  - `END_DATE` wajib tersedia lewat migration.
  - Stock type hanya `ALL` dan `PARTIAL`.
  - `CATEGORY_ID` menyimpan multi category untuk schedule PARTIAL.
  - User bantuan dari toko lain bisa ditugaskan langsung di schedule tanpa mengubah lokasi asli user.
- Rack:
  - Master rack di `dbo.MST_RACK`.
  - Format kode rack wajib `RCK-{2 huruf}-{3 angka}`, contoh `RCK-FR-001`.
  - Bulk generator rack tersedia via API.
  - Scope rack per schedule disimpan di `dbo.TR_STOCK_SCHEDULE_RACK`.
- Scan:
  - Lookup barcode/PLU dari `MasterData.dbo.MFBARCODE` dan `MasterData.dbo.MFPLU`.
  - Validasi category untuk schedule PARTIAL.
  - Submit mobile tersimpan ke `dbo.TR_STOCK_TAKE_SCAN`.
  - `RACK_SEQ` menyimpan urutan waktu scan dan tidak berubah saat edit qty.
- Recheck web:
  - Print rack menerbitkan/memperbarui print metadata.
  - Final qty correction mengubah `FINAL_QTY`, tidak mengubah `SCAN_QTY`.
  - Confirm/reject rack tersedia untuk flow recheck.

## First run

```powershell
npm.cmd --prefix backend install
Copy-Item backend\.env.example backend\.env
npm.cmd --prefix backend run db:migrate
npm.cmd --prefix backend run db:seed
npm.cmd --prefix backend run dev
```

Health check:

```text
GET http://127.0.0.1:3000/api/health
```

## Konfigurasi SQL Server

`backend/.env.example` mendukung dua cara konfigurasi:

1. `STOCKTAKE_CONNECTION_FILE` menunjuk ke file koneksi lokal.
2. Isi langsung `SQL_SERVER`, `SQL_PORT`, `SQL_DATABASE`, `SQL_USER`, dan `SQL_PASSWORD`.

Untuk dummy in-memory tanpa SQL Server:

```env
SQL_MODE=mock
```

Untuk koneksi SQL real:

```env
SQL_MODE=sql
STOCKTAKE_CONNECTION_FILE=../documentation/connection DB.txt
```

Secret harus tetap di `.env` atau file koneksi lokal yang tidak di-commit.

`backend/.env` sudah di-ignore oleh Git. Gunakan file itu untuk value lokal yang boleh kamu edit bebas. Jika ingin mulai ulang template:

```powershell
Copy-Item backend\.env.example backend\.env -Force
```

Bagian yang biasanya perlu kamu edit:

```env
SQL_MODE=sql
STOCKTAKE_CONNECTION_FILE=../documentation/connection DB.txt
SEED_LOC_CODES=6168,23
SEED_PASSWORD=prototype
JWT_SECRET=change-this-local-development-secret-at-least-32-characters
CORS_ORIGINS=http://127.0.0.1:4200,http://localhost:4200
```

Kalau memakai SQL value langsung, kosongkan/comment `STOCKTAKE_CONNECTION_FILE`, lalu isi:

```env
SQL_SERVER=nama-server-atau-ip
SQL_PORT=1433
SQL_DATABASE=StockTake
SQL_USER=your_sql_user
SQL_PASSWORD=your_sql_password
```

## Command database

Migration:

```powershell
npm.cmd --prefix backend run db:migrate
```

Seed dummy idempotent:

```powershell
npm.cmd --prefix backend run db:seed
```

Seed hanya mengisi data minimum yang dibutuhkan sistem:

- `MST_ROLE`
- `MST_STOCK_TYPE`
- `MST_USERS`

Seed tidak lagi membuat `MST_RACK`, `TR_STOCK_SCHEDULE`, atau data transaksi karena data tersebut sudah bisa dibuat dari UI web.

Untuk membuat user test di beberapa lokasi:

```powershell
$env:SEED_LOC_CODES="6168,23"
npm.cmd --prefix backend run db:seed
```

Nilai numerik pendek akan dinormalisasi menjadi 4 digit, jadi `23` menjadi `0023`. Dengan contoh di atas, seed membuat/memperbarui user:

- `inventory_control01` dengan `LOC_CODE=0000`.
- `scanner01` dan `store_manager01` untuk lokasi pertama di `SEED_LOC_CODES`.
- `scanner_6168`, `store_manager_6168`, `admin_store_6168`.
- `scanner_0023`, `store_manager_0023`, `admin_store_0023`.

Password default adalah `prototype`. Untuk mengganti password seed:

```powershell
$env:SEED_PASSWORD="password-test-baru"
$env:SEED_LOC_CODES="6168,23"
npm.cmd --prefix backend run db:seed
```

Reset data testing semua lokasi, dry-run default:

```powershell
npm.cmd --prefix backend run db:reset:test
```

Reset delete betulan:

```powershell
$env:CONFIRM_RESET="YES"
$env:RESET_SCOPE="ALL"
$env:RESET_DRY_RUN="NO"
npm.cmd --prefix backend run db:reset:test
```

Tabel aplikasi yang dihapus oleh reset:

- `dbo.TR_STOCK_TAKE_SCAN`
- `dbo.TR_STOCK_SCHEDULE_USER`
- `dbo.TR_STOCK_SCHEDULE_RACK`
- `dbo.TR_STOCK_SCHEDULE`
- `dbo.MST_SOH`
- `dbo.MST_RACK`
- `dbo.MST_USERS`
- `dbo.MST_STOCK_TYPE`
- `dbo.MST_ROLE`

Reset tidak menyentuh `MasterData..MFPLU`, `MasterData..MFBARCODE`, `MasterData..MFCATEGORY`, atau master lama lain.

Credential seed:

| Username | Password | Role |
|---|---|---|
| `scanner01` | `prototype` | Scanner |
| `store_manager01` | `prototype` | Store Manager |
| `inventory_control01` | `prototype` | Inventory Control |
| `scanner_<locCode>` | `prototype` | Scanner lokasi terkait |
| `store_manager_<locCode>` | `prototype` | Store Manager lokasi terkait |
| `admin_store_<locCode>` | `prototype` | Admin Store lokasi terkait |

Ganti password dummy dan `JWT_SECRET` sebelum production.

## Endpoint utama

Semua endpoint stock-take membutuhkan:

```http
Authorization: Bearer <accessToken>
```

Auth:

- `POST /api/auth/login`
- `GET /api/auth/recheckers`

Reference:

- `GET /api/health`
- `GET /api/stock-take/locations`
- `GET /api/stock-take/categories`

Schedule:

- `GET /api/stock-take/schedules`
- `GET /api/stock-take/schedules/active`
- `POST /api/stock-take/schedules`
- `PUT /api/stock-take/schedules/:scheduleId`

Rack:

- `GET /api/stock-take/racks?locCode=6168`
- `POST /api/stock-take/racks`
- `POST /api/stock-take/racks/bulk`
- `GET /api/stock-take/schedules/:scheduleId/racks`
- `POST /api/stock-take/schedules/:scheduleId/racks/scope`

Item dan scan:

- `GET /api/stock-take/items/lookup?barcode=<barcode-atau-plu>&scheduleId=<scheduleId>`
- `GET /api/stock-take/schedules/:scheduleId/racks/:rackId/scans`
- `POST /api/stock-take/schedules/:scheduleId/racks/:rackId/scans`
- `POST /api/stock-take/schedules/:scheduleId/racks/:rackId/submit`
- `POST /api/stock-take/schedules/:scheduleId/racks/:rackId/print`
- `PATCH /api/stock-take/schedules/:scheduleId/racks/:rackId/scans/final-qty`
- `POST /api/stock-take/schedules/:scheduleId/racks/:rackId/confirm`
- `POST /api/stock-take/schedules/:scheduleId/racks/:rackId/reject`

## Rules penting

- Mobile dan web tidak boleh query database langsung.
- `SCAN_QTY` adalah hasil scan mobile dan tidak diubah saat recheck.
- `FINAL_QTY` adalah qty akhir setelah correction.
- Rack yang sudah printed terkunci untuk tambah/edit/delete scan di mobile.
- Rack yang belum close masih bisa ditambahkan ke schedule melalui web.
- Kode rack harus unik per lokasi.
- Schedule `PARTIAL` wajib punya minimal satu category dan minimal satu rack scope.

## Build, test, dan smoke

```powershell
npm.cmd --prefix backend run build
npm.cmd --prefix backend run test
```

Smoke test SQL:

```powershell
$env:SQL_MODE="sql"
$env:STOCKTAKE_CONNECTION_FILE="../documentation/connection DB.txt"
npm.cmd --prefix backend run smoke:sql
```
