import type sql from "mssql";
import { logger } from "../config/logger.js";

const reportIndexesSql = `
IF OBJECT_ID('dbo.TR_STOCK_TAKE_SCAN', 'U') IS NOT NULL
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.TR_STOCK_TAKE_SCAN')
      AND name = 'IX_TR_STOCK_TAKE_SCAN_REPORT_ADDRESS'
  )
  BEGIN
    CREATE INDEX IX_TR_STOCK_TAKE_SCAN_REPORT_ADDRESS
      ON dbo.TR_STOCK_TAKE_SCAN (SCHEDULE_ID, SCAN_STATUS, DATE_CREATED, RACK_SEQ, ID)
      INCLUDE (PLU, PLU_DESCRIPTION, BARCODE, RACK_CODE, FINAL_QTY);
  END;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.TR_STOCK_TAKE_SCAN')
      AND name = 'IX_TR_STOCK_TAKE_SCAN_REPORT_RACK_PLU'
  )
  BEGIN
    CREATE INDEX IX_TR_STOCK_TAKE_SCAN_REPORT_RACK_PLU
      ON dbo.TR_STOCK_TAKE_SCAN (SCHEDULE_ID, SCAN_STATUS, PLU, RACK_CODE)
      INCLUDE (FINAL_QTY, DATE_CREATED);
  END;
END;

IF OBJECT_ID('dbo.TR_STOCK_SCHEDULE', 'U') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.TR_STOCK_SCHEDULE')
      AND name = 'IX_TR_STOCK_SCHEDULE_REPORT_FILTER'
  )
BEGIN
  CREATE INDEX IX_TR_STOCK_SCHEDULE_REPORT_FILTER
    ON dbo.TR_STOCK_SCHEDULE (SCHEDULE_DATE, END_DATE, LOC_CODE, STATUS)
    INCLUDE (SCHEDULE_NO, SCHEDULE_DESC, CUT_OFF_SOH_DATE, STOCK_TYPE_ID, CATEGORY_ID);
END;
`;

const reportScheduleSnapshotProcedureSql = `
CREATE OR ALTER PROCEDURE dbo.usp_StockTake_ReportScheduleSnapshot
  @ScheduleId bigint
AS
BEGIN
  SET NOCOUNT ON;

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
  WHERE schedule.ID = @ScheduleId;
END;
`;

const reportAddressProcedureSql = `
CREATE OR ALTER PROCEDURE dbo.usp_StockTake_ReportAddress
  @ScheduleId bigint,
  @CategoryId varchar(30) = NULL
AS
BEGIN
  SET NOCOUNT ON;

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
  FROM dbo.TR_STOCK_TAKE_SCAN scan WITH (NOLOCK)
  INNER JOIN dbo.TR_STOCK_SCHEDULE schedule WITH (NOLOCK)
    ON schedule.ID = scan.SCHEDULE_ID
  LEFT JOIN MasterData.dbo.MFLOCATION location WITH (NOLOCK)
    ON RTRIM(location.floccode) COLLATE DATABASE_DEFAULT =
      RTRIM(schedule.LOC_CODE) COLLATE DATABASE_DEFAULT
  LEFT JOIN MasterData.dbo.MFPLU product WITH (NOLOCK)
    ON RTRIM(CONVERT(varchar(30), product.fplu)) COLLATE DATABASE_DEFAULT =
      RTRIM(scan.PLU) COLLATE DATABASE_DEFAULT
  LEFT JOIN MasterData.dbo.MFCATEGORY category WITH (NOLOCK)
    ON RTRIM(CONVERT(varchar(30), category.fcatcd)) COLLATE DATABASE_DEFAULT =
      RTRIM(CONVERT(varchar(30), product.fcatcd)) COLLATE DATABASE_DEFAULT
  WHERE scan.SCHEDULE_ID = @ScheduleId
    AND scan.SCAN_STATUS = 'SYNCED'
    AND (
      @CategoryId IS NULL
      OR RTRIM(CONVERT(varchar(30), category.fcatcd)) COLLATE DATABASE_DEFAULT =
        @CategoryId COLLATE DATABASE_DEFAULT
    )
  ORDER BY scan.DATE_CREATED, scan.RACK_SEQ, scan.ID
  OPTION (RECOMPILE);
END;
`;

