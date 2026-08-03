import sql from "mssql";
import { env } from "../../config/env.js";
import { getSqlPool } from "../../db/sql.js";
import { mockRacks, mockScanSubmissions } from "../../shared/mock-data.js";
import type { RackResponse } from "./rack.types.js";

interface RackRow {
  id: string | number;
  rack_code: string;
  rack_name: string;
  loc_code: string;
  status: string;
  submitted_line_count?: number;
  submitted_quantity?: number;
}

function mapRack(row: RackRow): RackResponse {
  return {
    id: String(row.id),
    rackCode: row.rack_code,
    rackName: row.rack_name,
    locCode: row.loc_code.trim(),
    status: row.status,
    localDraftCount: 0,
    submittedLineCount: Number(row.submitted_line_count ?? 0),
    submittedQuantity: Number(row.submitted_quantity ?? 0),
  };
}

export async function listActiveRacksByLocation(
  locCode: string,
  scheduleId?: number,
): Promise<RackResponse[]> {
  if (env.SQL_MODE === "mock") {
    return mockRacks
      .filter((rack) => rack.locCode === locCode && rack.status === "ACTIVE")
      .map((rack) => {
        const submissions = mockScanSubmissions.filter(
          (scan) =>
            scan.rackId === rack.id &&
            (!scheduleId || Number(scan.scheduleId) === scheduleId),
        );
        return mapRack({
          id: rack.id,
          rack_code: rack.rackCode,
          rack_name: rack.rackName,
          loc_code: rack.locCode,
          status: rack.status,
          submitted_line_count: submissions.length,
          submitted_quantity: submissions.reduce(
            (total, scan) => total + scan.scanQty,
            0,
          ),
        });
      });
  }

  const pool = await getSqlPool();
  const result = await pool
    .request()
    .input("locCode", sql.Char(4), locCode)
    .input("scheduleId", sql.BigInt, scheduleId ?? null)
    .query<RackRow>(`
      SELECT
        CAST(ID AS varchar(30)) AS id,
        RACK_CODE AS rack_code,
        RACK_NAME AS rack_name,
        LOC_CODE AS loc_code,
        STATUS AS status,
        submitted.submitted_line_count,
        submitted.submitted_quantity
      FROM dbo.MST_RACK rack
      OUTER APPLY (
        SELECT
          COUNT(1) AS submitted_line_count,
          COALESCE(SUM(scan.SCAN_QTY), 0) AS submitted_quantity
        FROM dbo.TR_STOCK_TAKE_SCAN scan
        WHERE scan.RACK_ID = rack.ID
          AND (@scheduleId IS NULL OR scan.SCHEDULE_ID = @scheduleId)
          AND scan.SCAN_STATUS = 'SYNCED'
      ) submitted
      WHERE rack.LOC_CODE = @locCode
        AND rack.STATUS = 'ACTIVE'
      ORDER BY RACK_CODE;
    `);
  return result.recordset.map(mapRack);
}

export async function findRackById(rackId: number): Promise<RackResponse | null> {
  if (env.SQL_MODE === "mock") {
    const rack = mockRacks.find((candidate) => Number(candidate.id) === rackId);
    return rack
      ? mapRack({
          id: rack.id,
          rack_code: rack.rackCode,
          rack_name: rack.rackName,
          loc_code: rack.locCode,
          status: rack.status,
        })
      : null;
  }

  const pool = await getSqlPool();
  const result = await pool
    .request()
    .input("rackId", sql.BigInt, rackId)
    .query<RackRow>(`
      SELECT TOP (1)
        CAST(ID AS varchar(30)) AS id,
        RACK_CODE AS rack_code,
        RACK_NAME AS rack_name,
        LOC_CODE AS loc_code,
        STATUS AS status
      FROM dbo.MST_RACK
      WHERE ID = @rackId;
    `);
  const row = result.recordset[0];
  return row ? mapRack(row) : null;
}
