import sql from "mssql";
import { env } from "../../config/env.js";
import { getSqlPool } from "../../db/sql.js";
import { mockScanSubmissions } from "../../shared/mock-data.js";
import type {
  SubmitRackScansInput,
  SubmitRackScansResponse,
} from "./scan.types.js";

interface MergeActionRow {
  action: "INSERT" | "UPDATE";
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
