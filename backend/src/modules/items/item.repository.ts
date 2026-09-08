import sql from "mssql";
import { env } from "../../config/env.js";
import { getSqlPool } from "../../db/sql.js";
import { AppError } from "../../shared/app-error.js";
import { isCategoryAllowed, parseCategoryIds } from "../../shared/category-filter.js";
import { mockItems } from "../../shared/mock-data.js";
import type { ItemLookupResponse, ItemSearchResult } from "./item.types.js";

interface ItemRow {
  barcode: string;
  plu: string;
  plu_description: string;
  category_id: string | null;
  category_name: string | null;
  erp_qty: number | string;
  source: ItemLookupResponse["source"];
}

function mapItem(row: ItemRow): ItemLookupResponse {
  return {
    barcode: row.barcode,
    plu: row.plu,
    pluDescription: row.plu_description,
    category: {
      id: row.category_id?.trim() ?? "",
      name: row.category_name?.trim() ?? "",
    },
    erpQty: Number(row.erp_qty),
    source: row.source,
  };
}

function mockLookup(barcode: string): ItemLookupResponse | null {
  const found = mockItems.find(
    (item) => item.barcode === barcode || item.plu === barcode,
  );
  return found ? (found as ItemLookupResponse) : null;
}

async function assertAllowedForSchedule(
  item: ItemLookupResponse,
  scheduleId?: number,
): Promise<void> {
  if (!scheduleId || env.SQL_MODE === "mock") {
    return;
  }

  const pool = await getSqlPool();
  const result = await pool
    .request()
    .input("scheduleId", sql.BigInt, scheduleId)
    .query<{
      stock_type_code: string;
      category_id: string | null;
    }>(`
      SELECT TOP (1)
        st.STOCK_TYPE_CODE AS stock_type_code,
        s.CATEGORY_ID AS category_id
      FROM dbo.TR_STOCK_SCHEDULE s
      INNER JOIN dbo.MST_STOCK_TYPE st ON st.ID = s.STOCK_TYPE_ID
      WHERE s.ID = @scheduleId;
    `);
  const schedule = result.recordset[0];
  if (!schedule) {
    return;
  }

  const scheduleCategoryIds = parseCategoryIds(schedule.category_id);
  if (
    !isCategoryAllowed(
      schedule.stock_type_code,
      scheduleCategoryIds,
      item.category.id,
    )
  ) {
    throw new AppError(
      422,
      `Item category ${item.category.name || item.category.id} tidak termasuk dalam schedule PARTIAL ini.`,
      "ITEM_CATEGORY_NOT_ALLOWED",
      {
        itemCategoryId: item.category.id,
        itemCategoryName: item.category.name,
        allowedCategoryIds: scheduleCategoryIds,
      },
    );
  }
}