const reportDetailProcedureSql = `
CREATE OR ALTER PROCEDURE dbo.usp_StockTake_ReportDetail
  @ScheduleId bigint,
  @CategoryId varchar(30) = NULL
AS
BEGIN
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
  WHERE scan.SCHEDULE_ID = @ScheduleId
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
  WHERE soh.SCHEDULE_ID = @ScheduleId
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
    WHERE scan.SCHEDULE_ID = @ScheduleId
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
  INNER JOIN dbo.TR_STOCK_SCHEDULE schedule WITH (NOLOCK)
    ON schedule.ID = keys.SCHEDULE_ID
  INNER JOIN dbo.MST_STOCK_TYPE stock_type WITH (NOLOCK)
    ON stock_type.ID = schedule.STOCK_TYPE_ID
  LEFT JOIN MasterData.dbo.MFLOCATION location WITH (NOLOCK)
    ON RTRIM(location.floccode) COLLATE DATABASE_DEFAULT =
      RTRIM(schedule.LOC_CODE) COLLATE DATABASE_DEFAULT
  LEFT JOIN #scan_totals scan_totals
    ON scan_totals.SCHEDULE_ID = keys.SCHEDULE_ID
    AND scan_totals.PLU = keys.PLU
  LEFT JOIN #soh_totals soh_totals
    ON soh_totals.SCHEDULE_ID = keys.SCHEDULE_ID
    AND soh_totals.PLU = keys.PLU
  LEFT JOIN MasterData.dbo.MFPLU product WITH (NOLOCK)
    ON RTRIM(CONVERT(varchar(30), product.fplu)) COLLATE DATABASE_DEFAULT =
      keys.PLU COLLATE DATABASE_DEFAULT
  LEFT JOIN #primary_barcode primary_barcode
    ON primary_barcode.PLU = keys.PLU
  LEFT JOIN MasterData.dbo.MFCATEGORY category WITH (NOLOCK)
    ON RTRIM(CONVERT(varchar(30), category.fcatcd)) COLLATE DATABASE_DEFAULT =
      RTRIM(CONVERT(varchar(30), product.fcatcd)) COLLATE DATABASE_DEFAULT
  LEFT JOIN MasterData.dbo.MFDEPARTMENT department WITH (NOLOCK)
    ON RTRIM(CONVERT(varchar(30), department.fdepcd)) COLLATE DATABASE_DEFAULT =
      RTRIM(CONVERT(varchar(30), category.fdepcd)) COLLATE DATABASE_DEFAULT
  LEFT JOIN MasterData.dbo.MFDIVISION division WITH (NOLOCK)
    ON RTRIM(CONVERT(varchar(30), division.fdivcd)) COLLATE DATABASE_DEFAULT =
      RTRIM(CONVERT(varchar(30), department.fdivcd)) COLLATE DATABASE_DEFAULT
  LEFT JOIN #rack_locations rack_locations
    ON rack_locations.PLU = keys.PLU
  WHERE (
      @CategoryId IS NULL
      OR RTRIM(CONVERT(varchar(30), category.fcatcd)) COLLATE DATABASE_DEFAULT =
        @CategoryId COLLATE DATABASE_DEFAULT
    )
  ORDER BY RTRIM(CONVERT(varchar(30), category.fcatcd)) COLLATE DATABASE_DEFAULT, keys.PLU
  OPTION (RECOMPILE);
END;
`;

