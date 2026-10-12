# Schedule - PARTIAL Category Scope

Catatan ini menjelaskan alur saat user membuat schedule dengan stock type `PARTIAL`, memilih category yang boleh dihitung, lalu bagaimana mobile membaca aturan tersebut saat scan barcode.

## Ringkasan alur

```text
Web Create/Edit Schedule
        |
        | pilih stock type PARTIAL
        | pilih category dari MasterData.dbo.MFCATEGORY
        v
Frontend scheduleForm.categoryIds
        |
        | submit payload
        v
Backend Schedule API
        |
        | validasi PARTIAL wajib punya category
        | simpan category ke TR_STOCK_SCHEDULE.CATEGORY_ID
        v
Mobile Scan Barcode
        |
        | lookup barcode + scheduleId
        v
Backend Item Lookup
        |
        | baca item dari MasterData.dbo.MFBARCODE / MFPLU
        | baca scope category dari TR_STOCK_SCHEDULE.CATEGORY_ID
        | validasi category item masuk scope PARTIAL
        v
Item valid / ditolak
```

## Business rule

- Stock type `ALL`
  - Semua category boleh discan.
  - `TR_STOCK_SCHEDULE.CATEGORY_ID` disimpan `NULL`.

- Stock type `PARTIAL`
  - User wajib memilih minimal satu category.
  - Category yang dipilih disimpan di `TR_STOCK_SCHEDULE.CATEGORY_ID`.
  - Item yang category-nya tidak termasuk scope schedule tidak boleh discan.
  - Validasi utama ada di backend, bukan hanya di UI.

## Sumber category

Category berasal dari master perusahaan:

- `MasterData.dbo.MFCATEGORY`
- join ke `MasterData.dbo.MFDEPARTMENT`
- join ke `MasterData.dbo.MFDIVISION`

File backend:

- `backend/src/modules/categories/category.routes.ts`
- `backend/src/modules/categories/category.repository.ts`

Endpoint:

```http
GET /api/stock-take/categories
```

Frontend mengambil data category melalui:

- `frontend/src/app/core/api/stock-take-api.service.ts`

## Frontend - pemilihan category saat create schedule

File utama:

- `frontend/src/app/features/schedules/schedule-list.component.ts`
- `frontend/src/app/features/schedules/schedule-list.component.html`

Field form yang menampung category:

```ts
categoryIds: this.fb.nonNullable.control<string[]>([])
```

Lokasi penting:

| Kebutuhan | File | Penanda kode |
| --- | --- | --- |
| Form schedule | `schedule-list.component.ts` | `scheduleForm` |
| Tampung category terpilih | `schedule-list.component.ts` | `categoryIds` |
| Toggle satu category | `schedule-list.component.ts` | `toggleCategory(categoryId, checked)` |
| Toggle group category | `schedule-list.component.ts` | `toggleCategoryGroup(categories, checked)` |
| Clear category | `schedule-list.component.ts` | `clearCategories()` |
| Validasi sebelum simpan | `schedule-list.component.ts` | `Pilih minimal satu category untuk schedule PARTIAL.` |
| Build payload | `schedule-list.component.ts` | `private schedulePayload()` |
| UI accordion category | `schedule-list.component.html` | block stock type `PARTIAL` |

Payload category dibuat seperti ini:

```ts
categoryIds: raw.stockType === 'ALL' ? [] : raw.categoryIds
```

Artinya:

- jika `ALL`, category tidak dikirim sebagai scope;
- jika `PARTIAL`, category yang dicentang dikirim ke backend.

## Backend - validasi payload schedule

File:

- `backend/src/modules/schedules/schedule.routes.ts`

Schema schedule mewajibkan:

```ts
stockType: z.enum(["ALL", "PARTIAL"]),
categoryIds: z.array(z.string().trim().min(1)).default([])
```

Validasi penting:

```ts
if (value.stockType === "PARTIAL" && value.categoryIds.length === 0) {
  // Schedule PARTIAL wajib memilih category.
}
```

Jadi kalau frontend bermasalah atau request dibuat manual tanpa category, backend tetap menolak.

