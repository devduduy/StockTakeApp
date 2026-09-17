import sql from "mssql";
import { env } from "../../config/env.js";
import { getSqlPool } from "../../db/sql.js";
import { AppError } from "../../shared/app-error.js";
import { mockItems, mockRacks, mockScanSubmissions, mockSchedules } from "../../shared/mock-data.js";
import type {
  AddressReportRow,
  CategorySummaryReportRow,
  ReportReadiness,
  ReportScheduleInfo,
  ReportSummary,
  StockTakeReportBundle,
  Top30ByCategoryReportRow,
  VarianceReportRow,
} from "./report.types.js";

interface ReportRow {
  schedule_id: string | number;
  schedule_no: string;
  schedule_desc: string;
  loc_code: string;
  location_name: string | null;
  start_date: Date | string;
  end_date: Date | string;
  cut_off_date: Date | string;
  stock_type_name: string;
  status: string;
  article: string;
  item_barcode: string | null;
  article_description: string | null;
  soh_description: string | null;
  division_id: string | null;
  division_name: string | null;
  department_id: string | null;
  department_name: string | null;
  category_id: string | null;
  category_name: string | null;
  soh_qty: number | string;
  counted_qty: number | string;
  stock_before: number | string;
  soh_value: number | string;
  uom: string | null;
  unit_cost: number | string;
  rack_locations: string | null;
  submission_date: Date | string | null;
}

interface AddressRow {
  scan_date: Date | string;
  branch: string;
  sku_code: string;
  sku_name: string;
  address: string;
  scanned_qty: number | string;
}

interface ScheduleReportRow {
  schedule_id: string | number;
  schedule_no: string;
  schedule_desc: string;
  loc_code: string;
  location_name: string | null;
  start_date: Date | string;
  end_date: Date | string;
  cut_off_date: Date | string;
  stock_type_name: string;
  status: string;
  soh_row_count: number | string;
  scan_row_count: number | string;
}