const reportRowsTempTableSql = `
CREATE TABLE #report_rows (
  schedule_id bigint NOT NULL,
  schedule_no varchar(50) NOT NULL,
  schedule_desc nvarchar(250) NULL,
  loc_code char(4) NOT NULL,
  location_name varchar(255) NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  cut_off_date date NOT NULL,
  stock_type_name varchar(100) NOT NULL,
  status varchar(20) NOT NULL,
  article varchar(30) NOT NULL,
  item_barcode varchar(50) NULL,
  article_description nvarchar(255) NULL,
  soh_description nvarchar(250) NULL,
  division_id varchar(30) NULL,
  division_name varchar(255) NULL,
  department_id varchar(30) NULL,
  department_name varchar(255) NULL,
  category_id varchar(30) NULL,
  category_name varchar(255) NULL,
  soh_qty decimal(18, 3) NOT NULL,
  counted_qty decimal(18, 3) NOT NULL,
  stock_before decimal(18, 3) NOT NULL,
  soh_value decimal(38, 4) NOT NULL,
  uom varchar(12) NOT NULL,
  unit_cost decimal(19, 4) NOT NULL,
  rack_locations nvarchar(max) NULL,
  submission_date datetime2 NULL
);

INSERT INTO #report_rows
EXEC dbo.usp_StockTake_ReportDetail
  @ScheduleId = @ScheduleId,
  @CategoryId = @CategoryId;
`;

const reportVarianceProcedureSql = `
CREATE OR ALTER PROCEDURE dbo.usp_StockTake_ReportVariance
  @ScheduleId bigint,
  @CategoryId varchar(30) = NULL
AS
BEGIN
  SET NOCOUNT ON;

  ${reportRowsTempTableSql}

  ;WITH variance_rows AS (
    SELECT
      schedule_no AS stock_take_request_number,
      ISNULL(NULLIF(RTRIM(schedule_desc), ''), '-') AS stock_take_request_name,
      CONCAT(RTRIM(loc_code), ' - ', COALESCE(NULLIF(RTRIM(location_name), ''), RTRIM(loc_code))) AS store,
      start_date,
      end_date,
      COALESCE(submission_date, CONVERT(datetime2, end_date)) AS stock_take_submission_date,
      ISNULL(NULLIF(RTRIM(stock_type_name), ''), '-') AS stock_take_submission_type,
      ISNULL(NULLIF(RTRIM(status), ''), '-') AS status,
      CASE
        WHEN NULLIF(RTRIM(division_id), '') IS NOT NULL AND NULLIF(RTRIM(division_name), '') IS NOT NULL
        THEN CONCAT(RTRIM(division_id), ' - ', RTRIM(division_name))
        ELSE COALESCE(NULLIF(RTRIM(division_name), ''), NULLIF(RTRIM(division_id), ''), '-')
      END AS division,
      CASE
        WHEN NULLIF(RTRIM(department_id), '') IS NOT NULL AND NULLIF(RTRIM(department_name), '') IS NOT NULL
        THEN CONCAT(RTRIM(department_id), ' - ', RTRIM(department_name))
        ELSE COALESCE(NULLIF(RTRIM(department_name), ''), NULLIF(RTRIM(department_id), ''), '-')
      END AS department,
      CASE
        WHEN NULLIF(RTRIM(category_id), '') IS NOT NULL AND NULLIF(RTRIM(category_name), '') IS NOT NULL
        THEN CONCAT(RTRIM(category_id), ' - ', RTRIM(category_name))
        ELSE COALESCE(NULLIF(RTRIM(category_name), ''), NULLIF(RTRIM(category_id), ''), '-')
      END AS category,
      ISNULL(NULLIF(RTRIM(article), ''), '-') AS article,
      ISNULL(NULLIF(RTRIM(item_barcode), ''), '') AS item_barcode,
      ISNULL(NULLIF(RTRIM(article_description), ''), '-') AS article_description,
      soh_qty,
      counted_qty AS qty_counted,
      counted_qty - soh_qty AS stock_take_variance_qty,
      (counted_qty - soh_qty) * unit_cost AS stock_take_variance_value
    FROM #report_rows
  ),
  category_totals AS (
    SELECT
      category,
      SUM(stock_take_variance_value) AS total_stock_take_variance_value_by_category
    FROM variance_rows
    GROUP BY category
  ),
  grand_total AS (
    SELECT SUM(stock_take_variance_value) AS grand_total
    FROM variance_rows
  )
  SELECT
    rows.stock_take_request_number,
    rows.stock_take_request_name,
    rows.store,
    rows.start_date,
    rows.end_date,
    rows.stock_take_submission_date,
    rows.stock_take_submission_type,
    rows.status,
    rows.division,
    rows.department,
    rows.category,
    rows.article,
    rows.item_barcode,
    rows.article_description,
    rows.soh_qty,
    rows.qty_counted,
    rows.stock_take_variance_qty,
    rows.stock_take_variance_value,
    category_totals.total_stock_take_variance_value_by_category,
    grand_total.grand_total
  FROM variance_rows rows
  INNER JOIN category_totals
    ON category_totals.category = rows.category
  CROSS JOIN grand_total
  ORDER BY rows.category, rows.article;
END;
`;

