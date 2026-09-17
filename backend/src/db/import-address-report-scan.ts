import fs from "node:fs";
import path from "node:path";
import sql from "mssql";
import { getSqlPool } from "./sql.js";
import { generateSohFromStockCard } from "../modules/soh/soh.repository.js";

interface CsvScanRow {
  sourceLine: number;
  scanDate: string;
  branch: string;
  plu: string;
  pluDescription: string;
  sourceRackCode: string;
  rackCode: string;
  scanQty: number;
}

interface ImportSummary {
  scheduleId: number;
  scheduleNo: string;
  locCode: string;
  csvRows: number;
  uniquePlu: number;
  uniqueRack: number;
  sohRowsBefore: number;
  sohRowsAfter: number;
  existingScanRows: number;
  insertedScanRows: number;
  skippedExistingRows: number;
  createdRackRows: number;
  createdScheduleRackRows: number;
  dryRun: boolean;
}

const scheduleId = Number(process.env.IMPORT_SCHEDULE_ID ?? 2);
const csvPath = path.resolve(
  process.cwd(),
  process.env.IMPORT_ADDRESS_CSV ??
    "C:/Users/YUDHA PERMANA/Downloads/stock_take_address_report_16_09_2026_04_36_447429.csv",
);
const dryRun = process.env.CONFIRM_IMPORT !== "YES";
const defaultRackCode = process.env.IMPORT_DEFAULT_RACK_CODE ?? "RCK-NA-000";
const importUser = process.env.IMPORT_USER ?? "CSV_SIMULATION";
const importDeviceId = process.env.IMPORT_DEVICE_ID ?? "REPORT_CSV_IMPORT";

function parseDelimitedLine(line: string, delimiter = ";"): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];

    if (character === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      quoted = !quoted;
      continue;
    }

    if (character === delimiter && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function normalizePlu(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("SKU Code kosong di CSV.");
  }
  return trimmed.length < 7 ? trimmed.padStart(7, "0") : trimmed;
}

function numeric(value: string): number {
  const parsed = Number(value.replace(/,/g, "").trim());
  if (!Number.isFinite(parsed)) {
    throw new Error(`Scanned Qty tidak valid: ${value}`);
  }
  return parsed;
}

function parseDate(value: string, lineNumber: number): Date {
  const [day, month, year] = value.split("/").map((part) => Number(part));
  if (!day || !month || !year) {
    throw new Error(`Format Date tidak valid di line ${lineNumber}: ${value}`);
  }
  return new Date(Date.UTC(year, month - 1, day, 1, 0, 0));
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function loadCsvRows(filePath: string): CsvScanRow[] {
  const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length <= 1) {
    throw new Error("CSV address report kosong.");
  }

  const headers = parseDelimitedLine(lines[0] ?? "");
  const columnIndex = new Map(headers.map((header, index) => [header, index]));
  for (const required of ["Date", "Branch", "SKU Code", "SKU Name", "Address", "Scanned Qty"]) {
    if (!columnIndex.has(required)) {
      throw new Error(`Kolom wajib '${required}' tidak ditemukan di CSV.`);
    }
  }

  return lines.slice(1).map((line, index) => {
    const cells = parseDelimitedLine(line);
    const get = (header: string): string => cells[columnIndex.get(header) ?? -1]?.trim() ?? "";
    const sourceRackCode = get("Address");
    return {
      sourceLine: index + 2,
      scanDate: get("Date"),
      branch: get("Branch"),
      plu: normalizePlu(get("SKU Code")),
      pluDescription: get("SKU Name") || normalizePlu(get("SKU Code")),
      sourceRackCode,
      rackCode: sourceRackCode || defaultRackCode,
      scanQty: numeric(get("Scanned Qty")),
    };
  });
}