## Backend - penyimpanan ke database

File:

- `backend/src/modules/schedules/schedule.repository.ts`

Function penting:

```ts
function categoryValue(payload: ScheduleMutatePayload): string | null {
  return payload.stockType === "ALL" ? null : payload.categoryIds.join(",");
}
```

Mapping database:

| Kondisi | Nilai `TR_STOCK_SCHEDULE.CATEGORY_ID` |
| --- | --- |
| `ALL` | `NULL` |
| `PARTIAL` | comma-separated category id, contoh `10203,10105,20104` |

Kolom yang dipakai:

```sql
TR_STOCK_SCHEDULE.CATEGORY_ID
```

Catatan:

- Saat create schedule, nilai ini masuk ke kolom `CATEGORY_ID`.
- Saat update schedule, nilai ini juga di-update di kolom yang sama.
- Saat schedule dibaca ulang, string ini diubah lagi menjadi array category id.

Parser category:

- `backend/src/shared/category-filter.ts`

Function:

```ts
parseCategoryIds(value)
```

Parser ini mendukung format:

- comma-separated string: `10203,10105`
- JSON array string: `["10203","10105"]`

## Backend - rule validasi category

File:

- `backend/src/shared/category-filter.ts`

Function:

```ts
isCategoryAllowed(stockTypeCode, scheduleCategoryIds, itemCategoryId)
```

Rule:

```ts
if (stockTypeCode !== "STOCK_PARTIAL") {
  return true;
}

if (!itemCategoryId) {
  return false;
}

return scheduleCategoryIds.includes(itemCategoryId.trim());
```

Maknanya:

- selain `STOCK_PARTIAL`, item selalu boleh;
- untuk `STOCK_PARTIAL`, item wajib punya category;
- category item harus ada di daftar category schedule.

## Mobile - scan barcode dan lookup item

Mobile tidak melakukan validasi category secara offline. Mobile selalu lookup barcode ke backend dengan membawa `scheduleId`.

File Android:

- `app/src/main/java/com/hero/stocktake/data/remote/StockTakeApi.java`
- `app/src/main/java/com/hero/stocktake/data/repository/NetworkRepository.java`
- `app/src/main/java/com/hero/stocktake/ui/scanner/ScannerFragment.java`

Endpoint Retrofit:

```java
@GET("api/stock-take/items/lookup")
Call<ApiEnvelope<ItemLookupDto>> lookupItem(
    @Header("Authorization") String authorization,
    @Query("barcode") String barcode,
    @Query("scheduleId") String scheduleId
);
```

Alur di scanner:

```text
User scan barcode
        |
        v
ScannerFragment.lookupItem(barcode, scheduleId)
        |
        v
Backend /api/stock-take/items/lookup
        |
        v
Jika valid:
  currentItem diisi
  user boleh simpan item

Jika tidak valid:
  error ditampilkan di input barcode
  user tidak bisa simpan item
```

Guard di mobile sebelum simpan:

```java
if (currentItem == null || currentItemBarcode == null || !currentItemBarcode.equals(barcode)) {
    barcodeLayout.setError("Item belum valid. Tunggu lookup barcode selesai.");
    return;
}
```

## Backend - lookup item dan validasi category

File:

- `backend/src/modules/items/item.repository.ts`

Function utama:

```ts
lookupItemByBarcode(barcode, scheduleId)
```

Sumber item:

- `MasterData.dbo.MFBARCODE`
- `MasterData.dbo.MFPLU`
- optional SOH dari `dbo.MST_SOH`

Setelah item ditemukan, backend menjalankan:

```ts
assertAllowedForSchedule(item, scheduleId)
```

Di function ini backend:

1. baca schedule dari `dbo.TR_STOCK_SCHEDULE`;
2. join ke `dbo.MST_STOCK_TYPE`;
3. ambil `STOCK_TYPE_CODE`;
4. ambil `CATEGORY_ID`;
5. parse category scope;
6. cek category item terhadap scope schedule.

Kalau item di luar scope PARTIAL, backend throw:

```text
ITEM_CATEGORY_NOT_ALLOWED
```

