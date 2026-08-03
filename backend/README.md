# Hero Stock Take API

Backend awal untuk aplikasi Mobile & Web Stock Take Hero Supermarket. Struktur
operasional mengikuti pola project Data Workspace Portal: konfigurasi `.env`,
mode SQL/mock, command seed terpisah, endpoint REST, build TypeScript, dan secret
tidak disimpan di source code.

## Scope saat ini

- Login JWT dari `dbo.MST_USERS` + `dbo.MST_ROLE`.
- Active schedule dari `dbo.TR_STOCK_SCHEDULE` sesuai `MST_USERS.LOC_CODE`.
- Rack aktif berdasarkan `LOC_CODE` schedule dari `dbo.MST_RACK`.
- Lookup item scanner dari `MasterData.dbo.MFBARCODE` dan `MasterData.dbo.MFPLU`.
- Validasi scanner untuk schedule `STOCK_PARTIAL` berdasarkan `TR_STOCK_SCHEDULE.CATEGORY_ID`.
- Master category dari `MasterData.dbo.MFDIVISION -> MFDEPARTMENT -> MFCATEGORY`.
- Seed dummy idempotent untuk lookup, user, rack, dan schedule.
- Mode `mock` untuk development tanpa SQL Server.
- CORS untuk Angular dev server `http://localhost:4200`.

## First Run

```powershell
npm.cmd --prefix backend install
Copy-Item backend\.env.example backend\.env
npm.cmd --prefix backend run db:migrate
npm.cmd --prefix backend run db:seed
npm.cmd --prefix backend run dev
```

Buka health check:

```text
http://127.0.0.1:3000/api/health
```

## Konfigurasi SQL Server

File `.env.example` mendukung dua cara:

1. `STOCKTAKE_CONNECTION_FILE` menunjuk ke file koneksi lokal.
2. Isi `SQL_SERVER`, `SQL_PORT`, `SQL_DATABASE`, `SQL_USER`, dan
   `SQL_PASSWORD` secara langsung.

`SQL_SERVER` dapat berupa hostname biasa atau JDBC URL
`jdbc:sqlserver://...`. Secret tetap berada di `.env` atau file koneksi yang
di-ignore dari source control.

Untuk memakai dummy data in-memory tanpa database:

```env
SQL_MODE=mock
```

## Seed

## Migration

```powershell
npm.cmd --prefix backend run db:migrate
```

Migration saat ini memastikan `TR_STOCK_SCHEDULE.CATEGORY_ID varchar(max) NULL`
tersedia dan `MST_STOCK_TYPE` memakai `STOCK_ALL` / `STOCK_PARTIAL`.

`CATEGORY_ID` boleh disimpan sebagai comma-separated `fcatcd`, misalnya
`40601,40602`, atau JSON array seperti `["40601","40602"]`. Untuk `STOCK_ALL`,
`CATEGORY_ID` harus `NULL`.

## Seed

```powershell
npm.cmd --prefix backend run db:seed
```

Seed menggunakan transaction `SERIALIZABLE` dan hanya mengisi suatu tabel bila
tabel tersebut benar-benar kosong. Menjalankan command berulang tidak
menambahkan duplikat.

Credential dummy:

| Username | Password | Role |
|---|---|---|
| `scanner01` | `prototype` | Scanner |
| `store_manager01` | `prototype` | Store Manager |
| `inventory_control01` | `prototype` | Inventory Control |

Ganti seluruh password dummy dan `JWT_SECRET` sebelum production.

## Endpoint

- `GET /api/health`
- `POST /api/auth/login`
- `GET /api/stock-take/schedules/active?locCode=6168`
- `GET /api/stock-take/schedules/:scheduleId/racks`
- `GET /api/stock-take/items/lookup?barcode=100234&scheduleId=1`
- `GET /api/stock-take/categories`

Semua endpoint stock-take membutuhkan:

```http
Authorization: Bearer <accessToken>
```

Contoh login:

```json
{
  "username": "scanner01",
  "password": "prototype"
}
```

Lookup item menerima barcode atau PLU. Urutan pencarian adalah
`MasterData.dbo.MFBARCODE.FBARCODE`, lalu direct PLU ke
`MasterData.dbo.MFPLU.fplu`. Field `erpQty` diambil dari `dbo.MST_SOH` untuk
schedule terkait bila tersedia. Karena collation database berbeda, query
MasterData memakai `COLLATE DATABASE_DEFAULT` pada perbandingan string
cross-database. Jika schedule bertipe `STOCK_PARTIAL`, category item
`MFPLU.fcatcd` wajib ada di `TR_STOCK_SCHEDULE.CATEGORY_ID`; selain itu backend
mengembalikan `ITEM_CATEGORY_NOT_ALLOWED`. Fallback mock hanya aktif di mode
non-production.

## Build dan Test

```powershell
npm.cmd --prefix backend run test
npm.cmd --prefix backend run build
```

Smoke test end-to-end terhadap SQL Server (login, active schedule, dan rack
list):

```powershell
$env:SQL_MODE="sql"
$env:STOCKTAKE_CONNECTION_FILE="../documentation/connection DB.txt"
npm.cmd --prefix backend run smoke:sql
```

## Catatan untuk Angular 18

Angular standalone nantinya cukup menyediakan interceptor untuk menambahkan
Bearer token dan menggunakan base URL `http://127.0.0.1:3000/api`. Response
sukses menggunakan envelope `{ "data": ... }`, sedangkan error menggunakan
`{ "error": { "code", "message", "details", "requestId" } }`.