export async function lookupItemByBarcode(
  barcode: string,
  scheduleId?: number,
): Promise<ItemLookupResponse | null> {
  const normalizedBarcode = barcode.trim();
  const normalizedPlu =
    /^\d{1,7}$/.test(normalizedBarcode)
      ? normalizedBarcode.padStart(7, "0")
      : normalizedBarcode;

  if (env.SQL_MODE === "mock") {
    return mockLookup(normalizedBarcode);
  }

  const pool = await getSqlPool();

  const barcodeLookup = await pool
    .request()
    .input("barcode", sql.VarChar(50), normalizedBarcode)
    .input("scheduleId", sql.BigInt, scheduleId ?? null)
    .query<ItemRow>(`
      SELECT TOP (1)
        RTRIM(b.FBARCODE) AS barcode,
        RTRIM(b.FPLU) AS plu,
        RTRIM(p.fpludesc) AS plu_description,
        RTRIM(p.fcatcd) AS category_id,
        RTRIM(p.fcatnm) AS category_name,
        ISNULL(soh.ERP_QTY, 0) AS erp_qty,
        CAST('MFBARCODE' AS varchar(20)) AS source
      FROM MasterData.dbo.MFBARCODE b
      INNER JOIN MasterData.dbo.MFPLU p
        ON RTRIM(p.fplu) COLLATE DATABASE_DEFAULT =
          RTRIM(b.FPLU) COLLATE DATABASE_DEFAULT
      OUTER APPLY (
        SELECT TOP (1) s.ERP_QTY
        FROM dbo.MST_SOH s
        WHERE s.PLU COLLATE DATABASE_DEFAULT =
          RTRIM(b.FPLU) COLLATE DATABASE_DEFAULT
          AND (@scheduleId IS NULL OR s.SCHEDULE_ID = @scheduleId)
        ORDER BY s.SOH_DATE DESC, s.ID DESC
      ) soh
      WHERE b.FBARCODE COLLATE DATABASE_DEFAULT = @barcode
      ORDER BY
        CASE WHEN b.FMAIN = 'Y' THEN 0 ELSE 1 END,
        b.FPLU;
    `);
  if (barcodeLookup.recordset[0]) {
    const item = mapItem(barcodeLookup.recordset[0]);
    await assertAllowedForSchedule(item, scheduleId);
    return item;
  }

  const pluLookup = await pool
    .request()
    .input("barcode", sql.VarChar(50), normalizedBarcode)
    .input("plu", sql.VarChar(10), normalizedPlu)
    .input("scheduleId", sql.BigInt, scheduleId ?? null)
    .query<ItemRow>(`
      SELECT TOP (1)
        @barcode AS barcode,
        RTRIM(p.fplu) AS plu,
        RTRIM(p.fpludesc) AS plu_description,
        RTRIM(p.fcatcd) AS category_id,
        RTRIM(p.fcatnm) AS category_name,
        ISNULL(soh.ERP_QTY, 0) AS erp_qty,
        CAST(
          CASE WHEN soh.ERP_QTY IS NULL THEN 'MFPLU' ELSE 'MST_SOH' END
          AS varchar(20)
        ) AS source
      FROM MasterData.dbo.MFPLU p
      OUTER APPLY (
        SELECT TOP (1) s.ERP_QTY
        FROM dbo.MST_SOH s
        WHERE s.PLU COLLATE DATABASE_DEFAULT =
          RTRIM(p.fplu) COLLATE DATABASE_DEFAULT
          AND (@scheduleId IS NULL OR s.SCHEDULE_ID = @scheduleId)
        ORDER BY s.SOH_DATE DESC, s.ID DESC
      ) soh
      WHERE RTRIM(p.fplu) COLLATE DATABASE_DEFAULT = @plu
      ORDER BY p.fplu;
    `);
  if (pluLookup.recordset[0]) {
    const item = mapItem(pluLookup.recordset[0]);
    await assertAllowedForSchedule(item, scheduleId);
    return item;
  }

  const mockItem =
    env.NODE_ENV === "production" ? null : mockLookup(normalizedBarcode);
  if (mockItem) {
    await assertAllowedForSchedule(mockItem, scheduleId);
  }
  return mockItem;
}