const reportCategorySummaryProcedureSql = `
CREATE OR ALTER PROCEDURE dbo.usp_StockTake_ReportCategorySummary
  @ScheduleId bigint,
  @CategoryId varchar(30) = NULL
AS
BEGIN
  SET NOCOUNT ON;

  ${reportRowsTempTableSql}

  ;WITH category_rows AS (
    SELECT
      MIN(start_date) AS entry_date,
      ISNULL(NULLIF(RTRIM(category_id), ''), '-') AS category_code,
      ISNULL(NULLIF(RTRIM(category_name), ''), '-') AS category_description,
      SUM(soh_qty) AS soh_qty,
      SUM(counted_qty) AS counted_qty,
      SUM(soh_value) AS soh_value,
      SUM(counted_qty - soh_qty) AS diff_qty,
      SUM((counted_qty - soh_qty) * unit_cost) AS diff_value,
      MAX(unit_cost) AS fallback_cost
    FROM #report_rows
    GROUP BY
      ISNULL(NULLIF(RTRIM(category_id), ''), '-'),
      ISNULL(NULLIF(RTRIM(category_name), ''), '-')
  )
  SELECT
    ROW_NUMBER() OVER (ORDER BY diff_value ASC, category_code ASC) AS [no],
    entry_date,
    category_code,
    category_description,
    CASE WHEN soh_qty = 0 THEN fallback_cost ELSE soh_value / soh_qty END AS cost,
    soh_qty,
    counted_qty,
    soh_value,
    diff_qty,
    diff_value
  FROM category_rows
  ORDER BY diff_value ASC, category_code ASC;
END;
`;