async function main(): Promise<void> {
  const rows = loadCsvRows(csvPath);
  const pool = await getSqlPool();

  const scheduleResult = await pool
    .request()
    .input("scheduleId", sql.BigInt, scheduleId)
    .query<{
      ID: string;
      SCHEDULE_NO: string;
      LOC_CODE: string;
      soh_rows: string | number;
      scan_rows: string | number;
    }>(`
      SELECT TOP (1)
        schedule.ID,
        schedule.SCHEDULE_NO,
        schedule.LOC_CODE,
        (SELECT COUNT_BIG(1) FROM dbo.MST_SOH soh WITH (NOLOCK) WHERE soh.SCHEDULE_ID = schedule.ID) AS soh_rows,
        (SELECT COUNT_BIG(1) FROM dbo.TR_STOCK_TAKE_SCAN scan WITH (NOLOCK) WHERE scan.SCHEDULE_ID = schedule.ID) AS scan_rows
      FROM dbo.TR_STOCK_SCHEDULE schedule WITH (NOLOCK)
      WHERE schedule.ID = @scheduleId;
    `);

  const schedule = scheduleResult.recordset[0];
  if (!schedule) {
    throw new Error(`Schedule ID ${scheduleId} tidak ditemukan.`);
  }

  const rackCodes = [...new Set(rows.map((row) => row.rackCode))].sort();
  const pluCodes = [...new Set(rows.map((row) => row.plu))].sort();
  const sohRowsBefore = Number(schedule.soh_rows ?? 0);
  const existingScanRows = Number(schedule.scan_rows ?? 0);

  if (dryRun) {
    const summary: ImportSummary = {
      scheduleId,
      scheduleNo: schedule.SCHEDULE_NO,
      locCode: schedule.LOC_CODE,
      csvRows: rows.length,
      uniquePlu: pluCodes.length,
      uniqueRack: rackCodes.length,
      sohRowsBefore,
      sohRowsAfter: sohRowsBefore,
      existingScanRows,
      insertedScanRows: 0,
      skippedExistingRows: 0,
      createdRackRows: 0,
      createdScheduleRackRows: 0,
      dryRun,
    };
    console.log(JSON.stringify(summary, null, 2));
    await pool.close();
    return;
  }

  const sohResult =
    sohRowsBefore > 0 && process.env.IMPORT_REGENERATE_SOH !== "YES"
      ? { sohRowCount: sohRowsBefore }
      : await generateSohFromStockCard(scheduleId, importUser);
  const payload = rows.map((row, index) => {
    const scanDate = addSeconds(parseDate(row.scanDate, row.sourceLine), index);
    return {
      sourceLine: row.sourceLine,
      clientScanId: `CSV-SIM-ST${scheduleId}-${String(row.sourceLine).padStart(6, "0")}`,
      rackSeq: index + 1,
      scanDate,
      rackCode: row.rackCode,
      plu: row.plu,
      pluDescription: row.pluDescription,
      scanQty: row.scanQty,
    };
  });

  let createdRackRows = 0;
  let createdScheduleRackRows = 0;
  let insertedScanRows = 0;
  let skippedExistingRows = 0;

  try {
    const rackResult = await pool
      .request()
      .input("scheduleId", sql.BigInt, scheduleId)
      .input("locCode", sql.Char(4), schedule.LOC_CODE)
      .input("importUser", sql.VarChar(100), importUser)
      .input("defaultRackCode", sql.VarChar(30), defaultRackCode)
      .input("payload", sql.NVarChar(sql.MAX), JSON.stringify(rackCodes.map((rackCode) => ({ rackCode }))))
      .query<{
        created_rack_rows: number;
        created_schedule_rack_rows: number;
      }>(`
        DECLARE @rack_source TABLE (
          RACK_CODE varchar(30) NOT NULL PRIMARY KEY
        );

        INSERT INTO @rack_source (RACK_CODE)
        SELECT source.RACK_CODE
        FROM OPENJSON(@payload)
        WITH (
          RACK_CODE varchar(30) '$.rackCode'
        ) source;

        INSERT INTO dbo.MST_RACK (
          RACK_CODE,
          RACK_NAME,
          LOC_CODE,
          STATUS,
          USER_CREATED,
          DATE_CREATED
        )
        SELECT
          source.RACK_CODE,
          CASE WHEN source.RACK_CODE = @defaultRackCode
            THEN 'Imported No Address'
            ELSE CONCAT('Imported ', source.RACK_CODE)
          END,
          @locCode,
          'ACTIVE',
          @importUser,
          SYSUTCDATETIME()
        FROM @rack_source source
        WHERE NOT EXISTS (
          SELECT 1
          FROM dbo.MST_RACK rack
          WHERE rack.LOC_CODE = @locCode
            AND rack.RACK_CODE = source.RACK_CODE
        );

        DECLARE @created_rack_rows int = @@ROWCOUNT;

        INSERT INTO dbo.TR_STOCK_SCHEDULE_RACK (
          SCHEDULE_ID,
          RACK_ID,
          RACK_CODE,
          RACK_NAME,
          LOC_CODE,
          STATUS,
          USER_CREATED,
          DATE_CREATED
        )
        SELECT
          @scheduleId,
          rack.ID,
          rack.RACK_CODE,
          rack.RACK_NAME,
          rack.LOC_CODE,
          'ACTIVE',
          @importUser,
          SYSUTCDATETIME()
        FROM dbo.MST_RACK rack
        INNER JOIN @rack_source source
          ON source.RACK_CODE = rack.RACK_CODE
        WHERE rack.LOC_CODE = @locCode
          AND NOT EXISTS (
            SELECT 1
            FROM dbo.TR_STOCK_SCHEDULE_RACK scope
            WHERE scope.SCHEDULE_ID = @scheduleId
              AND scope.RACK_ID = rack.ID
          );

        DECLARE @created_schedule_rack_rows int = @@ROWCOUNT;

        SELECT
          @created_rack_rows AS created_rack_rows,
          @created_schedule_rack_rows AS created_schedule_rack_rows;
      `);

    createdRackRows = Number(rackResult.recordset[0]?.created_rack_rows ?? 0);
    createdScheduleRackRows = Number(rackResult.recordset[0]?.created_schedule_rack_rows ?? 0);

    const chunkSize = Number(process.env.IMPORT_CHUNK_SIZE ?? 500);
    for (let index = 0; index < payload.length; index += chunkSize) {
      const chunk = payload.slice(index, index + chunkSize);
      const chunkResult = await pool
        .request()
        .input("scheduleId", sql.BigInt, scheduleId)
        .input("scheduleNo", sql.VarChar(50), schedule.SCHEDULE_NO)
        .input("locCode", sql.Char(4), schedule.LOC_CODE)
        .input("deviceId", sql.VarChar(100), importDeviceId)
        .input("importUser", sql.VarChar(100), importUser)
        .input("payload", sql.NVarChar(sql.MAX), JSON.stringify(chunk))
        .query<{
          inserted_scan_rows: number;
          skipped_existing_rows: number;
        }>(`
          DECLARE @source TABLE (
            SOURCE_LINE int NOT NULL,
            CLIENT_SCAN_ID varchar(100) NOT NULL,
            RACK_SEQ int NOT NULL,
            SCAN_DATE datetime2 NOT NULL,
            RACK_CODE varchar(30) NOT NULL,
            PLU varchar(10) NOT NULL,
            PLU_DESCRIPTION nvarchar(250) NULL,
            SCAN_QTY decimal(18, 3) NOT NULL,
            PRIMARY KEY (SOURCE_LINE)
          );

          INSERT INTO @source (
            SOURCE_LINE,
            CLIENT_SCAN_ID,
            RACK_SEQ,
            SCAN_DATE,
            RACK_CODE,
            PLU,
            PLU_DESCRIPTION,
            SCAN_QTY
          )
          SELECT
            source.SOURCE_LINE,
            source.CLIENT_SCAN_ID,
            source.RACK_SEQ,
            source.SCAN_DATE,
            source.RACK_CODE,
            source.PLU,
            source.PLU_DESCRIPTION,
            source.SCAN_QTY
          FROM OPENJSON(@payload)
          WITH (
            SOURCE_LINE int '$.sourceLine',
            CLIENT_SCAN_ID varchar(100) '$.clientScanId',
            RACK_SEQ int '$.rackSeq',
            SCAN_DATE datetime2 '$.scanDate',
            RACK_CODE varchar(30) '$.rackCode',
            PLU varchar(10) '$.plu',
            PLU_DESCRIPTION nvarchar(250) '$.pluDescription',
            SCAN_QTY decimal(18, 3) '$.scanQty'
          ) source;

          DECLARE @skipped_existing_rows int = (
            SELECT COUNT_BIG(1)
            FROM @source source
            WHERE EXISTS (
              SELECT 1
              FROM dbo.TR_STOCK_TAKE_SCAN existing
              WHERE existing.CLIENT_SCAN_ID = source.CLIENT_SCAN_ID
            )
          );

          ;WITH source_rows AS (
            SELECT
              source.SOURCE_LINE,
              source.CLIENT_SCAN_ID,
              source.RACK_SEQ,
              source.SCAN_DATE,
              rack.ID AS RACK_ID,
              rack.RACK_CODE,
              source.PLU,
              source.PLU_DESCRIPTION,
              source.SCAN_QTY,
              source.PLU AS BARCODE
            FROM @source source
            INNER JOIN dbo.MST_RACK rack
              ON rack.LOC_CODE = @locCode
             AND rack.RACK_CODE = source.RACK_CODE
          )
          INSERT INTO dbo.TR_STOCK_TAKE_SCAN (
            CLIENT_SCAN_ID,
            SCHEDULE_ID,
            SCHEDULE_NO,
            RACK_ID,
            RACK_CODE,
            RACK_SEQ,
            BARCODE,
            PLU,
            PLU_DESCRIPTION,
            SCAN_QTY,
            FINAL_QTY,
            INPUT_TYPE,
            SCAN_STATUS,
            USER_CREATED,
            DATE_CREATED,
            DEVICE_ID
          )
          SELECT
            source.CLIENT_SCAN_ID,
            @scheduleId,
            @scheduleNo,
            source.RACK_ID,
            source.RACK_CODE,
            source.RACK_SEQ,
            source.BARCODE,
            source.PLU,
            source.PLU_DESCRIPTION,
            source.SCAN_QTY,
            source.SCAN_QTY,
            'SCAN',
            'SYNCED',
            @importUser,
            source.SCAN_DATE,
            @deviceId
          FROM source_rows source
          WHERE NOT EXISTS (
            SELECT 1
            FROM dbo.TR_STOCK_TAKE_SCAN existing
            WHERE existing.CLIENT_SCAN_ID = source.CLIENT_SCAN_ID
          );

          SELECT
            @@ROWCOUNT AS inserted_scan_rows,
            @skipped_existing_rows AS skipped_existing_rows;
        `);

      insertedScanRows += Number(chunkResult.recordset[0]?.inserted_scan_rows ?? 0);
      skippedExistingRows += Number(chunkResult.recordset[0]?.skipped_existing_rows ?? 0);
    }

    const summary: ImportSummary = {
      scheduleId,
      scheduleNo: schedule.SCHEDULE_NO,
      locCode: schedule.LOC_CODE,
      csvRows: rows.length,
      uniquePlu: pluCodes.length,
      uniqueRack: rackCodes.length,
      sohRowsBefore,
      sohRowsAfter: sohResult.sohRowCount,
      existingScanRows,
      insertedScanRows,
      skippedExistingRows,
      createdRackRows,
      createdScheduleRackRows,
      dryRun,
    };
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    throw error;
  } finally {
    await pool.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
