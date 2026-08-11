# Hero Stock Take Web

Frontend operasional Hero Stock Take memakai Angular 18 standalone. Web menggunakan Backend API yang sama dengan Android HHT, sehingga schedule, master rack, hasil scan, print lock, final qty, dan status rack berasal dari satu sumber data.

## Fitur saat ini

- Login JWT dan session guard.
- App shell responsive dengan hamburger/sidebar.
- Dashboard live dari active schedule dan rack progress.
- Schedule list dengan search, filter ALL/PARTIAL, progress bar, periode start/end date.
- Create/edit schedule dengan flow berurutan:
  - lokasi dipilih dulu,
  - tipe stock take baru aktif,
  - rack scope/category mengikuti lokasi.
- Category selector accordion berdasarkan `Division -> Department -> Category`.
- Label category terpilih.
- Master Rack page:
  - list rack per lokasi,
  - search,
  - filter ACTIVE/INACTIVE,
  - create manual,
  - generate bulk kode `RCK-{2 huruf}-{3 angka}`.
- Monitoring Rack:
  - status Belum Scan, Submit, Printed, Confirm, Reject,
  - tambah rack ke schedule yang belum close,
  - create rack baru langsung assign ke schedule,
  - detail item tersubmit,
  - print rack,
  - final qty correction,
  - confirm/reject rack dengan dialog konfirmasi.
- Print output ringkas untuk kertas recheck dengan kolom `Qty Checker` dan `Printed By`.

## Menjalankan lokal

Jalankan backend terlebih dahulu:

```powershell
npm.cmd --prefix backend run dev
```

Jalankan frontend:

```powershell
npm.cmd --prefix frontend install
npm.cmd --prefix frontend start
```

Buka:

```text
http://127.0.0.1:4200/
```

Development server meneruskan request `/api` ke `http://127.0.0.1:3000` melalui `proxy.conf.json`.

## Build dan test

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
│   └── models    # kontrak Backend API
├── features
│   ├── login
│   ├── dashboard
│   ├── schedules
│   ├── racks
│   └── master-racks
└── layout        # app shell, sidebar, header
```

## UX rules penting

- Semua request API harus lewat `StockTakeApiService`.
- Error create rack harus muncul di form rack yang sedang dipakai, bukan di alert halaman global.
- Field mandatory ditandai `*`.
- Untuk schedule form, stock type tidak boleh dipilih sebelum lokasi valid.
- Kode rack harus mengikuti format `RCK-XX-000`, contoh `RCK-FR-001`.
- UI harus clean, human-made, dan tidak memakai ornament generik AI.
- Data angka inventory sebaiknya memakai font mono jika membantu alignment.

## Role behavior

- `INVENTORY_CONTROL`: akses semua lokasi dan bisa membuat schedule/rack lintas lokasi.
- Store role: akses lokasi sesuai `MST_USERS.LOC_CODE`.
- `SCANNER`: tidak mengelola master/schedule di web; fokus di mobile HHT.

## Flow recheck web

1. Mobile submit rack.
2. Web print rack pertama kali dan menerbitkan `PRINT_NO`.
3. Rechecker manual menghitung dari kertas kerja.
4. Admin/Inventory Control mengubah `FINAL_QTY` hanya untuk item selisih.
5. Rack di-confirm jika final qty sudah benar.
6. Rack di-reject jika perlu scan ulang dari awal.
7. Schedule dapat ditutup setelah semua rack selesai confirm.

## Catatan integrasi

Frontend tidak menyimpan business rule sendiri selain UX guard. Validasi authoritative tetap berada di Backend API, terutama untuk:

- lokasi user,
- role access,
- duplicate kode rack,
- pattern kode rack,
- schedule status close/cancel,
- rack scope,
- category PARTIAL,
- print lock,
- confirm/reject.
