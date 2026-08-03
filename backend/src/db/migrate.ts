import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { getSqlPool } from "./sql.js";

export interface MigrationResult {
  mode: "mock" | "sql";
  addedScheduleCategoryColumn: boolean;
  normalizedStockTypes: boolean;
  ensuredScanTable: boolean;
}

export async function ensureDatabaseSchema(): Promise<MigrationResult> {
  if (env.SQL_MODE === "mock") {
    return {
      mode: "mock",
      addedScheduleCategoryColumn: false,
      normalizedStockTypes: false,
      ensuredScanTable: false,
    };
  }

  const pool = await getSqlPool();
  const result = await pool.request().query<{
    added_schedule_category_column: number;
    normalized_stock_types: number;
    ensured_scan_table: number;
  }>(`
    SET NOCOUNT ON;

    DECLARE @added_schedule_category_column bit = 0;
    DECLARE @normalized_stock_types bit = 0;
    DECLARE @ensured_scan_table bit = 0;

    IF COL_LENGTH('dbo.TR_STOCK_SCHEDULE', 'CATEGORY_ID') IS NULL
    BEGIN
      ALTER TABLE dbo.TR_STOCK_SCHEDULE
        ADD CATEGORY_ID varchar(max) NULL;
      SET @added_schedule_category_column = 1;
    END;

    IF EXISTS (
      SELECT 1
      FROM dbo.MST_STOCK_TYPE
      WHERE (ID = 1 AND (STOCK_TYPE_CODE <> 'STOCK_ALL' OR STOCK_TYPE_NAME <> 'ALL' OR STATUS <> 'ACTIVE'))
         OR (ID = 2 AND (STOCK_TYPE_CODE <> 'STOCK_PARTIAL' OR STOCK_TYPE_NAME <> 'PARTIAL' OR STATUS <> 'ACTIVE'))
         OR (ID NOT IN (1, 2) AND STATUS <> 'INACTIVE')
    )
    BEGIN
      UPDATE dbo.MST_STOCK_TYPE
      SET STOCK_TYPE_CODE = CASE ID
          WHEN 1 THEN 'STOCK_ALL'
          WHEN 2 THEN 'STOCK_PARTIAL'
          ELSE STOCK_TYPE_CODE
        END,
        STOCK_TYPE_NAME = CASE ID
          WHEN 1 THEN N'ALL'
          WHEN 2 THEN N'PARTIAL'
          ELSE STOCK_TYPE_NAME
        END,
        STATUS = CASE WHEN ID IN (1, 2) THEN 'ACTIVE' ELSE 'INACTIVE' END,
        DATE_MODIFIED = SYSUTCDATETIME()
      WHERE ID IN (1, 2) OR STATUS <> 'INACTIVE';

      SET @normalized_stock_types = 1;
    END;

    IF OBJECT_ID('dbo.TR_STOCK_TAKE_SCAN', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.TR_STOCK_TAKE_SCAN (
        ID bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_TR_STOCK_TAKE_SCAN PRIMARY KEY,
        SCHEDULE_ID bigint NOT NULL,
        SCHEDULE_NO varchar(50) NOT NULL,
        RACK_ID bigint NOT NULL,
        RACK_CODE varchar(50) NOT NULL,
        RACK_SEQ int NULL,
        BARCODE varchar(50) NOT NULL,
        PLU varchar(30) NOT NULL,
        PLU_DESCRIPTION nvarchar(255) NULL,
        SCAN_QTY int NOT NULL,
        FINAL_QTY int NOT NULL,
        INPUT_TYPE varchar(20) NOT NULL,
        SCAN_STATUS varchar(20) NOT NULL,
        CLIENT_SCAN_ID varchar(64) NULL,
        PRINT_NO varchar(50) NULL,
        PRINT_TIME datetime2 NULL,
        CONFIRM_TIME datetime2 NULL,
        CONFIRM_USER varchar(100) NULL,
        USER_CREATED varchar(100) NOT NULL,
        DATE_CREATED datetime2 NOT NULL CONSTRAINT DF_TR_STOCK_TAKE_SCAN_DATE_CREATED DEFAULT SYSUTCDATETIME(),
        USER_MODIFIED varchar(100) NULL,
        DATE_MODIFIED datetime2 NULL
      );
      SET @ensured_scan_table = 1;
    END;

    IF COL_LENGTH('dbo.TR_STOCK_TAKE_SCAN', 'CLIENT_SCAN_ID') IS NULL
    BEGIN
      ALTER TABLE dbo.TR_STOCK_TAKE_SCAN
        ADD CLIENT_SCAN_ID varchar(64) NULL;
      SET @ensured_scan_table = 1;
    END;

    IF NOT EXISTS (
      SELECT 1
      FROM sys.indexes
      WHERE object_id = OBJECT_ID('dbo.TR_STOCK_TAKE_SCAN')
        AND name = 'UX_TR_STOCK_TAKE_SCAN_CLIENT_SCAN_ID'
    )
    BEGIN
      CREATE UNIQUE INDEX UX_TR_STOCK_TAKE_SCAN_CLIENT_SCAN_ID
        ON dbo.TR_STOCK_TAKE_SCAN (CLIENT_SCAN_ID)
        WHERE CLIENT_SCAN_ID IS NOT NULL;
      SET @ensured_scan_table = 1;
    END;

    SELECT
      CAST(@added_schedule_category_column AS int) AS added_schedule_category_column,
      CAST(@normalized_stock_types AS int) AS normalized_stock_types,
      CAST(@ensured_scan_table AS int) AS ensured_scan_table;
  `);

  const row = result.recordset[0];
  const migrationResult: MigrationResult = {
    mode: "sql",
    addedScheduleCategoryColumn: row?.added_schedule_category_column === 1,
    normalizedStockTypes: row?.normalized_stock_types === 1,
    ensuredScanTable: row?.ensured_scan_table === 1,
  };
  logger.info({ migration: migrationResult }, "Database schema checked");
  return migrationResult;
}
