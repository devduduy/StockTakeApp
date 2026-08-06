import sql from "mssql";
import { env } from "../../config/env.js";
import { getSqlPool } from "../../db/sql.js";
import { mockScanSubmissions } from "../../shared/mock-data.js";
import { AppError } from "../../shared/app-error.js";
import type {
  PrintRackScansInput,
  PrintRackScansResponse,
  RackScanLineResponse,
  SubmitRackScansInput,
  SubmitRackScansResponse,
} from "./scan.types.js";

interface MergeActionRow {
  action: "INSERT" | "UPDATE";
}

interface ScanLineRow {
  id: string | number;
  client_scan_id: string;
  rack_seq: number;
  barcode: string;
  plu: string | null;
  plu_description: string | null;
  scan_qty: number | string;
  input_type: "SCAN" | "MANUAL";
  scan_status: string;
  print_no: string | null;
  date_created: Date | string;
  date_modified: Date | string | null;
}

function isoDateTime(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapScanLine(row: ScanLineRow): RackScanLineResponse {
  return {
    id: String(row.id),
    clientScanId: row.client_scan_id,
    rackSeq: Number(row.rack_seq),
    barcode: row.barcode,
    plu: row.plu ?? "",
    pluDescription: row.plu_description ?? "",
    scanQty: Number(row.scan_qty),
    inputType: row.input_type,
    scanStatus: row.scan_status,
    printNo: row.print_no?.trim() || null,
    dateCreated: isoDateTime(row.date_created) ?? new Date(0).toISOString(),
    dateModified: isoDateTime(row.date_modified),
  };
}

function createPrintNo(scheduleId: number, rackId: number): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  return `PRN-${timestamp}-${scheduleId}-${rackId}`;
}

export async function listRackScans(
  scheduleId: number,
  rackId: number,
): Promise<RackScanLineResponse[]> {
  if (env.SQL_MODE === "mock") {
    return mockScanSubmissions
      .filter(
        (scan) =>
          Number(scan.scheduleId) === scheduleId &&
          Number(scan.rackId) === rackId,
      )
      .map((scan, index) =>
        mapScanLine({
          id: index + 1,
          client_scan_id: scan.clientScanId,
          rack_seq: index + 1,
          barcode: scan.barcode,
          plu: scan.plu,
          plu_description: scan.pluDescription,
          scan_qty: scan.scanQty,
          input_type: scan.inputType,
          scan_status: scan.scanStatus,
          print_no: scan.printNo ?? null,
          date_created: scan.dateCreated,
          date_modified: scan.dateModified ?? null,
        }),
      )
      .sort((left, right) => right.rackSeq - left.rackSeq);
  }

  const pool = await getSqlPool();
  const result = await pool
    .request()
    .input("scheduleId", sql.BigInt, scheduleId)
    .input("rackId", sql.BigInt, rackId)
    .query<ScanLineRow>(`
      SELECT
        CAST(ID AS varchar(30)) AS id,
        CLIENT_SCAN_ID AS client_scan_id,
        RACK_SEQ AS rack_seq,
        BARCODE AS barcode,
        PLU AS plu,
        PLU_DESCRIPTION AS plu_description,
        SCAN_QTY AS scan_qty,
        INPUT_TYPE AS input_type,
        SCAN_STATUS AS scan_status,
        PRINT_NO AS print_no,
        DATE_CREATED AS date_created,
        DATE_MODIFIED AS date_modified
      FROM dbo.TR_STOCK_TAKE_SCAN
      WHERE SCHEDULE_ID = @scheduleId
        AND RACK_ID = @rackId
        AND SCAN_STATUS = 'SYNCED'
      ORDER BY RACK_SEQ DESC, ID DESC;
    `);
  return result.recordset.map(mapScanLine);
}

export async function isRackPrinted(
  scheduleId: number,
  rackId: number,
): Promise<boolean> {
  if (env.SQL_MODE === "mock") {
    return mockScanSubmissions.some(
      (scan) =>
        Number(scan.scheduleId) === scheduleId &&
        Number(scan.rackId) === rackId &&
        Boolean(scan.printNo?.trim()),
    );
  }

  const pool = await getSqlPool();
  const result = await pool
    .request()
    .input("scheduleId", sql.BigInt, scheduleId)
    .input("rackId", sql.BigInt, rackId)
    .query<{ printed_count: number }>(`
      SELECT COUNT(1) AS printed_count
      FROM dbo.TR_STOCK_TAKE_SCAN
      WHERE SCHEDULE_ID = @scheduleId
        AND RACK_ID = @rackId
        AND NULLIF(LTRIM(RTRIM(PRINT_NO)), '') IS NOT NULL;
    `);
  return Number(result.recordset[0]?.printed_count ?? 0) > 0;
}

