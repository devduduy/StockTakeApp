import sql from "mssql";
import { env } from "../../config/env.js";
import { getSqlPool } from "../../db/sql.js";
import { AppError } from "../../shared/app-error.js";
import { mockItems, mockSchedules } from "../../shared/mock-data.js";
import type { SohGenerateResponse, SohScheduleSummary } from "./soh.types.js";

interface SohScheduleRow {
  schedule_id: string | number;
  schedule_no: string;
  schedule_desc: string;
  loc_code: string;
  location_name: string | null;
  cut_off_date: Date | string;
}

interface SohCountRow {
  soh_row_count: number;
  total_erp_qty: number | string | null;
  generated_at: Date | string | null;
  last_generated_by: string | null;
}

const sohTableDefinitionSql = `
  IF OBJECT_ID('dbo.MST_SOH', 'U') IS NULL
  BEGIN
    CREATE TABLE dbo.MST_SOH (
      ID bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_MST_SOH PRIMARY KEY,
      SCHEDULE_ID bigint NOT NULL,
      LOC_CODE char(4) NOT NULL,
      SOH_DATE datetime2 NOT NULL,
      PLU varchar(30) NOT NULL,
      PLU_DESCRIPTION nvarchar(250) NULL,
      ERP_QTY decimal(18,3) NULL,
      MAV decimal(19,4) NULL,
      RSP decimal(19,4) NULL,
      DATE_CREATED datetime2 NOT NULL CONSTRAINT DF_MST_SOH_DATE_CREATED DEFAULT SYSUTCDATETIME(),
      ROW_VERSION rowversion NOT NULL
    );
  END;

  IF OBJECT_ID('dbo.CK_MST_SOH_ERP_QTY', 'C') IS NOT NULL
  BEGIN
    ALTER TABLE dbo.MST_SOH DROP CONSTRAINT CK_MST_SOH_ERP_QTY;
  END;

  IF OBJECT_ID('dbo.MST_SOH', 'U') IS NOT NULL
    AND COL_LENGTH('dbo.MST_SOH', 'PLU') IS NOT NULL
    AND COL_LENGTH('dbo.MST_SOH', 'PLU') < 30
  BEGIN
    ALTER TABLE dbo.MST_SOH ALTER COLUMN PLU varchar(30) NOT NULL;
  END;

  IF OBJECT_ID('dbo.MST_SOH', 'U') IS NOT NULL
    AND COL_LENGTH('dbo.MST_SOH', 'PLU_DESCRIPTION') IS NOT NULL
  BEGIN
    ALTER TABLE dbo.MST_SOH ALTER COLUMN PLU_DESCRIPTION nvarchar(250) NULL;
  END;

  IF OBJECT_ID('dbo.MST_SOH', 'U') IS NOT NULL
    AND COL_LENGTH('dbo.MST_SOH', 'ERP_QTY') IS NOT NULL
  BEGIN
    ALTER TABLE dbo.MST_SOH ALTER COLUMN ERP_QTY decimal(18,3) NULL;
  END;
`;

interface StockCardCountRow {
  source_row_count: number;
  valid_source_row_count: number;
}

interface SummaryOptions {
  stockCardCount?: StockCardCountRow;
}

const emptyStockCardCount: StockCardCountRow = {
  source_row_count: 0,
  valid_source_row_count: 0,
};

function isoDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function isoDateTime(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
}

