# AGENTS.md

Panduan kerja untuk Codex/agent yang mengerjakan repository Hero Stock Take.

## Bahasa dan komunikasi

- Gunakan Bahasa Indonesia untuk komunikasi dengan user.
- Jelaskan perubahan secara ringkas, konkret, dan sertakan file penting di akhir.
- Untuk pekerjaan yang menyentuh database atau data test, sebutkan jelas apakah script hanya dibuat atau benar-benar dijalankan.

## Arsitektur yang harus dijaga

- Mobile Android dan web Angular tidak boleh query database langsung.
- Semua akses data aplikasi harus melalui Backend API di folder `backend/`.
- SQL Server adalah sumber data aplikasi StockTake.
- Database lama `MasterData` hanya sebagai source master perusahaan:
  - `MasterData.dbo.MFBARCODE`
  - `MasterData.dbo.MFPLU`
  - `MasterData.dbo.MFDIVISION`
  - `MasterData.dbo.MFDEPARTMENT`
  - `MasterData.dbo.MFCATEGORY`
  - `MasterData.dbo.MFLOCATION`
- Jangan menghapus, truncate, atau update data `MasterData` kecuali user meminta sangat eksplisit dan targetnya sudah diverifikasi.

## Tabel aplikasi StockTake

Tabel aplikasi yang dikelola project ini:

- `dbo.MST_ROLE`
- `dbo.MST_STOCK_TYPE`
- `dbo.MST_USERS`
- `dbo.MST_RACK`
- `dbo.MST_SOH`
- `dbo.TR_STOCK_SCHEDULE`
- `dbo.TR_STOCK_SCHEDULE_RACK`
- `dbo.TR_STOCK_TAKE_SCAN`

## Rules bisnis penting

- `MST_USERS.LOC_CODE` menentukan akses lokasi user.
- Role `INVENTORY_CONTROL` dapat akses semua lokasi.
- `MST_STOCK_TYPE` hanya `ALL` dan `PARTIAL`.
- Schedule `PARTIAL` wajib punya category scope dari `MasterData.dbo.MFCATEGORY`.
- Rack scope schedule disimpan di `dbo.TR_STOCK_SCHEDULE_RACK`.
- Kode rack wajib mengikuti format `RCK-{2 huruf}-{3 angka}`, contoh `RCK-FR-001`.
- `SCAN_QTY` adalah hasil scan mobile dan tidak boleh diubah saat recheck.
- `FINAL_QTY` adalah qty akhir setelah correction.
- `RACK_SEQ` adalah urutan waktu scan dan tidak boleh berubah karena edit qty/delete/update.
- Rack yang sudah printed tidak boleh tambah/edit/delete scan dari mobile.
- Rack yang belum close masih boleh ditambah scope rack dari web.

## UI/UX direction

- Hindari tampilan generik AI; prioritaskan UI clean, presisi, dan terasa operasional retail.
- Gunakan brand Hero: navy sebagai struktur utama dan red sebagai aksen secukupnya.
- Error validasi harus muncul dekat field/form yang sedang dikerjakan.
- Field mandatory diberi tanda `*`.
- Schedule form harus berurutan: lokasi dulu, baru tipe stock take, lalu rack/category scope.
- Web menggunakan hamburger/sidebar yang bisa hide/unhide.
- Mobile HHT harus ergonomis untuk scan cepat.

## Database reset

- Gunakan `npm.cmd --prefix backend run db:reset:test`.
- Default command adalah dry-run dan tidak menghapus data.
- Delete betulan wajib memakai:

```powershell
$env:CONFIRM_RESET="YES"
$env:RESET_SCOPE="ALL"
$env:RESET_DRY_RUN="NO"
npm.cmd --prefix backend run db:reset:test
```

- Reset script hanya boleh menghapus tabel aplikasi StockTake, bukan `MasterData`.
- Setelah reset, jalankan:

```powershell
npm.cmd --prefix backend run db:migrate
npm.cmd --prefix backend run db:seed
```

- Seed hanya boleh membuat data minimum sistem: role, stock type, dan demo users. Jangan seed `MST_RACK`, `TR_STOCK_SCHEDULE`, atau transaksi karena data itu dibuat dari UI.
- Untuk user multi lokasi gunakan:

```powershell
$env:SEED_LOC_CODES="6168,23"
npm.cmd --prefix backend run db:seed
```

- Kode lokasi numerik pendek harus dinormalisasi ke 4 digit (`23` menjadi `0023`).

## Command validasi

Backend:

```powershell
npm.cmd --prefix backend run build
npm.cmd --prefix backend run test
```

Frontend:

```powershell
npm.cmd --prefix frontend run build
```

Android:

```powershell
.\gradlew.bat testDebugUnitTest assembleDebug lintDebug
```

## Editing guidelines

- Gunakan `apply_patch` untuk edit file.
- Jangan commit atau push kecuali user meminta.
- Jangan menjalankan script destructive tanpa instruksi eksplisit.
- Saat menambah endpoint backend, update kontrak frontend model/API service dan README terkait.
- Saat menambah table/column, update migration dan dokumentasi database.