Contoh pesan error:

```text
Item category GROCERY tidak termasuk dalam schedule PARTIAL ini.
```

## Submit scan tetap divalidasi ulang

Validasi lookup di mobile bukan satu-satunya penjagaan. Saat submit scan, backend lookup ulang setiap barcode.

File:

- `backend/src/modules/scans/scan.routes.ts`

Flow submit:

```text
POST /api/stock-take/schedules/:scheduleId/racks/:rackId/scans/submit
        |
        | untuk setiap line scan:
        v
lookupItemByBarcode(line.barcode, scheduleId)
        |
        v
validasi category scope ulang
```

Tujuannya:

- mencegah data invalid masuk walaupun mobile/local draft bermasalah;
- mencegah bypass request manual;
- memastikan rules PARTIAL tetap konsisten.

Manual add item dari web juga memakai function yang sama:

```text
lookupItemByBarcode(barcode, scheduleId)
```

Jadi web dan mobile sama-sama melewati guardrail backend.

## Tabel yang terlibat

| Database | Tabel | Fungsi |
| --- | --- | --- |
| `STOCKTAKE` | `dbo.TR_STOCK_SCHEDULE` | Menyimpan schedule, stock type, dan `CATEGORY_ID` scope |
| `STOCKTAKE` | `dbo.MST_STOCK_TYPE` | Master stock type `ALL` / `PARTIAL` |
| `STOCKTAKE` | `dbo.TR_STOCK_SCHEDULE_RACK` | Scope rack schedule |
| `STOCKTAKE` | `dbo.TR_STOCK_TAKE_SCAN` | Hasil scan item |
| `STOCKTAKE` | `dbo.MST_SOH` | SOH per schedule |
| `MasterData` | `dbo.MFCATEGORY` | Master category |
| `MasterData` | `dbo.MFDEPARTMENT` | Master department |
| `MasterData` | `dbo.MFDIVISION` | Master division |
| `MasterData` | `dbo.MFPLU` | Master PLU/item dan category item |
| `MasterData` | `dbo.MFBARCODE` | Mapping barcode ke PLU |

## Query cek schedule PARTIAL

Gunakan query ini untuk melihat scope category sebuah schedule:

```sql
SELECT
    s.ID,
    s.SCHEDULE_NO,
    s.SCHEDULE_DESC,
    s.LOC_CODE,
    st.STOCK_TYPE_CODE,
    st.STOCK_TYPE_NAME,
    s.CATEGORY_ID
FROM STOCKTAKE.dbo.TR_STOCK_SCHEDULE s
INNER JOIN STOCKTAKE.dbo.MST_STOCK_TYPE st
    ON st.ID = s.STOCK_TYPE_ID
WHERE s.SCHEDULE_NO = 'ST/2026/09/0001';
```

Untuk melihat nama category dari `CATEGORY_ID`:

```sql
DECLARE @scheduleId bigint = 2;

SELECT
    s.ID AS schedule_id,
    s.SCHEDULE_NO,
    category.value AS category_code,
    c.fcatnm AS category_name
FROM STOCKTAKE.dbo.TR_STOCK_SCHEDULE s
CROSS APPLY STRING_SPLIT(
    REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(s.CATEGORY_ID, ''), ' ', ''), '"', ''), '[', ''), ']', ''),
    ','
) category
LEFT JOIN MasterData.dbo.MFCATEGORY c
    ON RTRIM(c.fcatcd) COLLATE DATABASE_DEFAULT =
       RTRIM(category.value) COLLATE DATABASE_DEFAULT
WHERE s.ID = @scheduleId
  AND NULLIF(RTRIM(category.value), '') IS NOT NULL;
```

## Query simulasi validasi barcode terhadap schedule

Gunakan query ini untuk mengecek sebuah barcode masuk scope schedule atau tidak.