const reportTopBottomProcedureSql = `
CREATE OR ALTER PROCEDURE dbo.usp_StockTake_ReportTopBottom30
  @ScheduleId bigint,
  @CategoryId varchar(30) = NULL
AS
BEGIN
  SET NOCOUNT ON;

  ${reportRowsTempTableSql}

  ;WITH variance_rows AS (
    SELECT
      schedule_no AS stock_take_request_number,
      ISNULL(NULLIF(RTRIM(schedule_desc), ''), '-') AS stock_take_request_name,
      CONCAT(RTRIM(loc_code), ' - ', COALESCE(NULLIF(RTRIM(location_name), ''), RTRIM(loc_code))) AS store,
      CONVERT(datetime2, start_date) AS start_date,
      CONVERT(datetime2, end_date) AS end_date,
      COALESCE(submission_date, CONVERT(datetime2, end_date)) AS stock_take_submission_date,
      ISNULL(NULLIF(RTRIM(stock_type_name), ''), '-') AS stock_take_submission_type,
      ISNULL(NULLIF(RTRIM(status), ''), '-') AS status,
      CASE
        WHEN NULLIF(RTRIM(division_id), '') IS NOT NULL AND NULLIF(RTRIM(division_name), '') IS NOT NULL
        THEN CONCAT(RTRIM(division_id), ' - ', RTRIM(division_name))
        ELSE COALESCE(NULLIF(RTRIM(division_name), ''), NULLIF(RTRIM(division_id), ''), '-')
      END AS division,
      CASE
        WHEN NULLIF(RTRIM(department_id), '') IS NOT NULL AND NULLIF(RTRIM(department_name), '') IS NOT NULL
        THEN CONCAT(RTRIM(department_id), ' - ', RTRIM(department_name))
        ELSE COALESCE(NULLIF(RTRIM(department_name), ''), NULLIF(RTRIM(department_id), ''), '-')
      END AS department,
      CASE
        WHEN NULLIF(RTRIM(category_id), '') IS NOT NULL AND NULLIF(RTRIM(category_name), '') IS NOT NULL
        THEN CONCAT(RTRIM(category_id), ' - ', RTRIM(category_name))
        ELSE COALESCE(NULLIF(RTRIM(category_name), ''), NULLIF(RTRIM(category_id), ''), '-')
      END AS category,
      ISNULL(NULLIF(RTRIM(article), ''), '-') AS article,
      ISNULL(NULLIF(RTRIM(item_barcode), ''), '') AS item_barcode,
      ISNULL(NULLIF(RTRIM(article_description), ''), '-') AS article_description,
      soh_qty,
      counted_qty AS qty_counted,
      counted_qty - soh_qty AS stock_take_variance_qty,
      (counted_qty - soh_qty) * unit_cost AS stock_take_variance_value
    FROM #report_rows
  ),
  category_totals AS (
    SELECT
      category,
      SUM(stock_take_variance_value) AS total_stock_take_variance_value_by_category
    FROM variance_rows
    GROUP BY category
  ),
  grand_total AS (
    SELECT SUM(stock_take_variance_value) AS grand_total
    FROM variance_rows
  ),
  variance_with_totals AS (
    SELECT
      rows.*,
      category_totals.total_stock_take_variance_value_by_category,
      grand_total.grand_total
    FROM variance_rows rows
    INNER JOIN category_totals
      ON category_totals.category = rows.category
    CROSS JOIN grand_total
  ),
  top_plus AS (
    SELECT TOP (30) *
    FROM variance_with_totals
    WHERE stock_take_variance_qty > 0
    ORDER BY stock_take_variance_qty DESC, stock_take_variance_value DESC, article ASC
  ),
  top_minus AS (
    SELECT TOP (30) *
    FROM variance_with_totals
    WHERE stock_take_variance_qty < 0
    ORDER BY stock_take_variance_qty ASC, stock_take_variance_value ASC, article ASC
  )
  SELECT *
  FROM top_plus
  UNION ALL
  SELECT *
  FROM top_minus
  ORDER BY stock_take_variance_qty DESC, stock_take_variance_value DESC, article ASC;
END;
`;

export async function ensureReportingProcedures(pool: sql.ConnectionPool): Promise<void> {
  await pool.request().query(reportIndexesSql);
  const procedures = [
    reportScheduleSnapshotProcedureSql,
    reportAddressProcedureSql,
    reportDetailProcedureSql,
    reportVarianceProcedureSql,
    reportCategorySummaryProcedureSql,
    reportTopBottomProcedureSql,
  ];

  for (const procedureSql of procedures) {
    await pool.request().batch(procedureSql);
  }

  logger.info(
    {
      procedures: [
        "dbo.usp_StockTake_ReportScheduleSnapshot",
        "dbo.usp_StockTake_ReportAddress",
        "dbo.usp_StockTake_ReportDetail",
        "dbo.usp_StockTake_ReportVariance",
        "dbo.usp_StockTake_ReportCategorySummary",
        "dbo.usp_StockTake_ReportTopBottom30",
      ],
    },
    "Reporting stored procedures checked",
  );
}