export async function submitRackScans(
  input: SubmitRackScansInput,
): Promise<SubmitRackScansResponse> {
  const serverTime = new Date().toISOString();
  const submittedQuantity = input.lines.reduce(
    (total, line) => total + line.scanQty,
    0,
  );

  if (env.SQL_MODE === "mock") {
    let insertedLines = 0;
    let updatedLines = 0;
    for (const line of input.lines) {
      const existingIndex = mockScanSubmissions.findIndex(
        (scan) => scan.clientScanId === line.clientScanId,
      );
      if (existingIndex >= 0) {
        const existing = mockScanSubmissions[existingIndex];
        if (!existing) {
          continue;
        }
        mockScanSubmissions[existingIndex] = {
          ...existing,
          barcode: line.barcode,
          plu: line.plu,
          pluDescription: line.pluDescription,
          scanQty: line.scanQty,
          inputType: line.inputType,
          scanStatus: "SYNCED",
          userModified: input.username,
          dateModified: serverTime,
        };
        updatedLines += 1;
      } else {
        mockScanSubmissions.push({
          clientScanId: line.clientScanId,
          scheduleId: String(input.scheduleId),
          scheduleNo: input.scheduleNo,
          rackId: String(input.rackId),
          rackCode: input.rackCode,
          barcode: line.barcode,
          plu: line.plu,
          pluDescription: line.pluDescription,
          scanQty: line.scanQty,
          inputType: line.inputType,
          scanStatus: "SYNCED",
          userCreated: input.username,
          dateCreated: serverTime,
        });
        insertedLines += 1;
      }
    }
    return {
      acceptedLines: input.lines.length,
      insertedLines,
      updatedLines,
      submittedQuantity,
      serverTime,
    };
  }

  const pool = await getSqlPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    let insertedLines = 0;
    let updatedLines = 0;

    for (const line of input.lines) {
      const result = await new sql.Request(transaction)
        .input("scheduleId", sql.BigInt, input.scheduleId)
        .input("scheduleNo", sql.VarChar(50), input.scheduleNo)
        .input("rackId", sql.BigInt, input.rackId)
        .input("rackCode", sql.VarChar(50), input.rackCode)
        .input("clientScanId", sql.VarChar(64), line.clientScanId)
        .input("barcode", sql.VarChar(50), line.barcode)
        .input("plu", sql.VarChar(30), line.plu)
        .input("pluDescription", sql.NVarChar(255), line.pluDescription)
        .input("scanQty", sql.Int, line.scanQty)
        .input("inputType", sql.VarChar(20), line.inputType)
        .input("username", sql.VarChar(100), input.username)
        .query<MergeActionRow>(`
          MERGE dbo.TR_STOCK_TAKE_SCAN WITH (HOLDLOCK) AS target
          USING (
            SELECT @clientScanId AS CLIENT_SCAN_ID
          ) AS source
            ON target.CLIENT_SCAN_ID = source.CLIENT_SCAN_ID
          WHEN MATCHED THEN
            UPDATE SET
              SCHEDULE_ID = @scheduleId,
              SCHEDULE_NO = @scheduleNo,
              RACK_ID = @rackId,
              RACK_CODE = @rackCode,
              BARCODE = @barcode,
              PLU = @plu,
              PLU_DESCRIPTION = @pluDescription,
              SCAN_QTY = @scanQty,
              FINAL_QTY = @scanQty,
              INPUT_TYPE = @inputType,
              SCAN_STATUS = 'SYNCED',
              USER_MODIFIED = @username,
              DATE_MODIFIED = SYSUTCDATETIME()
          WHEN NOT MATCHED THEN
            INSERT (
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
              CLIENT_SCAN_ID,
              USER_CREATED,
              DATE_CREATED
            )
            VALUES (
              @scheduleId,
              @scheduleNo,
              @rackId,
              @rackCode,
              COALESCE(
                (
                  SELECT MAX(existing.RACK_SEQ) + 1
                  FROM dbo.TR_STOCK_TAKE_SCAN existing WITH (UPDLOCK, HOLDLOCK)
                  WHERE existing.SCHEDULE_ID = @scheduleId
                    AND existing.RACK_ID = @rackId
                ),
                1
              ),
              @barcode,
              @plu,
              @pluDescription,
              @scanQty,
              @scanQty,
              @inputType,
              'SYNCED',
              @clientScanId,
              @username,
              SYSUTCDATETIME()
            )
          OUTPUT $action AS action;
        `);
      const action = result.recordset[0]?.action;
      if (action === "INSERT") {
        insertedLines += 1;
      } else if (action === "UPDATE") {
        updatedLines += 1;
      }
    }

    await transaction.commit();
    return {
      acceptedLines: input.lines.length,
      insertedLines,
      updatedLines,
      submittedQuantity,
      serverTime,
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function printRackScans(
  input: PrintRackScansInput,
): Promise<PrintRackScansResponse> {
  const printTimeDate = new Date();
  const printTime = printTimeDate.toISOString();

  if (env.SQL_MODE === "mock") {
    const scans = mockScanSubmissions.filter(
      (scan) =>
        Number(scan.scheduleId) === input.scheduleId &&
        Number(scan.rackId) === input.rackId,
    );
    if (scans.length === 0) {
      throw new AppError(
        409,
        "Rack belum memiliki data scan untuk diprint.",
        "RACK_HAS_NO_SCANS",
      );
    }
    const printNo =
      scans.find((scan) => scan.printNo?.trim())?.printNo?.trim() ??
      createPrintNo(input.scheduleId, input.rackId);
    for (const scan of scans) {
      scan.printNo = printNo;
      scan.userModified = input.username;
      scan.dateModified = printTime;
    }
    return {
      printNo,
      printTime,
      printedLineCount: scans.length,
      printedQuantity: scans.reduce((total, scan) => total + scan.scanQty, 0),
    };
  }

  const pool = await getSqlPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const summary = await new sql.Request(transaction)
      .input("scheduleId", sql.BigInt, input.scheduleId)
      .input("rackId", sql.BigInt, input.rackId)
      .query<{
        submitted_line_count: number;
        submitted_quantity: number;
        existing_print_no: string | null;
      }>(`
        SELECT
          COUNT(1) AS submitted_line_count,
          COALESCE(SUM(SCAN_QTY), 0) AS submitted_quantity,
          MAX(NULLIF(LTRIM(RTRIM(PRINT_NO)), '')) AS existing_print_no
        FROM dbo.TR_STOCK_TAKE_SCAN WITH (UPDLOCK, HOLDLOCK)
        WHERE SCHEDULE_ID = @scheduleId
          AND RACK_ID = @rackId
          AND SCAN_STATUS = 'SYNCED';
      `);
    const row = summary.recordset[0];
    const submittedLineCount = Number(row?.submitted_line_count ?? 0);
    const submittedQuantity = Number(row?.submitted_quantity ?? 0);
    const printNo =
      row?.existing_print_no?.trim() || createPrintNo(input.scheduleId, input.rackId);

    if (submittedLineCount === 0) {
      throw new AppError(
        409,
        "Rack belum memiliki data scan untuk diprint.",
        "RACK_HAS_NO_SCANS",
      );
    }

    await new sql.Request(transaction)
      .input("scheduleId", sql.BigInt, input.scheduleId)
      .input("rackId", sql.BigInt, input.rackId)
      .input("printNo", sql.VarChar(50), printNo)
      .input("printTime", sql.DateTime2, printTimeDate)
      .input("username", sql.VarChar(100), input.username)
      .query(`
        UPDATE dbo.TR_STOCK_TAKE_SCAN
        SET PRINT_NO = COALESCE(NULLIF(LTRIM(RTRIM(PRINT_NO)), ''), @printNo),
            PRINT_TIME = @printTime,
            USER_MODIFIED = @username,
            DATE_MODIFIED = @printTime
        WHERE SCHEDULE_ID = @scheduleId
          AND RACK_ID = @rackId
          AND SCAN_STATUS = 'SYNCED';
      `);

    await transaction.commit();
    return {
      printNo,
      printTime,
      printedLineCount: submittedLineCount,
      printedQuantity: submittedQuantity,
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
