# Hero Stock Take Mobile & Web

Prototype Android native untuk alur Stock Take Hero Supermarket berdasarkan PRD v2.1 dan desain Google Stitch di folder `documentation`.

Web operasional Angular 18 standalone tersedia di folder [`frontend`](frontend/).
Tahap awal web sudah mencakup login, dashboard live, schedule aktif, monitoring
rack, serta detail item tersubmit melalui Backend API yang sama dengan mobile.

## Status prototype

Alur yang sudah dapat dijalankan:

1. Login via Backend API dengan JWT.
2. Dashboard schedule aktif dan jumlah recovery draft.
3. Daftar active schedule dari Backend API.
4. Daftar rack dari Backend API berdasarkan schedule yang dipilih.
5. Detail rack dan ringkasan item/quantity.
6. Scanner/manual barcode dengan lookup item dari Backend API.
7. Validasi barcode dan quantity non-negatif.
8. Deteksi barcode duplikat dengan pilihan `ADD` atau `REPLACE`.
9. Penyimpanan recovery draft menggunakan Room.
10. Submit batch prototype dengan perubahan status lokal menjadi `SYNCED`.
11. Halaman konfirmasi submit.

Database prototype memakai destructive migration. Jika struktur Room berubah,
recovery draft dari versi prototype lama akan dibersihkan otomatis agar aplikasi
tidak force close karena schema yang tidak kompatibel. Sebelum produksi, perilaku
ini harus diganti dengan migration eksplisit agar draft pengguna tetap terjaga.

Data login, schedule, rack, dan lookup item barcode/PLU awal sudah melalui Backend API. Lookup scanner juga sudah memvalidasi category untuk schedule `PARTIAL`. Submit scan masih prototype lokal.

## Stack

- Android native Java + XML Views
- Material 3
- Room Database
- Gradle 9.5 / Android Gradle Plugin 9.3
- Compile SDK 36.1, target SDK 36, min SDK 26
- Build memakai JDK 21; source compatibility Java 17 agar sesuai toolchain Android

## Menjalankan

1. Buka folder ini di Android Studio.
2. Pastikan Android SDK 36.1 dan JDK 21 tersedia.
3. Jalankan konfigurasi `app` pada emulator atau perangkat Android.
4. Jalankan backend terlebih dahulu, lalu login dengan user seed seperti `scanner01` / `prototype`.

Build dari PowerShell:

```powershell
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
.\gradlew.bat testDebugUnitTest assembleDebug lintDebug
```

APK debug dihasilkan di:

```text
app/build/outputs/apk/debug/app-debug.apk
```

## Struktur utama

```text
app/src/main/java/com/hero/stocktake
├── data
│   ├── local       # Room database, DAO, entities
│   ├── repository  # Recovery draft dan submit prototype
│   └── DummyData.java
├── domain           # Model dan aturan add/replace/validasi
└── ui               # Login, dashboard, schedule, rack, scanner, submit
```

## Batas Phase 1

- Scanner saat ini berupa input barcode yang meniru hasil perangkat/camera.
- Submit belum memanggil backend.
- Submit menandai draft lokal sebagai `SYNCED`; belum menulis ke `TR_STOCK_TAKE_SCAN`.
- Tidak ada background sync/WorkManager, sesuai keputusan PRD bahwa local DB hanya untuk recovery.

Tahap integrasi berikutnya adalah menambahkan Retrofit API untuk login, active schedule, rack list, item lookup, dan submit batch; setelah itu camera/HHT scanner dapat menggantikan input barcode prototype tanpa mengubah alur draft.

## Backend API

Backend Express.js + TypeScript tersedia di folder [`backend`](backend/).
Scope awalnya adalah login JWT, active schedule, dan rack list dengan dukungan
SQL Server maupun dummy in-memory. Petunjuk konfigurasi dan endpoint ada di
[`backend/README.md`](backend/README.md).

## Web Frontend

Jalankan backend dan web dari root project:

```powershell
npm.cmd --prefix backend run dev
npm.cmd --prefix frontend start
```

Buka `http://127.0.0.1:4200/`. Petunjuk dan roadmap implementasi web ada di
[`frontend/README.md`](frontend/README.md).

Android debug membaca base URL dari `stocktake.apiBaseUrl` di `local.properties`.
Untuk emulator gunakan `http://10.0.2.2:3000/`. Untuk device fisik seperti
Urovo DT50, gunakan IP laptop/server yang menjalankan backend, misalnya
`http://172.16.30.130:3000/`. Backend lokal harus listen ke `0.0.0.0`, bukan
`127.0.0.1`, agar bisa diakses dari device lain di jaringan yang sama.

Urutan coba end-to-end dari PowerShell:

```powershell
npm.cmd --prefix backend run dev
.\gradlew.bat assembleDebug
```

Endpoint scanner memakai:

```text
GET /api/stock-take/items/lookup?barcode=<barcode-atau-plu>&scheduleId=<scheduleId>
```

Sesuai ERD, master barcode/PLU real dibaca dari database lama:
`MasterData.dbo.MFBARCODE` untuk `FBARCODE -> FPLU`, lalu
`MasterData.dbo.MFPLU` untuk `fplu -> fpludesc`. `dbo.MST_SOH` tetap dipakai
sebagai sumber `erpQty` per schedule bila datanya tersedia.

Untuk schedule `STOCK_PARTIAL`, backend mengecek `MFPLU.fcatcd` terhadap
`TR_STOCK_SCHEDULE.CATEGORY_ID`. Jika category item tidak termasuk scope
schedule, scanner menerima error `ITEM_CATEGORY_NOT_ALLOWED` dan item tidak bisa
disimpan sebagai draft.