```sql
DECLARE @scheduleId bigint = 2;
DECLARE @barcode varchar(50) = 'ISI_BARCODE_DI_SINI';

WITH schedule_scope AS (
    SELECT TOP (1)
        s.ID,
        s.SCHEDULE_NO,
        st.STOCK_TYPE_CODE,
        s.CATEGORY_ID
    FROM STOCKTAKE.dbo.TR_STOCK_SCHEDULE s
    INNER JOIN STOCKTAKE.dbo.MST_STOCK_TYPE st
        ON st.ID = s.STOCK_TYPE_ID
    WHERE s.ID = @scheduleId
),
item AS (
    SELECT TOP (1)
        RTRIM(b.FBARCODE) AS barcode,
        RTRIM(b.FPLU) AS plu,
        RTRIM(p.fpludesc) AS plu_description,
        RTRIM(p.fcatcd) AS category_code,
        RTRIM(p.fcatnm) AS category_name
    FROM MasterData.dbo.MFBARCODE b
    INNER JOIN MasterData.dbo.MFPLU p
        ON RTRIM(p.fplu) COLLATE DATABASE_DEFAULT =
           RTRIM(b.FPLU) COLLATE DATABASE_DEFAULT
    WHERE RTRIM(b.FBARCODE) COLLATE DATABASE_DEFAULT = @barcode COLLATE DATABASE_DEFAULT
    ORDER BY
        CASE WHEN b.FMAIN = 'Y' THEN 0 ELSE 1 END,
        b.FPLU
)
SELECT
    scope.SCHEDULE_NO,
    scope.STOCK_TYPE_CODE,
    item.barcode,
    item.plu,
    item.plu_description,
    item.category_code,
    item.category_name,
    scope.CATEGORY_ID AS allowed_category_ids,
    CASE
        WHEN scope.STOCK_TYPE_CODE <> 'STOCK_PARTIAL' THEN 'ALLOWED'
        WHEN item.category_code IS NULL THEN 'BLOCKED'
        WHEN CHARINDEX(
            ',' + item.category_code + ',',
            ',' + REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(scope.CATEGORY_ID, ''), ' ', ''), '"', ''), '[', ''), ']', '') + ','
        ) > 0 THEN 'ALLOWED'
        ELSE 'BLOCKED'
    END AS validation_result
FROM schedule_scope scope
CROSS JOIN item;
```

## Checklist debugging jika barcode ditolak

1. Pastikan schedule benar.
   - Cek `TR_STOCK_SCHEDULE.ID`.
   - Cek `SCHEDULE_NO`.
   - Cek `STOCK_TYPE_ID`.

2. Pastikan schedule memang `PARTIAL`.
   - Join ke `MST_STOCK_TYPE`.
   - Cek `STOCK_TYPE_CODE = STOCK_PARTIAL`.

3. Cek `TR_STOCK_SCHEDULE.CATEGORY_ID`.
   - Pastikan category yang dipilih tersimpan.
   - Pastikan format tidak kosong.

4. Cek barcode.
   - Barcode harus ada di `MasterData.dbo.MFBARCODE`.
   - Mapping PLU harus ada di `MasterData.dbo.MFPLU`.

5. Cek category item.
   - Category item ada di `MFPLU.fcatcd`.
   - Nilainya harus ada di `TR_STOCK_SCHEDULE.CATEGORY_ID`.

6. Cek response API.
   - Jika error `ITEM_CATEGORY_NOT_ALLOWED`, berarti item ditemukan tetapi category-nya di luar scope.
   - Jika error `ITEM_NOT_FOUND`, berarti barcode/PLU tidak ditemukan dari lookup.

## Catatan desain teknis

Saat ini category scope disimpan di satu kolom `TR_STOCK_SCHEDULE.CATEGORY_ID` dengan format comma-separated.

Kelebihan:

- sederhana;
- tidak perlu tabel tambahan;
- cocok untuk scope kecil-menengah.

Hal yang perlu diperhatikan:

- query filter perlu parse string;
- kalau nanti kebutuhan audit per category makin detail, opsi yang lebih rapi adalah tabel relasi, misalnya `TR_STOCK_SCHEDULE_CATEGORY`.

Untuk kondisi saat ini, flow sudah tetap aman karena validasi utama dilakukan di backend saat lookup dan submit scan.