export async function searchItems(
  keyword: string,
  scheduleId?: number,
): Promise<ItemSearchResult[]> {
  const normalizedKeyword = keyword.trim();
  if (!normalizedKeyword) return [];

  if (env.SQL_MODE === "mock") {
    const lower = normalizedKeyword.toLowerCase();
    const found = mockItems
      .filter(
        (item) =>
          item.barcode.toLowerCase().includes(lower) ||
          item.plu.toLowerCase().includes(lower) ||
          item.pluDescription.toLowerCase().includes(lower),
      )
      .slice(0, 25);

    return found.map((item) => ({
      barcode: item.barcode,
      plu: item.plu,
      pluDescription: item.pluDescription,
    }));
  }

  const pool = await getSqlPool();
  const searchParam = `%${normalizedKeyword.toUpperCase()}%`;
  const isBarcodeKeyword = /^\d+$/.test(normalizedKeyword);
  const result = await pool
    .request()
    .input("keyword", sql.NVarChar(120), searchParam)
    .input("scheduleId", sql.BigInt, scheduleId ?? null)
    .input("isBarcodeKeyword", sql.Bit, isBarcodeKeyword)
    .query<{
      barcode: string;
      plu: string;
      plu_description: string;
    }>(`
      WITH candidates AS (
        SELECT TOP (25)
          RTRIM(CONVERT(varchar(30), p.fplu)) AS plu,
          RTRIM(CONVERT(nvarchar(255), p.fpludesc)) AS plu_description,
          CAST(0 AS int) AS match_rank
        FROM MasterData.dbo.MFPLU p WITH (NOLOCK)
        OUTER APPLY (
          SELECT TOP (1)
            stock_type.STOCK_TYPE_CODE,
            schedule_scope.CATEGORY_ID
          FROM dbo.TR_STOCK_SCHEDULE schedule_scope WITH (NOLOCK)
          INNER JOIN dbo.MST_STOCK_TYPE stock_type WITH (NOLOCK)
            ON stock_type.ID = schedule_scope.STOCK_TYPE_ID
          WHERE schedule_scope.ID = @scheduleId
        ) schedule_context
        WHERE (
            UPPER(RTRIM(CONVERT(varchar(30), p.fplu))) COLLATE DATABASE_DEFAULT LIKE @keyword COLLATE DATABASE_DEFAULT OR
            UPPER(CONVERT(nvarchar(255), p.fpludesc)) COLLATE DATABASE_DEFAULT LIKE @keyword COLLATE DATABASE_DEFAULT
          )
          AND (
            @scheduleId IS NULL
            OR (
              schedule_context.STOCK_TYPE_CODE IS NOT NULL
              AND (
                schedule_context.STOCK_TYPE_CODE = 'STOCK_ALL'
                OR schedule_context.CATEGORY_ID IS NULL
                OR (
                  ',' + REPLACE(REPLACE(REPLACE(REPLACE(schedule_context.CATEGORY_ID, ' ', ''), '"', ''), '[', ''), ']', '') + ','
                ) COLLATE DATABASE_DEFAULT LIKE (
                  '%,' + (RTRIM(CONVERT(varchar(30), p.fcatcd)) COLLATE DATABASE_DEFAULT) + ',%'
                )
              )
            )
          )

        UNION ALL

        SELECT TOP (25)
          RTRIM(CONVERT(varchar(30), p.fplu)) AS plu,
          RTRIM(CONVERT(nvarchar(255), p.fpludesc)) AS plu_description,
          CAST(1 AS int) AS match_rank
        FROM MasterData.dbo.MFBARCODE b WITH (NOLOCK)
        INNER JOIN MasterData.dbo.MFPLU p WITH (NOLOCK)
          ON RTRIM(CONVERT(varchar(30), p.fplu)) COLLATE DATABASE_DEFAULT =
            RTRIM(CONVERT(varchar(30), b.FPLU)) COLLATE DATABASE_DEFAULT
        OUTER APPLY (
          SELECT TOP (1)
            stock_type.STOCK_TYPE_CODE,
            schedule_scope.CATEGORY_ID
          FROM dbo.TR_STOCK_SCHEDULE schedule_scope WITH (NOLOCK)
          INNER JOIN dbo.MST_STOCK_TYPE stock_type WITH (NOLOCK)
            ON stock_type.ID = schedule_scope.STOCK_TYPE_ID
          WHERE schedule_scope.ID = @scheduleId
        ) schedule_context
        WHERE @isBarcodeKeyword = 1
          AND UPPER(RTRIM(CONVERT(varchar(50), b.FBARCODE))) COLLATE DATABASE_DEFAULT LIKE @keyword COLLATE DATABASE_DEFAULT
          AND (
            @scheduleId IS NULL
            OR (
              schedule_context.STOCK_TYPE_CODE IS NOT NULL
              AND (
                schedule_context.STOCK_TYPE_CODE = 'STOCK_ALL'
                OR schedule_context.CATEGORY_ID IS NULL
                OR (
                  ',' + REPLACE(REPLACE(REPLACE(REPLACE(schedule_context.CATEGORY_ID, ' ', ''), '"', ''), '[', ''), ']', '') + ','
                ) COLLATE DATABASE_DEFAULT LIKE (
                  '%,' + (RTRIM(CONVERT(varchar(30), p.fcatcd)) COLLATE DATABASE_DEFAULT) + ',%'
                )
              )
            )
          )
      ),
      ranked_candidates AS (
        SELECT
          plu,
          MIN(plu_description) AS plu_description,
          MIN(match_rank) AS match_rank
        FROM candidates
        GROUP BY plu
      )
      SELECT TOP (25)
        COALESCE(
          RTRIM(CONVERT(varchar(50), primary_barcode.FBARCODE)),
          ranked_candidates.plu
        ) AS barcode,
        ranked_candidates.plu,
        ranked_candidates.plu_description
      FROM ranked_candidates
      OUTER APPLY (
        SELECT TOP (1) b.FBARCODE
        FROM MasterData.dbo.MFBARCODE b WITH (NOLOCK)
        WHERE RTRIM(CONVERT(varchar(30), b.FPLU)) COLLATE DATABASE_DEFAULT =
          ranked_candidates.plu COLLATE DATABASE_DEFAULT
        ORDER BY
          CASE WHEN b.FMAIN = 'Y' THEN 0 ELSE 1 END,
          b.FBARCODE
      ) primary_barcode
      ORDER BY
        ranked_candidates.match_rank,
        ranked_candidates.plu_description,
        ranked_candidates.plu
      OPTION (RECOMPILE);
    `);

  return result.recordset.map((row) => ({
    barcode: row.barcode || row.plu,
    plu: row.plu,
    pluDescription: row.plu_description,
  }));
}
