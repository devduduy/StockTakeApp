import sql from "mssql";
import { env } from "../../config/env.js";
import { getSqlPool } from "../../db/sql.js";
import { AppError } from "../../shared/app-error.js";
import { isCategoryAllowed, parseCategoryIds } from "../../shared/category-filter.js";
import { mockItems } from "../../shared/mock-data.js";
import type { ItemLookupResponse } from "./item.types.js";

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
