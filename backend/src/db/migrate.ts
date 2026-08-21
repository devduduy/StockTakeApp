import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { getSqlPool } from "./sql.js";

export interface MigrationResult {
  mode: "mock" | "sql";
  addedScheduleCategoryColumn: boolean;
  addedScheduleEndDateColumn: boolean;
  addedScheduleCutOffDateColumn: boolean;
  normalizedScheduleNumbers: boolean;
  ensuredScheduleNoUniqueIndex: boolean;
  normalizedStockTypes: boolean;
  ensuredScanTable: boolean;
  removedLegacyRecheckColumns: boolean;
  ensuredScheduleRackTable: boolean;
  droppedUserLocationAccessTable: boolean;
  ensuredScheduleUserTable: boolean;
}

export async function ensureDatabaseSchema(): Promise<MigrationResult> {
  if (env.SQL_MODE === "mock") {
    return {
      mode: "mock",
      addedScheduleCategoryColumn: false,
      addedScheduleEndDateColumn: false,
      addedScheduleCutOffDateColumn: false,
      normalizedScheduleNumbers: false,
      ensuredScheduleNoUniqueIndex: false,
      normalizedStockTypes: false,
      ensuredScanTable: false,
      removedLegacyRecheckColumns: false,
      ensuredScheduleRackTable: false,
      droppedUserLocationAccessTable: false,
      ensuredScheduleUserTable: false,
    };
  }

  const pool = await getSqlPool();
  const result = await pool.request().query<{
    added_schedule_category_column: number;
    added_schedule_end_date_column: number;
    added_schedule_cut_off_date_column: number;
    normalized_schedule_numbers: number;
    ensured_schedule_no_unique_index: number;
    normalized_stock_types: number;
    ensured_scan_table: number;
    removed_legacy_recheck_columns: number;
    ensured_schedule_rack_table: number;
    dropped_user_location_access_table: number;
    ensured_schedule_user_table: number;
  }>(`
    SET NOCOUNT ON;

    DECLARE @added_schedule_category_column bit = 0;
    DECLARE @added_schedule_end_date_column bit = 0;
    DECLARE @added_schedule_cut_off_date_column bit = 0;
    DECLARE @normalized_schedule_numbers bit = 0;
    DECLARE @ensured_schedule_no_unique_index bit = 0;
    DECLARE @normalized_stock_types bit = 0;
    DECLARE @ensured_scan_table bit = 0;
    DECLARE @removed_legacy_recheck_columns bit = 0;
    DECLARE @ensured_schedule_rack_table bit = 0;
    DECLARE @dropped_user_location_access_table bit = 0;
    DECLARE @ensured_schedule_user_table bit = 0;

    IF COL_LENGTH('dbo.TR_STOCK_SCHEDULE', 'CATEGORY_ID') IS NULL
    BEGIN
      ALTER TABLE dbo.TR_STOCK_SCHEDULE
        ADD CATEGORY_ID varchar(max) NULL;
      SET @added_schedule_category_column = 1;
    END;

    IF COL_LENGTH('dbo.TR_STOCK_SCHEDULE', 'END_DATE') IS NULL
    BEGIN
      ALTER TABLE dbo.TR_STOCK_SCHEDULE
        ADD END_DATE date NULL;

      SET @added_schedule_end_date_column = 1;
    END;

    IF COL_LENGTH('dbo.TR_STOCK_SCHEDULE', 'END_DATE') IS NOT NULL
    BEGIN
      EXEC sp_executesql N'
        UPDATE dbo.TR_STOCK_SCHEDULE
        SET END_DATE = SCHEDULE_DATE
        WHERE END_DATE IS NULL;
      ';

      IF EXISTS (
        SELECT 1
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo'
          AND TABLE_NAME = 'TR_STOCK_SCHEDULE'
          AND COLUMN_NAME = 'END_DATE'
          AND IS_NULLABLE = 'YES'
      )
      BEGIN
        ALTER TABLE dbo.TR_STOCK_SCHEDULE
          ALTER COLUMN END_DATE date NOT NULL;
      END;
    END;

    IF COL_LENGTH('dbo.TR_STOCK_SCHEDULE', 'CUT_OFF_SOH_DATE') IS NULL
    BEGIN
      ALTER TABLE dbo.TR_STOCK_SCHEDULE
        ADD CUT_OFF_SOH_DATE date NULL;

      SET @added_schedule_cut_off_date_column = 1;
    END;

    IF COL_LENGTH('dbo.TR_STOCK_SCHEDULE', 'CUT_OFF_SOH_DATE') IS NOT NULL
    BEGIN
      EXEC sp_executesql N'
        UPDATE dbo.TR_STOCK_SCHEDULE
        SET CUT_OFF_SOH_DATE = SCHEDULE_DATE
        WHERE CUT_OFF_SOH_DATE IS NULL;
      ';

      IF EXISTS (
        SELECT 1
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = 'dbo'
          AND TABLE_NAME = 'TR_STOCK_SCHEDULE'
          AND COLUMN_NAME = 'CUT_OFF_SOH_DATE'
          AND IS_NULLABLE = 'YES'
      )
      BEGIN
        ALTER TABLE dbo.TR_STOCK_SCHEDULE
          ALTER COLUMN CUT_OFF_SOH_DATE date NOT NULL;
      END;
    END;

    IF OBJECT_ID('dbo.TR_STOCK_SCHEDULE', 'U') IS NOT NULL
    BEGIN
      ;WITH schedule_base AS (
        SELECT
          ID,
          SCHEDULE_NO,
          SCHEDULE_DATE,
          CASE
            WHEN SCHEDULE_NO LIKE 'ST/[12][0-9][0-9][0-9]/[01][0-9]/[0-9][0-9][0-9][0-9]'
             AND LEN(SCHEDULE_NO) = 15
            THEN 1
            ELSE 0
          END AS is_valid_format,
          COUNT(*) OVER (PARTITION BY SCHEDULE_NO) AS duplicate_count,
          ROW_NUMBER() OVER (PARTITION BY SCHEDULE_NO ORDER BY ID) AS duplicate_rank
        FROM dbo.TR_STOCK_SCHEDULE
      ),
      candidates AS (
        SELECT
          ID,
          FORMAT(CONVERT(date, SCHEDULE_DATE), 'yyyy/MM') AS period,
          ROW_NUMBER() OVER (
            PARTITION BY FORMAT(CONVERT(date, SCHEDULE_DATE), 'yyyy/MM')
            ORDER BY SCHEDULE_DATE, ID
          ) AS candidate_sequence
        FROM schedule_base
        WHERE is_valid_format = 0
           OR (duplicate_count > 1 AND duplicate_rank > 1)
      ),
      period_max AS (
        SELECT
          candidates.period,
          ISNULL(MAX(TRY_CONVERT(int, RIGHT(schedule_existing.SCHEDULE_NO, 4))), 0) AS max_sequence
        FROM candidates
        LEFT JOIN dbo.TR_STOCK_SCHEDULE schedule_existing
          ON schedule_existing.ID NOT IN (SELECT ID FROM candidates)
         AND schedule_existing.SCHEDULE_NO LIKE 'ST/' + candidates.period + '/[0-9][0-9][0-9][0-9]'
         AND LEN(schedule_existing.SCHEDULE_NO) = 15
        GROUP BY candidates.period
      )
      UPDATE schedule_target
      SET
        SCHEDULE_NO = 'ST/' + candidates.period + '/' + RIGHT('0000' + CONVERT(varchar(10), period_max.max_sequence + candidates.candidate_sequence), 4),
        DATE_MODIFIED = SYSUTCDATETIME()
      FROM dbo.TR_STOCK_SCHEDULE schedule_target
      INNER JOIN candidates ON candidates.ID = schedule_target.ID
      INNER JOIN period_max ON period_max.period = candidates.period;

      IF @@ROWCOUNT > 0
      BEGIN
        SET @normalized_schedule_numbers = 1;
      END;

      IF NOT EXISTS (
        SELECT 1
        FROM sys.indexes
        WHERE object_id = OBJECT_ID('dbo.TR_STOCK_SCHEDULE')
          AND name = 'UX_TR_STOCK_SCHEDULE_SCHEDULE_NO'
      )
      BEGIN
        CREATE UNIQUE INDEX UX_TR_STOCK_SCHEDULE_SCHEDULE_NO
          ON dbo.TR_STOCK_SCHEDULE (SCHEDULE_NO);
        SET @ensured_schedule_no_unique_index = 1;
      END;
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
        RECHECK_USER varchar(100) NULL,
        CONFIRM_TIME datetime2 NULL,
        CONFIRM_USER varchar(100) NULL,
        USER_CREATED varchar(100) NOT NULL,
        DATE_CREATED datetime2 NOT NULL CONSTRAINT DF_TR_STOCK_TAKE_SCAN_DATE_CREATED DEFAULT SYSUTCDATETIME(),
        USER_MODIFIED varchar(100) NULL,
        DATE_MODIFIED datetime2 NULL
      );
      SET @ensured_scan_table = 1;
    END;

    IF COL_LENGTH('dbo.TR_STOCK_TAKE_SCAN', 'RECHECK_USER') IS NULL
    BEGIN
      ALTER TABLE dbo.TR_STOCK_TAKE_SCAN
        ADD RECHECK_USER varchar(100) NULL;
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

    IF OBJECT_ID('dbo.TR_STOCK_TAKE_SCAN', 'U') IS NOT NULL
    BEGIN
      DECLARE @legacy_column_name sysname;
      DECLARE @legacy_default_constraint_name sysname;
      DECLARE @legacy_drop_sql nvarchar(max);

      DECLARE legacy_recheck_column_cursor CURSOR LOCAL FAST_FORWARD FOR
        SELECT column_name
        FROM (VALUES
          (CONVERT(sysname, 'CHECKER_QTY')),
          (CONVERT(sysname, 'RECHECK_STATUS')),
          (CONVERT(sysname, 'RECHECK_NOTE')),
          (CONVERT(sysname, 'RECHECK_TIME'))
        ) AS legacy_columns(column_name)
        WHERE COL_LENGTH('dbo.TR_STOCK_TAKE_SCAN', column_name) IS NOT NULL;

      OPEN legacy_recheck_column_cursor;
      FETCH NEXT FROM legacy_recheck_column_cursor INTO @legacy_column_name;

      WHILE @@FETCH_STATUS = 0
      BEGIN
        DECLARE legacy_recheck_default_cursor CURSOR LOCAL FAST_FORWARD FOR
          SELECT default_constraints.name
          FROM sys.default_constraints
          INNER JOIN sys.columns
            ON sys.columns.object_id = default_constraints.parent_object_id
           AND sys.columns.column_id = default_constraints.parent_column_id
          WHERE default_constraints.parent_object_id = OBJECT_ID('dbo.TR_STOCK_TAKE_SCAN')
            AND sys.columns.name = @legacy_column_name;

        OPEN legacy_recheck_default_cursor;
        FETCH NEXT FROM legacy_recheck_default_cursor INTO @legacy_default_constraint_name;

        WHILE @@FETCH_STATUS = 0
        BEGIN
          SET @legacy_drop_sql = N'ALTER TABLE dbo.TR_STOCK_TAKE_SCAN DROP CONSTRAINT ' + QUOTENAME(@legacy_default_constraint_name) + N';';
          EXEC sp_executesql @legacy_drop_sql;
          FETCH NEXT FROM legacy_recheck_default_cursor INTO @legacy_default_constraint_name;
        END;

        CLOSE legacy_recheck_default_cursor;
        DEALLOCATE legacy_recheck_default_cursor;

        SET @legacy_drop_sql = N'ALTER TABLE dbo.TR_STOCK_TAKE_SCAN DROP COLUMN ' + QUOTENAME(@legacy_column_name) + N';';
        EXEC sp_executesql @legacy_drop_sql;
        SET @removed_legacy_recheck_columns = 1;

        FETCH NEXT FROM legacy_recheck_column_cursor INTO @legacy_column_name;
      END;

      CLOSE legacy_recheck_column_cursor;
      DEALLOCATE legacy_recheck_column_cursor;
    END;

    IF OBJECT_ID('dbo.TR_STOCK_SCHEDULE_RACK', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.TR_STOCK_SCHEDULE_RACK (
        ID bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_TR_STOCK_SCHEDULE_RACK PRIMARY KEY,
        SCHEDULE_ID bigint NOT NULL,
        RACK_ID bigint NOT NULL,
        RACK_CODE varchar(30) NOT NULL,
        RACK_NAME nvarchar(100) NOT NULL,
        LOC_CODE char(4) NOT NULL,
        STATUS varchar(10) NOT NULL CONSTRAINT DF_TR_STOCK_SCHEDULE_RACK_STATUS DEFAULT 'ACTIVE',
        USER_CREATED varchar(100) NULL,
        DATE_CREATED datetime2 NOT NULL CONSTRAINT DF_TR_STOCK_SCHEDULE_RACK_DATE_CREATED DEFAULT SYSUTCDATETIME(),
        USER_MODIFIED varchar(100) NULL,
        DATE_MODIFIED datetime2 NULL
      );
      SET @ensured_schedule_rack_table = 1;
    END;

    IF OBJECT_ID('dbo.UX_TR_STOCK_SCHEDULE_RACK_SCHEDULE_RACK', 'UQ') IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM sys.indexes
        WHERE object_id = OBJECT_ID('dbo.TR_STOCK_SCHEDULE_RACK')
          AND name = 'UX_TR_STOCK_SCHEDULE_RACK_SCHEDULE_RACK'
      )
    BEGIN
      CREATE UNIQUE INDEX UX_TR_STOCK_SCHEDULE_RACK_SCHEDULE_RACK
        ON dbo.TR_STOCK_SCHEDULE_RACK (SCHEDULE_ID, RACK_ID);
      SET @ensured_schedule_rack_table = 1;
    END;

    IF OBJECT_ID('dbo.TR_STOCK_SCHEDULE_RACK', 'U') IS NOT NULL
    BEGIN
      INSERT INTO dbo.TR_STOCK_SCHEDULE_RACK (
        SCHEDULE_ID,
        RACK_ID,
        RACK_CODE,
        RACK_NAME,
        LOC_CODE,
        STATUS,
        USER_CREATED
      )
      SELECT
        schedule.ID,
        rack.ID,
        rack.RACK_CODE,
        rack.RACK_NAME,
        rack.LOC_CODE,
        'ACTIVE',
        'MIGRATION'
      FROM dbo.TR_STOCK_SCHEDULE schedule
      INNER JOIN dbo.MST_RACK rack
        ON rack.LOC_CODE = schedule.LOC_CODE
       AND rack.STATUS = 'ACTIVE'
      WHERE NOT EXISTS (
        SELECT 1
        FROM dbo.TR_STOCK_SCHEDULE_RACK scope
        WHERE scope.SCHEDULE_ID = schedule.ID
      );

      IF @@ROWCOUNT > 0
      BEGIN
        SET @ensured_schedule_rack_table = 1;
      END;
    END;

    IF OBJECT_ID('dbo.MST_USER_LOCATION_ACCESS', 'U') IS NOT NULL
    BEGIN
      DROP TABLE dbo.MST_USER_LOCATION_ACCESS;
      SET @dropped_user_location_access_table = 1;
    END;

    IF OBJECT_ID('dbo.TR_STOCK_SCHEDULE_USER', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.TR_STOCK_SCHEDULE_USER (
        ID bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_TR_STOCK_SCHEDULE_USER PRIMARY KEY,
        SCHEDULE_ID bigint NOT NULL,
        USER_ID bigint NOT NULL,
        STATUS varchar(10) NOT NULL CONSTRAINT DF_TR_STOCK_SCHEDULE_USER_STATUS DEFAULT 'ACTIVE',
        USER_CREATED varchar(100) NULL,
        DATE_CREATED datetime2 NOT NULL CONSTRAINT DF_TR_STOCK_SCHEDULE_USER_DATE_CREATED DEFAULT SYSUTCDATETIME(),
        USER_MODIFIED varchar(100) NULL,
        DATE_MODIFIED datetime2 NULL
      );
      SET @ensured_schedule_user_table = 1;
    END;

    IF OBJECT_ID('dbo.TR_STOCK_SCHEDULE_USER', 'U') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM sys.indexes
        WHERE object_id = OBJECT_ID('dbo.TR_STOCK_SCHEDULE_USER')
          AND name = 'UX_TR_STOCK_SCHEDULE_USER_SCHEDULE_USER'
      )
    BEGIN
      CREATE UNIQUE INDEX UX_TR_STOCK_SCHEDULE_USER_SCHEDULE_USER
        ON dbo.TR_STOCK_SCHEDULE_USER (SCHEDULE_ID, USER_ID);
      SET @ensured_schedule_user_table = 1;
    END;

    SELECT
      CAST(@added_schedule_category_column AS int) AS added_schedule_category_column,
      CAST(@added_schedule_end_date_column AS int) AS added_schedule_end_date_column,
      CAST(@added_schedule_cut_off_date_column AS int) AS added_schedule_cut_off_date_column,
      CAST(@normalized_schedule_numbers AS int) AS normalized_schedule_numbers,
      CAST(@ensured_schedule_no_unique_index AS int) AS ensured_schedule_no_unique_index,
      CAST(@normalized_stock_types AS int) AS normalized_stock_types,
      CAST(@ensured_scan_table AS int) AS ensured_scan_table,
      CAST(@removed_legacy_recheck_columns AS int) AS removed_legacy_recheck_columns,
      CAST(@ensured_schedule_rack_table AS int) AS ensured_schedule_rack_table,
      CAST(@dropped_user_location_access_table AS int) AS dropped_user_location_access_table,
      CAST(@ensured_schedule_user_table AS int) AS ensured_schedule_user_table;
  `);

  const row = result.recordset[0];
  const migrationResult: MigrationResult = {
    mode: "sql",
    addedScheduleCategoryColumn: row?.added_schedule_category_column === 1,
    addedScheduleEndDateColumn: row?.added_schedule_end_date_column === 1,
    addedScheduleCutOffDateColumn: row?.added_schedule_cut_off_date_column === 1,
    normalizedScheduleNumbers: row?.normalized_schedule_numbers === 1,
    ensuredScheduleNoUniqueIndex: row?.ensured_schedule_no_unique_index === 1,
    normalizedStockTypes: row?.normalized_stock_types === 1,
    ensuredScanTable: row?.ensured_scan_table === 1,
    removedLegacyRecheckColumns: row?.removed_legacy_recheck_columns === 1,
    ensuredScheduleRackTable: row?.ensured_schedule_rack_table === 1,
    droppedUserLocationAccessTable: row?.dropped_user_location_access_table === 1,
    ensuredScheduleUserTable: row?.ensured_schedule_user_table === 1,
  };
  logger.info({ migration: migrationResult }, "Database schema checked");
  return migrationResult;
}