function isoDate(value: Date | string | null | undefined): string {
  if (!value) {
    return "";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value).slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function isoDateTime(value: Date | string | null | undefined): string {
  if (!value) {
    return "";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toISOString();
}

function numeric(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCodeName(code: string | null | undefined, name: string | null | undefined): string {
  const cleanCode = (code ?? "").trim();
  const cleanName = (name ?? "").trim();
  if (cleanCode && cleanName) {
    return `${cleanCode} - ${cleanName}`;
  }
  return cleanName || cleanCode || "-";
}

function mapSchedule(row: ReportRow): ReportScheduleInfo {
  const locCode = row.loc_code.trim();
  return {
    id: String(row.schedule_id),
    scheduleNo: row.schedule_no.trim(),
    scheduleDesc: row.schedule_desc?.trim() || "-",
    locCode,
    locationName: row.location_name?.trim() || `Lokasi ${locCode}`,
    startDate: isoDate(row.start_date),
    endDate: isoDate(row.end_date),
    cutOffDate: isoDate(row.cut_off_date),
    stockTypeName: row.stock_type_name?.trim() || "-",
    status: row.status?.trim() || "-",
  };
}

function mapScheduleSnapshot(row: ScheduleReportRow): ReportScheduleInfo {
  const locCode = row.loc_code.trim();
  return {
    id: String(row.schedule_id),
    scheduleNo: row.schedule_no.trim(),
    scheduleDesc: row.schedule_desc?.trim() || "-",
    locCode,
    locationName: row.location_name?.trim() || `Lokasi ${locCode}`,
    startDate: isoDate(row.start_date),
    endDate: isoDate(row.end_date),
    cutOffDate: isoDate(row.cut_off_date),
    stockTypeName: row.stock_type_name?.trim() || "-",
    status: row.status?.trim() || "-",
  };
}

function buildVarianceRows(rows: ReportRow[]): VarianceReportRow[] {
  const categoryTotals = new Map<string, number>();
  let grandTotal = 0;
  const partialRows = rows.map((row) => {
    const sohQty = numeric(row.soh_qty);
    const countedQty = numeric(row.counted_qty);
    const varianceQty = countedQty - sohQty;
    const unitCost = numeric(row.unit_cost);
    const varianceValue = varianceQty * unitCost;
    const category = formatCodeName(row.category_id, row.category_name);
    categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + varianceValue);
    grandTotal += varianceValue;

    return {
      stockTakeRequestNumber: row.schedule_no.trim(),
      stockTakeRequestName: row.schedule_desc?.trim() || "-",
      store: formatCodeName(row.loc_code, row.location_name),
      startDate: isoDateTime(row.start_date),
      endDate: isoDateTime(row.end_date),
      stockTakeSubmissionDate: isoDateTime(row.submission_date ?? row.end_date),
      stockTakeSubmissionType: row.stock_type_name?.trim() || "-",
      status: row.status?.trim() || "-",
      division: formatCodeName(row.division_id, row.division_name),
      department: formatCodeName(row.department_id, row.department_name),
      category,
      article: row.article?.trim() || "-",
      itemBarcode: row.item_barcode?.trim() || "",
      articleDescription: row.article_description?.trim() || "-",
      sohQty,
      qtyCounted: countedQty,
      stockTakeVarianceQty: varianceQty,
      stockTakeVarianceValue: varianceValue,
      totalStockTakeVarianceValueByCategory: 0,
      grandTotal: 0,
    };
  });

  return partialRows.map((row) => ({
    ...row,
    totalStockTakeVarianceValueByCategory: categoryTotals.get(row.category) ?? 0,
    grandTotal,
  }));
}

function buildCategorySummaryRows(rows: ReportRow[], startDate: string): CategorySummaryReportRow[] {
  const grouped = new Map<string, CategorySummaryReportRow>();
  for (const row of rows) {
    const category = formatCodeName(row.category_id, row.category_name);
    const [categoryCode = "-", categoryDescription = category] = category.split(" - ");
    const sohQty = numeric(row.soh_qty);
    const countedQty = numeric(row.counted_qty);
    const unitCost = numeric(row.unit_cost);
    const sohValue = numeric(row.soh_value) || sohQty * unitCost;
    const diffQty = countedQty - sohQty;
    const diffValue = diffQty * unitCost;
    const key = category;
    const existing = grouped.get(key);
    if (existing) {
      existing.sohQty += sohQty;
      existing.countedQty += countedQty;
      existing.sohValue += sohValue;
      existing.diffQty += diffQty;
      existing.diffValue += diffValue;
      existing.cost = existing.sohQty === 0 ? 0 : existing.sohValue / existing.sohQty;
      continue;
    }
    grouped.set(key, {
      no: 0,
      entryDate: startDate,
      categoryCode,
      categoryDescription,
      cost: sohQty === 0 ? unitCost : sohValue / sohQty,
      sohQty,
      countedQty,
      sohValue,
      diffQty,
      diffValue,
    });
  }

  return Array.from(grouped.values())
    .sort((left, right) => left.diffValue - right.diffValue || left.categoryCode.localeCompare(right.categoryCode))
    .map((row, index) => ({ ...row, no: index + 1 }));
}

function buildSummary(addressRows: AddressReportRow[], varianceRows: VarianceReportRow[]): ReportSummary {
  return {
    totalSku: new Set(varianceRows.map((row) => row.article)).size,
    totalAddress: new Set(addressRows.map((row) => row.address)).size,
    sohQty: varianceRows.reduce((sum, row) => sum + row.sohQty, 0),
    countedQty: varianceRows.reduce((sum, row) => sum + row.qtyCounted, 0),
    varianceQty: varianceRows.reduce((sum, row) => sum + row.stockTakeVarianceQty, 0),
    varianceValue: varianceRows.reduce((sum, row) => sum + row.stockTakeVarianceValue, 0),
  };
}

function buildTopBottomVarianceRows(rows: VarianceReportRow[]): VarianceReportRow[] {
  const topPlusRows = rows
    .filter((row) => row.stockTakeVarianceQty > 0)
    .sort((left, right) =>
      right.stockTakeVarianceQty - left.stockTakeVarianceQty ||
      right.stockTakeVarianceValue - left.stockTakeVarianceValue ||
      left.article.localeCompare(right.article)
    )
    .slice(0, 30);
  const topMinusRows = rows
    .filter((row) => row.stockTakeVarianceQty < 0)
    .sort((left, right) =>
      left.stockTakeVarianceQty - right.stockTakeVarianceQty ||
      left.stockTakeVarianceValue - right.stockTakeVarianceValue ||
      left.article.localeCompare(right.article)
    )
    .slice(0, 30);
  return [...topPlusRows, ...topMinusRows];
}

function buildReadiness(
  schedule: Pick<ScheduleReportRow, "soh_row_count" | "scan_row_count">,
  filteredReportRowCount: number,
  categoryId?: string,
): ReportReadiness {
  const sohRowCount = numeric(schedule.soh_row_count);
  const scanRowCount = numeric(schedule.scan_row_count);
  const warnings: string[] = [];
  if (sohRowCount === 0) {
    warnings.push("SOH belum digenerate untuk schedule ini. Nilai SOH dan variance value belum bisa dianggap final.");
  }
  if (scanRowCount === 0) {
    warnings.push("Belum ada hasil scan untuk schedule ini. Counted Qty akan tampil 0.");
  }
  if (categoryId && filteredReportRowCount === 0) {
    warnings.push("Tidak ada data report pada category yang dipilih.");
  }
  if (!categoryId && filteredReportRowCount === 0) {
    warnings.push("Data report masih kosong untuk schedule ini.");
  }
  return {
    hasSoh: sohRowCount > 0,
    hasScan: scanRowCount > 0,
    sohRowCount,
    scanRowCount,
    warnings,
  };
}

function buildMockBundle(scheduleId: number, categoryId?: string): StockTakeReportBundle {
  const schedule = mockSchedules.find((item) => Number(item.id) === scheduleId);
  if (!schedule) {
    throw new AppError(404, "Schedule tidak ditemukan.", "SCHEDULE_NOT_FOUND");
  }

  const reportSchedule: ReportScheduleInfo = {
    id: schedule.id,
    scheduleNo: schedule.scheduleNo,
    scheduleDesc: schedule.scheduleDesc,
    locCode: schedule.locCode,
    locationName: schedule.locationName,
    startDate: schedule.scheduleDate,
    endDate: schedule.endDate,
    cutOffDate: schedule.cutOffDate,
    stockTypeName: schedule.stockTypeName,
    status: schedule.status,
  };

  const scans = mockScanSubmissions.filter(
    (scan) => Number(scan.scheduleId) === scheduleId && scan.scanStatus === "SYNCED",
  );
  const addressRows: AddressReportRow[] = scans.map((scan) => ({
    date: isoDate(scan.dateCreated),
    branch: formatCodeName(schedule.locCode, schedule.locationName),
    skuCode: scan.plu,
    skuName: scan.pluDescription,
    address: scan.rackCode,
    scannedQty: scan.finalQty ?? scan.scanQty,
  }));

  const byPlu = new Map<string, ReportRow>();
  for (const scan of scans) {
    const item = mockItems.find((candidate) => candidate.plu === scan.plu || candidate.barcode === scan.barcode);
    if (categoryId && item?.category.id !== categoryId) {
      continue;
    }
    const current = byPlu.get(scan.plu);
    const counted = scan.finalQty ?? scan.scanQty;
    if (current) {
      current.counted_qty = numeric(current.counted_qty) + counted;
      current.rack_locations = `${current.rack_locations ?? ""}${current.rack_locations ? "\n" : ""}${scan.rackCode} = ${counted}`;
      continue;
    }
    byPlu.set(scan.plu, {
      schedule_id: schedule.id,
      schedule_no: schedule.scheduleNo,
      schedule_desc: schedule.scheduleDesc,
      loc_code: schedule.locCode,
      location_name: schedule.locationName,
      start_date: schedule.scheduleDate,
      end_date: schedule.endDate,
      cut_off_date: schedule.cutOffDate,
      stock_type_name: schedule.stockTypeName,
      status: schedule.status,
      article: scan.plu,
      item_barcode: scan.barcode,
      article_description: scan.pluDescription,
      soh_description: item?.pluDescription ?? null,
      division_id: item?.category.id.slice(0, 1) ?? null,
      division_name: item?.category.name ?? null,
      department_id: item?.category.id.slice(0, 3) ?? null,
      department_name: item?.category.name ?? null,
      category_id: item?.category.id ?? null,
      category_name: item?.category.name ?? null,
      soh_qty: item?.erpQty ?? 0,
      counted_qty: counted,
      stock_before: item?.erpQty ?? 0,
      soh_value: 0,
      uom: "EA",
      unit_cost: 0,
      rack_locations: `${scan.rackCode} = ${counted}`,
      submission_date: scan.dateCreated,
    });
  }

  const reportRows = Array.from(byPlu.values());
  const varianceRows = buildVarianceRows(reportRows);
  const categorySummaryRows = buildCategorySummaryRows(reportRows, reportSchedule.startDate);
  const top30Rows = reportRows
    .map((row) => {
      const sohQty = numeric(row.soh_qty);
      const countedQty = numeric(row.counted_qty);
      return {
        no: 0,
        category: formatCodeName(row.category_id, row.category_name),
        productNo: row.article,
        productName: row.article_description?.trim() || "-",
        itemBarcode: row.item_barcode?.trim() || "",
        locationQty: row.rack_locations ?? "",
        uom: row.uom?.trim() || "EA",
        stockBefore: numeric(row.stock_before),
        sohQty,
        countedQty,
        diffQty: countedQty - sohQty,
        diffValue: (countedQty - sohQty) * numeric(row.unit_cost),
      };
    })
    .sort((left, right) => Math.abs(right.diffQty) - Math.abs(left.diffQty))
    .slice(0, 30)
    .map((row, index) => ({ ...row, no: index + 1 }));

  return {
    schedule: reportSchedule,
    readiness: {
      hasSoh: true,
      hasScan: addressRows.length > 0,
      sohRowCount: reportRows.length,
      scanRowCount: addressRows.length,
      warnings: addressRows.length > 0 ? [] : ["Belum ada hasil scan untuk schedule ini. Counted Qty akan tampil 0."],
    },
    summary: buildSummary(addressRows, varianceRows),
    addressRows,
    varianceRows,
    categorySummaryRows,
    top30Rows,
  };
}

export async function buildStockTakeReportBundle(
  scheduleId: number,
  categoryId?: string,
  section: "ALL" | "ADDRESS" | "VARIANCE" | "CATEGORY" | "TOP_BOTTOM" = "ALL",
): Promise<StockTakeReportBundle> {
  if (env.SQL_MODE === "mock") {
    return buildMockBundle(scheduleId, categoryId);
  }

  const pool = await getSqlPool();
  const includeAddress = section === "ALL" || section === "ADDRESS";
  const includeReportRows = section === "ALL" || section === "VARIANCE" || section === "CATEGORY" || section === "TOP_BOTTOM";
  const includeVarianceRows = section === "ALL" || section === "VARIANCE" || section === "TOP_BOTTOM";
  const includeCategoryRows = section === "ALL" || section === "CATEGORY";
  const includeTop30Rows = section === "ALL";
  const scheduleResult = await pool
    .request()
    .input("scheduleId", sql.BigInt, scheduleId)
    .query<ScheduleReportRow>(`
      SELECT TOP (1)
        schedule.ID AS schedule_id,
        schedule.SCHEDULE_NO AS schedule_no,
        schedule.SCHEDULE_DESC AS schedule_desc,
        schedule.LOC_CODE AS loc_code,
        RTRIM(CONVERT(varchar(255), location.flocname)) COLLATE DATABASE_DEFAULT AS location_name,
        schedule.SCHEDULE_DATE AS start_date,
        ISNULL(schedule.END_DATE, schedule.SCHEDULE_DATE) AS end_date,
        ISNULL(schedule.CUT_OFF_SOH_DATE, schedule.SCHEDULE_DATE) AS cut_off_date,
        stock_type.STOCK_TYPE_NAME AS stock_type_name,
        schedule.STATUS AS status,
        (
          SELECT COUNT_BIG(1)
          FROM dbo.MST_SOH soh WITH (NOLOCK)
          WHERE soh.SCHEDULE_ID = schedule.ID
        ) AS soh_row_count,
        (
          SELECT COUNT_BIG(1)
          FROM dbo.TR_STOCK_TAKE_SCAN scan WITH (NOLOCK)
          WHERE scan.SCHEDULE_ID = schedule.ID
            AND scan.SCAN_STATUS = 'SYNCED'
        ) AS scan_row_count
      FROM dbo.TR_STOCK_SCHEDULE schedule WITH (NOLOCK)
      INNER JOIN dbo.MST_STOCK_TYPE stock_type WITH (NOLOCK)
        ON stock_type.ID = schedule.STOCK_TYPE_ID
      LEFT JOIN MasterData.dbo.MFLOCATION location WITH (NOLOCK)
        ON RTRIM(location.floccode) COLLATE DATABASE_DEFAULT =
          RTRIM(schedule.LOC_CODE) COLLATE DATABASE_DEFAULT
      WHERE schedule.ID = @scheduleId;
    `);

  const scheduleSnapshot = scheduleResult.recordset[0];
  if (!scheduleSnapshot) {
    throw new AppError(404, "Schedule tidak ditemukan.", "SCHEDULE_NOT_FOUND");
  }

  const addressRows = includeAddress
    ? (await pool
        .request()
        .input("scheduleId", sql.BigInt, scheduleId)
        .input("categoryId", sql.VarChar(30), categoryId ?? null)
        .query<AddressRow>(`
          SELECT
            scan.DATE_CREATED AS scan_date,
            CONCAT(
              RTRIM(schedule.LOC_CODE) COLLATE DATABASE_DEFAULT,
              ' - ',
              COALESCE(
                RTRIM(CONVERT(varchar(255), location.flocname)) COLLATE DATABASE_DEFAULT,
                RTRIM(schedule.LOC_CODE) COLLATE DATABASE_DEFAULT
              )
            ) AS branch,
            RTRIM(scan.PLU) AS sku_code,
            RTRIM(scan.PLU_DESCRIPTION) AS sku_name,
            RTRIM(scan.RACK_CODE) AS address,
            scan.FINAL_QTY AS scanned_qty
          FROM dbo.TR_STOCK_TAKE_SCAN scan
          INNER JOIN dbo.TR_STOCK_SCHEDULE schedule
            ON schedule.ID = scan.SCHEDULE_ID
          LEFT JOIN MasterData.dbo.MFLOCATION location
            ON RTRIM(location.floccode) COLLATE DATABASE_DEFAULT =
              RTRIM(schedule.LOC_CODE) COLLATE DATABASE_DEFAULT
          LEFT JOIN MasterData.dbo.MFPLU product WITH (NOLOCK)
            ON RTRIM(CONVERT(varchar(30), product.fplu)) COLLATE DATABASE_DEFAULT =
              RTRIM(scan.PLU) COLLATE DATABASE_DEFAULT
          LEFT JOIN MasterData.dbo.MFCATEGORY category WITH (NOLOCK)
            ON RTRIM(CONVERT(varchar(30), category.fcatcd)) COLLATE DATABASE_DEFAULT =
              RTRIM(CONVERT(varchar(30), product.fcatcd)) COLLATE DATABASE_DEFAULT
          WHERE scan.SCHEDULE_ID = @scheduleId
            AND scan.SCAN_STATUS = 'SYNCED'
            AND (@categoryId IS NULL OR RTRIM(CONVERT(varchar(30), category.fcatcd)) COLLATE DATABASE_DEFAULT = @categoryId COLLATE DATABASE_DEFAULT)
          ORDER BY scan.DATE_CREATED, scan.RACK_SEQ, scan.ID;
        `)).recordset.map((row) => ({
          date: isoDate(row.scan_date),
          branch: row.branch?.trim() || "-",
          skuCode: row.sku_code?.trim() || "-",
          skuName: row.sku_name?.trim() || "-",
          address: row.address?.trim() || "-",
          scannedQty: numeric(row.scanned_qty),
        }))
    : [];

  const reportRows = includeReportRows
    ? (await pool
        .request()
        .input("scheduleId", sql.BigInt, scheduleId)
        .input("categoryId", sql.VarChar(30), categoryId ?? null)
        .query<ReportRow>(`
      SET NOCOUNT ON;

      CREATE TABLE #scan_totals (
        SCHEDULE_ID bigint NOT NULL,
        PLU varchar(30) COLLATE DATABASE_DEFAULT NOT NULL,
        ITEM_BARCODE varchar(50) COLLATE DATABASE_DEFAULT NULL,
        PLU_DESCRIPTION nvarchar(255) COLLATE DATABASE_DEFAULT NULL,
        COUNTED_QTY decimal(18, 3) NOT NULL,
        SUBMISSION_DATE datetime2 NULL
      );

      INSERT INTO #scan_totals (
        SCHEDULE_ID,
        PLU,
        ITEM_BARCODE,
        PLU_DESCRIPTION,
        COUNTED_QTY,
        SUBMISSION_DATE
      )
      SELECT
        scan.SCHEDULE_ID,
        RTRIM(scan.PLU) AS PLU,
        MIN(NULLIF(RTRIM(scan.BARCODE), '')) AS ITEM_BARCODE,
        MIN(NULLIF(RTRIM(scan.PLU_DESCRIPTION), '')) AS PLU_DESCRIPTION,
        SUM(CONVERT(decimal(18, 3), scan.FINAL_QTY)) AS COUNTED_QTY,
        MAX(scan.DATE_CREATED) AS SUBMISSION_DATE
      FROM dbo.TR_STOCK_TAKE_SCAN scan WITH (NOLOCK)
      WHERE scan.SCHEDULE_ID = @scheduleId
        AND scan.SCAN_STATUS = 'SYNCED'
      GROUP BY scan.SCHEDULE_ID, RTRIM(scan.PLU);

      CREATE UNIQUE CLUSTERED INDEX IX_TEMP_SCAN_TOTALS ON #scan_totals (SCHEDULE_ID, PLU);

      CREATE TABLE #soh_totals (
        SCHEDULE_ID bigint NOT NULL,
        PLU varchar(30) COLLATE DATABASE_DEFAULT NOT NULL,
        SOH_DESCRIPTION nvarchar(250) COLLATE DATABASE_DEFAULT NULL,
        SOH_QTY decimal(18, 3) NOT NULL,
        SOH_VALUE decimal(38, 4) NOT NULL,
        UNIT_COST decimal(19, 4) NOT NULL
      );

      INSERT INTO #soh_totals (
        SCHEDULE_ID,
        PLU,
        SOH_DESCRIPTION,
        SOH_QTY,
        SOH_VALUE,
        UNIT_COST
      )
      SELECT
        soh.SCHEDULE_ID,
        RTRIM(soh.PLU) AS PLU,
        MAX(NULLIF(RTRIM(soh.PLU_DESCRIPTION), '')) AS SOH_DESCRIPTION,
        SUM(ISNULL(soh.ERP_QTY, 0)) AS SOH_QTY,
        SUM(ISNULL(soh.ERP_QTY, 0) * ISNULL(soh.MAV, 0)) AS SOH_VALUE,
        MAX(ISNULL(soh.MAV, 0)) AS UNIT_COST
      FROM dbo.MST_SOH soh WITH (NOLOCK)
      WHERE soh.SCHEDULE_ID = @scheduleId
      GROUP BY soh.SCHEDULE_ID, RTRIM(soh.PLU);

      CREATE UNIQUE CLUSTERED INDEX IX_TEMP_SOH_TOTALS ON #soh_totals (SCHEDULE_ID, PLU);

      CREATE TABLE #article_keys (
        SCHEDULE_ID bigint NOT NULL,
        PLU varchar(30) COLLATE DATABASE_DEFAULT NOT NULL
      );

      INSERT INTO #article_keys (SCHEDULE_ID, PLU)
      SELECT SCHEDULE_ID, PLU FROM #scan_totals
      UNION
      SELECT SCHEDULE_ID, PLU FROM #soh_totals;

      CREATE UNIQUE CLUSTERED INDEX IX_TEMP_ARTICLE_KEYS ON #article_keys (SCHEDULE_ID, PLU);

      CREATE TABLE #rack_locations (
        PLU varchar(30) COLLATE DATABASE_DEFAULT NOT NULL,
        RACK_LOCATIONS nvarchar(max) COLLATE DATABASE_DEFAULT NULL
      );

      INSERT INTO #rack_locations (PLU, RACK_LOCATIONS)
      SELECT
        rack_totals.PLU,
        STRING_AGG(
          CONVERT(
            nvarchar(max),
            CONCAT(rack_totals.RACK_CODE, ' = ', CONVERT(varchar(40), rack_totals.COUNTED_QTY))
          ),
          CHAR(10)
        ) AS RACK_LOCATIONS
      FROM (
        SELECT
          RTRIM(scan.PLU) AS PLU,
          RTRIM(scan.RACK_CODE) AS RACK_CODE,
          SUM(CONVERT(decimal(18, 3), scan.FINAL_QTY)) AS COUNTED_QTY
        FROM dbo.TR_STOCK_TAKE_SCAN scan WITH (NOLOCK)
        WHERE scan.SCHEDULE_ID = @scheduleId
          AND scan.SCAN_STATUS = 'SYNCED'
        GROUP BY RTRIM(scan.PLU), RTRIM(scan.RACK_CODE)
      ) rack_totals
      GROUP BY rack_totals.PLU;

      CREATE UNIQUE CLUSTERED INDEX IX_TEMP_RACK_LOCATIONS ON #rack_locations (PLU);

      CREATE TABLE #primary_barcode (
        PLU varchar(30) COLLATE DATABASE_DEFAULT NOT NULL,
        ITEM_BARCODE varchar(50) COLLATE DATABASE_DEFAULT NOT NULL
      );

      ;WITH barcode_ranked AS (
        SELECT
          RTRIM(CONVERT(varchar(30), barcode.FPLU)) COLLATE DATABASE_DEFAULT AS PLU,
          RTRIM(CONVERT(varchar(50), barcode.FBARCODE)) COLLATE DATABASE_DEFAULT AS ITEM_BARCODE,
          ROW_NUMBER() OVER (
            PARTITION BY RTRIM(CONVERT(varchar(30), barcode.FPLU)) COLLATE DATABASE_DEFAULT
            ORDER BY
              CASE WHEN CONVERT(varchar(5), barcode.FMAIN) COLLATE DATABASE_DEFAULT = 'Y' THEN 0 ELSE 1 END,
              RTRIM(CONVERT(varchar(50), barcode.FBARCODE)) COLLATE DATABASE_DEFAULT
          ) AS barcode_rank
        FROM MasterData.dbo.MFBARCODE barcode WITH (NOLOCK)
        INNER JOIN #article_keys keys
          ON RTRIM(CONVERT(varchar(30), barcode.FPLU)) COLLATE DATABASE_DEFAULT =
            keys.PLU COLLATE DATABASE_DEFAULT
      )
      INSERT INTO #primary_barcode (PLU, ITEM_BARCODE)
      SELECT PLU, ITEM_BARCODE
      FROM barcode_ranked
      WHERE barcode_rank = 1
        AND NULLIF(ITEM_BARCODE, '') IS NOT NULL;

      CREATE UNIQUE CLUSTERED INDEX IX_TEMP_PRIMARY_BARCODE ON #primary_barcode (PLU);

      SELECT
        schedule.ID AS schedule_id,
        schedule.SCHEDULE_NO AS schedule_no,
        schedule.SCHEDULE_DESC AS schedule_desc,
        schedule.LOC_CODE AS loc_code,
        RTRIM(CONVERT(varchar(255), location.flocname)) COLLATE DATABASE_DEFAULT AS location_name,
        schedule.SCHEDULE_DATE AS start_date,
        ISNULL(schedule.END_DATE, schedule.SCHEDULE_DATE) AS end_date,
        ISNULL(schedule.CUT_OFF_SOH_DATE, schedule.SCHEDULE_DATE) AS cut_off_date,
        stock_type.STOCK_TYPE_NAME AS stock_type_name,
        schedule.STATUS AS status,
        keys.PLU AS article,
        COALESCE(
          scan_totals.ITEM_BARCODE COLLATE DATABASE_DEFAULT,
          primary_barcode.ITEM_BARCODE COLLATE DATABASE_DEFAULT,
          keys.PLU COLLATE DATABASE_DEFAULT
        ) AS item_barcode,
        COALESCE(
          scan_totals.PLU_DESCRIPTION COLLATE DATABASE_DEFAULT,
          soh_totals.SOH_DESCRIPTION COLLATE DATABASE_DEFAULT,
          RTRIM(CONVERT(varchar(255), product.fpludesc)) COLLATE DATABASE_DEFAULT,
          keys.PLU COLLATE DATABASE_DEFAULT
        ) AS article_description,
        soh_totals.SOH_DESCRIPTION COLLATE DATABASE_DEFAULT AS soh_description,
        RTRIM(CONVERT(varchar(30), division.fdivcd)) COLLATE DATABASE_DEFAULT AS division_id,
        RTRIM(CONVERT(varchar(255), division.fdivnm)) COLLATE DATABASE_DEFAULT AS division_name,
        RTRIM(CONVERT(varchar(30), department.fdepcd)) COLLATE DATABASE_DEFAULT AS department_id,
        RTRIM(CONVERT(varchar(255), department.fdepnm)) COLLATE DATABASE_DEFAULT AS department_name,
        RTRIM(CONVERT(varchar(30), category.fcatcd)) COLLATE DATABASE_DEFAULT AS category_id,
        RTRIM(CONVERT(varchar(255), category.fcatnm)) COLLATE DATABASE_DEFAULT AS category_name,
        ISNULL(soh_totals.SOH_QTY, 0) AS soh_qty,
        ISNULL(scan_totals.COUNTED_QTY, 0) AS counted_qty,
        ISNULL(soh_totals.SOH_QTY, 0) AS stock_before,
        ISNULL(soh_totals.SOH_VALUE, 0) AS soh_value,
        CAST('EA' AS varchar(12)) AS uom,
        ISNULL(soh_totals.UNIT_COST, 0) AS unit_cost,
        rack_locations.RACK_LOCATIONS AS rack_locations,
        scan_totals.SUBMISSION_DATE AS submission_date
      FROM #article_keys keys
      INNER JOIN dbo.TR_STOCK_SCHEDULE schedule
        ON schedule.ID = keys.SCHEDULE_ID
      INNER JOIN dbo.MST_STOCK_TYPE stock_type
        ON stock_type.ID = schedule.STOCK_TYPE_ID
      LEFT JOIN MasterData.dbo.MFLOCATION location
        ON RTRIM(location.floccode) COLLATE DATABASE_DEFAULT =
          RTRIM(schedule.LOC_CODE) COLLATE DATABASE_DEFAULT
      LEFT JOIN #scan_totals scan_totals
        ON scan_totals.SCHEDULE_ID = keys.SCHEDULE_ID
        AND scan_totals.PLU = keys.PLU
      LEFT JOIN #soh_totals soh_totals
        ON soh_totals.SCHEDULE_ID = keys.SCHEDULE_ID
        AND soh_totals.PLU = keys.PLU
      LEFT JOIN MasterData.dbo.MFPLU product
        ON RTRIM(CONVERT(varchar(30), product.fplu)) COLLATE DATABASE_DEFAULT =
          keys.PLU COLLATE DATABASE_DEFAULT
      LEFT JOIN #primary_barcode primary_barcode
        ON primary_barcode.PLU = keys.PLU
      LEFT JOIN MasterData.dbo.MFCATEGORY category
        ON RTRIM(CONVERT(varchar(30), category.fcatcd)) COLLATE DATABASE_DEFAULT =
          RTRIM(CONVERT(varchar(30), product.fcatcd)) COLLATE DATABASE_DEFAULT
      LEFT JOIN MasterData.dbo.MFDEPARTMENT department
        ON RTRIM(CONVERT(varchar(30), department.fdepcd)) COLLATE DATABASE_DEFAULT =
          RTRIM(CONVERT(varchar(30), category.fdepcd)) COLLATE DATABASE_DEFAULT
      LEFT JOIN MasterData.dbo.MFDIVISION division
        ON RTRIM(CONVERT(varchar(30), division.fdivcd)) COLLATE DATABASE_DEFAULT =
          RTRIM(CONVERT(varchar(30), department.fdivcd)) COLLATE DATABASE_DEFAULT
      LEFT JOIN #rack_locations rack_locations
        ON rack_locations.PLU = keys.PLU
      WHERE (@categoryId IS NULL OR RTRIM(CONVERT(varchar(30), category.fcatcd)) COLLATE DATABASE_DEFAULT = @categoryId COLLATE DATABASE_DEFAULT)
      ORDER BY RTRIM(CONVERT(varchar(30), category.fcatcd)) COLLATE DATABASE_DEFAULT, keys.PLU
      OPTION (RECOMPILE);
    `)).recordset
    : [];

  const schedule = reportRows[0] ? mapSchedule(reportRows[0] as ReportRow) : mapScheduleSnapshot(scheduleSnapshot);
  const allVarianceRows = includeVarianceRows ? buildVarianceRows(reportRows) : [];
  const varianceRows = section === "TOP_BOTTOM" ? buildTopBottomVarianceRows(allVarianceRows) : allVarianceRows;
  const categorySummaryRows = includeCategoryRows ? buildCategorySummaryRows(reportRows, schedule.startDate) : [];
  const top30Rows: Top30ByCategoryReportRow[] = includeTop30Rows ? reportRows
    .map((row) => {
      const sohQty = numeric(row.soh_qty);
      const countedQty = numeric(row.counted_qty);
      const diffQty = countedQty - sohQty;
      return {
        no: 0,
        category: formatCodeName(row.category_id, row.category_name),
        productNo: row.article?.trim() || "-",
        productName: row.article_description?.trim() || "-",
        itemBarcode: row.item_barcode?.trim() || "",
        locationQty: row.rack_locations?.trim() || "",
        uom: row.uom?.trim() || "EA",
        stockBefore: numeric(row.stock_before),
        sohQty,
        countedQty,
        diffQty,
        diffValue: diffQty * numeric(row.unit_cost),
      };
    })
    .sort((left, right) => Math.abs(right.diffQty) - Math.abs(left.diffQty) || left.productNo.localeCompare(right.productNo))
    .slice(0, 30)
    .map((row, index) => ({ ...row, no: index + 1 })) : [];

  return {
    schedule,
    readiness: buildReadiness(scheduleSnapshot, includeReportRows ? reportRows.length : addressRows.length, categoryId),
    summary: buildSummary(addressRows, varianceRows),
    addressRows,
    varianceRows,
    categorySummaryRows,
    top30Rows,
  };
}