function numeric(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapSummary(
  schedule: SohScheduleRow,
  sohCount: SohCountRow,
  stockCardCount: StockCardCountRow,
): SohScheduleSummary {
  const locCode = schedule.loc_code.trim();
  return {
    scheduleId: String(schedule.schedule_id),
    scheduleNo: schedule.schedule_no.trim(),
    scheduleDesc: schedule.schedule_desc?.trim() || "-",
    locCode,
    locationName: schedule.location_name?.trim() || locCode,
    cutOffDate: isoDate(schedule.cut_off_date),
    sohRowCount: Number(sohCount.soh_row_count ?? 0),
    totalErpQty: numeric(sohCount.total_erp_qty),
    generatedAt: isoDateTime(sohCount.generated_at),
    lastGeneratedBy: sohCount.last_generated_by?.trim() || null,
    sourceRowCount: Number(stockCardCount.source_row_count ?? 0),
    validSourceRowCount: Number(stockCardCount.valid_source_row_count ?? 0),
  };
}

function mockSummary(
  scheduleId: number,
  stockCardCount: StockCardCountRow = emptyStockCardCount,
): SohScheduleSummary {
  const schedule = mockSchedules.find((item) => Number(item.id) === scheduleId);
  if (!schedule) {
    throw new AppError(404, "Schedule tidak ditemukan.", "SCHEDULE_NOT_FOUND");
  }
  return {
    scheduleId: schedule.id,
    scheduleNo: schedule.scheduleNo,
    scheduleDesc: schedule.scheduleDesc,
    locCode: schedule.locCode,
    locationName: schedule.locationName,
    cutOffDate: schedule.cutOffDate,
    sohRowCount: mockItems.length,
    totalErpQty: mockItems.reduce((sum, item) => sum + Number(item.erpQty ?? 0), 0),
    generatedAt: null,
    lastGeneratedBy: null,
    sourceRowCount: stockCardCount.source_row_count,
    validSourceRowCount: stockCardCount.valid_source_row_count,
  };
}

async function ensureSohGenerateLogTable(): Promise<void> {
  const pool = await getSqlPool();
  await pool.request().query(`
    ${sohTableDefinitionSql}

    IF OBJECT_ID('dbo.TR_SOH_GENERATE_LOG', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.TR_SOH_GENERATE_LOG (
        ID bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_TR_SOH_GENERATE_LOG PRIMARY KEY,
        SCHEDULE_ID bigint NOT NULL,
        SCHEDULE_NO varchar(50) NOT NULL,
        LOC_CODE char(4) NOT NULL,
        CUT_OFF_DATE date NOT NULL,
        SOURCE_ROW_COUNT bigint NOT NULL,
        VALID_SOURCE_ROW_COUNT bigint NOT NULL,
        SKIPPED_SOURCE_ROW_COUNT bigint NOT NULL,
        REPLACED_ROW_COUNT bigint NOT NULL,
        INSERTED_ROW_COUNT bigint NOT NULL,
        STATUS varchar(20) NOT NULL,
        MESSAGE nvarchar(250) NULL,
        USER_CREATED varchar(100) NOT NULL,
        DATE_CREATED datetime2 NOT NULL CONSTRAINT DF_TR_SOH_GENERATE_LOG_DATE_CREATED DEFAULT SYSUTCDATETIME()
      );
    END;

    IF OBJECT_ID('dbo.TR_SOH_GENERATE_LOG', 'U') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM sys.indexes
        WHERE object_id = OBJECT_ID('dbo.TR_SOH_GENERATE_LOG')
          AND name = 'IX_TR_SOH_GENERATE_LOG_SCHEDULE_DATE'
      )
    BEGIN
      CREATE INDEX IX_TR_SOH_GENERATE_LOG_SCHEDULE_DATE
        ON dbo.TR_SOH_GENERATE_LOG (SCHEDULE_ID, DATE_CREATED DESC, ID DESC);
    END;
  `);
}

async function getScheduleContext(scheduleId: number): Promise<SohScheduleRow> {
  const pool = await getSqlPool();
  const result = await pool
    .request()
    .input("scheduleId", sql.BigInt, scheduleId)
    .query<SohScheduleRow>(`
      SELECT TOP (1)
        CAST(schedule.ID AS varchar(30)) AS schedule_id,
        schedule.SCHEDULE_NO AS schedule_no,
        schedule.SCHEDULE_DESC AS schedule_desc,
        schedule.LOC_CODE AS loc_code,
        RTRIM(CONVERT(varchar(255), location.flocname)) COLLATE DATABASE_DEFAULT AS location_name,
        ISNULL(schedule.CUT_OFF_SOH_DATE, schedule.SCHEDULE_DATE) AS cut_off_date
      FROM dbo.TR_STOCK_SCHEDULE schedule WITH (NOLOCK)
      LEFT JOIN MasterData.dbo.MFLOCATION location WITH (NOLOCK)
        ON RTRIM(CONVERT(varchar(30), location.floccode)) COLLATE DATABASE_DEFAULT =
          RTRIM(schedule.LOC_CODE) COLLATE DATABASE_DEFAULT
      WHERE schedule.ID = @scheduleId;
    `);

  const schedule = result.recordset[0];
  if (!schedule) {
    throw new AppError(404, "Schedule tidak ditemukan.", "SCHEDULE_NOT_FOUND");
  }
  return schedule;
}

async function getStockCardCount(locCode: string, cutOffDate: string): Promise<StockCardCountRow> {
  const pool = await getSqlPool();
  const result = await pool
    .request()
    .input("locCode", sql.VarChar(30), locCode)
    .input("cutOffDate", sql.Date, cutOffDate)
    .query<StockCardCountRow>(`
      SELECT
        COUNT_BIG(1) AS source_row_count,
        SUM(
          CASE
            WHEN NULLIF(LTRIM(RTRIM(CONVERT(varchar(30), article_code))), '') IS NOT NULL
             AND LEN(LTRIM(RTRIM(CONVERT(varchar(30), article_code)))) <= 30
            THEN 1 ELSE 0
          END
        ) AS valid_source_row_count
      FROM SalesTxn.dbo.StockCard WITH (NOLOCK)
      WHERE RTRIM(CONVERT(varchar(30), location_code)) COLLATE DATABASE_DEFAULT =
          @locCode COLLATE DATABASE_DEFAULT
        AND card_date = @cutOffDate;
    `);

  return result.recordset[0] ?? { source_row_count: 0, valid_source_row_count: 0 };
}

async function getSohCount(scheduleId: number): Promise<SohCountRow> {
  const pool = await getSqlPool();
  const result = await pool
    .request()
    .input("scheduleId", sql.BigInt, scheduleId)
    .query<SohCountRow>(`
      DECLARE @soh_row_count bigint = 0;
      DECLARE @total_erp_qty decimal(38, 3) = 0;
      DECLARE @mst_generated_at datetime2 = NULL;
      DECLARE @log_generated_at datetime2 = NULL;
      DECLARE @last_generated_by varchar(100) = NULL;

      SELECT
        @soh_row_count = COUNT_BIG(1),
        @total_erp_qty = ISNULL(SUM(ERP_QTY), 0),
        @mst_generated_at = MAX(DATE_CREATED)
      FROM dbo.MST_SOH WITH (NOLOCK)
      WHERE SCHEDULE_ID = @scheduleId;

      IF OBJECT_ID('dbo.TR_SOH_GENERATE_LOG', 'U') IS NOT NULL
      BEGIN
        SELECT TOP (1)
          @log_generated_at = DATE_CREATED,
          @last_generated_by = USER_CREATED
        FROM dbo.TR_SOH_GENERATE_LOG WITH (NOLOCK)
        WHERE SCHEDULE_ID = @scheduleId
          AND STATUS = 'SUCCESS'
        ORDER BY DATE_CREATED DESC, ID DESC;
      END;

      SELECT
        @soh_row_count AS soh_row_count,
        @total_erp_qty AS total_erp_qty,
        COALESCE(@log_generated_at, @mst_generated_at) AS generated_at,
        @last_generated_by AS last_generated_by;
    `);

  return result.recordset[0] ?? {
    soh_row_count: 0,
    total_erp_qty: 0,
    generated_at: null,
    last_generated_by: null,
  };
}

export async function getSohScheduleSummary(
  scheduleId: number,
  options: SummaryOptions = {},
): Promise<SohScheduleSummary> {
  if (env.SQL_MODE === "mock") {
    return mockSummary(scheduleId);
  }

  const schedule = await getScheduleContext(scheduleId);
  const sohCount = await getSohCount(scheduleId);
  const stockCardCount = options.stockCardCount ?? emptyStockCardCount;

  return mapSummary(schedule, sohCount, stockCardCount);
}

export async function generateSohFromStockCard(
  scheduleId: number,
  username: string,
): Promise<SohGenerateResponse> {
  if (env.SQL_MODE === "mock") {
    const stockCardCount = {
      source_row_count: mockItems.length,
      valid_source_row_count: mockItems.length,
    };
    const summary = mockSummary(scheduleId, stockCardCount);
    return {
      ...summary,
      generatedAt: new Date().toISOString(),
      lastGeneratedBy: username,
      replacedRowCount: summary.sohRowCount,
      insertedRowCount: summary.validSourceRowCount,
      skippedSourceRowCount: 0,
    };
  }

  const pool = await getSqlPool();
  const schedule = await getScheduleContext(scheduleId);
  const locCode = schedule.loc_code.trim();
  const cutOffDate = isoDate(schedule.cut_off_date);
  const beforeCount = await getSohCount(scheduleId);
  const sourceCount = await getStockCardCount(locCode, cutOffDate);
  await ensureSohGenerateLogTable();
  const transaction = new sql.Transaction(pool);

  await transaction.begin();
  try {
    const deleteResult = await transaction
      .request()
      .input("scheduleId", sql.BigInt, scheduleId)
      .query(`
        DELETE FROM dbo.MST_SOH
        WHERE SCHEDULE_ID = @scheduleId;
      `);

    const insertResult = await transaction
      .request()
      .input("scheduleId", sql.BigInt, scheduleId)
      .input("locCode", sql.Char(4), locCode)
      .input("cutOffDate", sql.Date, cutOffDate)
      .input("username", sql.VarChar(100), username)
      .query<{ inserted_row_count: number }>(`
        ;WITH stockcard_clean AS (
          SELECT
            LTRIM(RTRIM(CONVERT(varchar(30), article_code))) AS PLU,
            NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(250), article_description))), '') AS PLU_DESCRIPTION,
            TRY_CONVERT(decimal(18, 3), REPLACE(REPLACE(NULLIF(LTRIM(RTRIM(CONVERT(varchar(100), closing_stock))), ''), ',', ''), ' ', '')) AS ERP_QTY,
            TRY_CONVERT(decimal(19, 4), REPLACE(REPLACE(NULLIF(LTRIM(RTRIM(CONVERT(varchar(100), current_mav))), ''), ',', ''), ' ', '')) AS MAV
          FROM SalesTxn.dbo.StockCard WITH (NOLOCK)
          WHERE RTRIM(CONVERT(varchar(30), location_code)) COLLATE DATABASE_DEFAULT =
              @locCode COLLATE DATABASE_DEFAULT
            AND card_date = @cutOffDate
            AND NULLIF(LTRIM(RTRIM(CONVERT(varchar(30), article_code))), '') IS NOT NULL
            AND LEN(LTRIM(RTRIM(CONVERT(varchar(30), article_code)))) <= 30
        ),
        stockcard_grouped AS (
          SELECT
            PLU,
            MAX(PLU_DESCRIPTION) AS PLU_DESCRIPTION,
            SUM(ERP_QTY) AS ERP_QTY,
            MAX(MAV) AS MAV
          FROM stockcard_clean
          GROUP BY PLU
        )
        INSERT INTO dbo.MST_SOH (
          SCHEDULE_ID,
          LOC_CODE,
          SOH_DATE,
          PLU,
          PLU_DESCRIPTION,
          ERP_QTY,
          MAV,
          RSP,
          DATE_CREATED
        )
        SELECT
          @scheduleId,
          @locCode,
          @cutOffDate,
          PLU,
          PLU_DESCRIPTION,
          ERP_QTY,
          MAV,
          NULL,
          SYSUTCDATETIME()
        FROM stockcard_grouped;

        SELECT @@ROWCOUNT AS inserted_row_count;
      `);

    const replacedRowCount = Number(deleteResult.rowsAffected[0] ?? beforeCount.soh_row_count ?? 0);
    const insertedRowCount = Number(insertResult.recordset[0]?.inserted_row_count ?? 0);
    const skippedSourceRowCount =
      Number(sourceCount.source_row_count ?? 0) -
      Number(sourceCount.valid_source_row_count ?? 0);

    await transaction
      .request()
      .input("scheduleId", sql.BigInt, scheduleId)
      .input("scheduleNo", sql.VarChar(50), schedule.schedule_no.trim())
      .input("locCode", sql.Char(4), locCode)
      .input("cutOffDate", sql.Date, cutOffDate)
      .input("sourceRowCount", sql.BigInt, Number(sourceCount.source_row_count ?? 0))
      .input("validSourceRowCount", sql.BigInt, Number(sourceCount.valid_source_row_count ?? 0))
      .input("skippedSourceRowCount", sql.BigInt, skippedSourceRowCount)
      .input("replacedRowCount", sql.BigInt, replacedRowCount)
      .input("insertedRowCount", sql.BigInt, insertedRowCount)
      .input("username", sql.VarChar(100), username)
      .query(`
        INSERT INTO dbo.TR_SOH_GENERATE_LOG (
          SCHEDULE_ID,
          SCHEDULE_NO,
          LOC_CODE,
          CUT_OFF_DATE,
          SOURCE_ROW_COUNT,
          VALID_SOURCE_ROW_COUNT,
          SKIPPED_SOURCE_ROW_COUNT,
          REPLACED_ROW_COUNT,
          INSERTED_ROW_COUNT,
          STATUS,
          MESSAGE,
          USER_CREATED,
          DATE_CREATED
        )
        VALUES (
          @scheduleId,
          @scheduleNo,
          @locCode,
          @cutOffDate,
          @sourceRowCount,
          @validSourceRowCount,
          @skippedSourceRowCount,
          @replacedRowCount,
          @insertedRowCount,
          'SUCCESS',
          NULL,
          @username,
          SYSUTCDATETIME()
        );
      `);

    await transaction.commit();
    const summary = await getSohScheduleSummary(scheduleId, { stockCardCount: sourceCount });
    return {
      ...summary,
      replacedRowCount,
      insertedRowCount,
      skippedSourceRowCount,
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
