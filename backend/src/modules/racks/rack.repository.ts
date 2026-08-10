import sql from "mssql";
import { env } from "../../config/env.js";
import { getSqlPool } from "../../db/sql.js";
import { mockRacks, mockScanSubmissions, mockScheduleRacks, mockSchedules } from "../../shared/mock-data.js";
import { AppError } from "../../shared/app-error.js";
import type { CreateRackBulkPayload, CreateRackPayload, RackMasterResponse, RackResponse } from "./rack.types.js";

interface RackRow {
  id: string | number;
  rack_code: string;
  rack_name: string;
  loc_code: string;
  status: string;
  submitted_line_count?: number;
  submitted_quantity?: number;
  final_quantity?: number;
  printed_line_count?: number;
  confirmed_line_count?: number;
  rejected_line_count?: number;
  discrepancy_quantity?: number;
}

function mapRack(row: RackRow): RackResponse {
  const submittedLineCount = Number(row.submitted_line_count ?? 0);
  const printedLineCount = Number(row.printed_line_count ?? 0);
  const confirmedLineCount = Number(row.confirmed_line_count ?? 0);
  const rejectedLineCount = Number(row.rejected_line_count ?? 0);
  const rackStatus =
    submittedLineCount === 0 && rejectedLineCount > 0
      ? "REJECTED"
      : submittedLineCount === 0
        ? "EMPTY"
        : confirmedLineCount >= submittedLineCount
          ? "CONFIRMED"
          : printedLineCount > 0
            ? "PRINTED"
            : "SUBMITTED";
  return {
    id: String(row.id),
    rackCode: row.rack_code,
    rackName: row.rack_name,
    locCode: row.loc_code.trim(),
    status: row.status,
    localDraftCount: 0,
    submittedLineCount,
    submittedQuantity: Number(row.submitted_quantity ?? 0),
    finalQuantity: Number(row.final_quantity ?? row.submitted_quantity ?? 0),
    printedLineCount,
    printed: printedLineCount > 0,
    rackStatus,
    confirmedLineCount,
    rejectedLineCount,
    discrepancyQuantity: Number(row.discrepancy_quantity ?? 0),
  };
}

function mapRackMaster(row: Pick<RackRow, "id" | "rack_code" | "rack_name" | "loc_code" | "status">): RackMasterResponse {
  return {
    id: String(row.id),
    rackCode: row.rack_code,
    rackName: row.rack_name,
    locCode: row.loc_code.trim(),
    status: row.status,
  };
}

function normalizeRackCode(rackCode: string): string {
  return rackCode.trim().toUpperCase();
}

function assertRackCodePattern(rackCode: string): void {
  if (!/^RCK-[A-Z]{2}-\d{3}$/.test(rackCode)) {
    throw new AppError(
      400,
      "Format kode rack harus RCK-{2 huruf}-{3 angka}, contoh RCK-FR-001.",
      "RACK_CODE_INVALID_FORMAT",
    );
  }
}

function buildRackCodes(letterCode: string, startSequence: number, count: number): string[] {
  const normalizedLetterCode = letterCode.trim().toUpperCase();
  return Array.from({ length: count }, (_, index) => {
    const sequence = startSequence + index;
    return `RCK-${normalizedLetterCode}-${String(sequence).padStart(3, "0")}`;
  });
}

export async function listActiveRacksByLocation(
  locCode: string,
  scheduleId?: number,
): Promise<RackResponse[]> {
  if (env.SQL_MODE === "mock") {
    const scopedRackIds = scheduleId
      ? new Set(
          mockScheduleRacks
            .filter((scope) => Number(scope.scheduleId) === scheduleId && scope.status === "ACTIVE")
            .map((scope) => scope.rackId),
        )
      : null;
    return mockRacks
      .filter(
        (rack) =>
          rack.locCode === locCode &&
          rack.status === "ACTIVE" &&
          (!scopedRackIds || scopedRackIds.has(rack.id)),
      )
      .map((rack) => {
        const submissions = mockScanSubmissions.filter(
          (scan) =>
            scan.rackId === rack.id &&
            (!scheduleId || Number(scan.scheduleId) === scheduleId),
        );
        const activeSubmissions = submissions.filter(
          (scan) => scan.scanStatus === "SYNCED",
        );
        return mapRack({
          id: rack.id,
          rack_code: rack.rackCode,
          rack_name: rack.rackName,
          loc_code: rack.locCode,
          status: rack.status,
          submitted_line_count: activeSubmissions.length,
          submitted_quantity: activeSubmissions.reduce(
            (total, scan) => total + scan.scanQty,
            0,
          ),
          final_quantity: activeSubmissions.reduce(
            (total, scan) => total + (scan.finalQty ?? scan.scanQty),
            0,
          ),
          printed_line_count: activeSubmissions.filter((scan) => scan.printNo?.trim())
            .length,
          confirmed_line_count: activeSubmissions.filter(
            (scan) => Boolean(scan.confirmTime),
          ).length,
          rejected_line_count: submissions.filter(
            (scan) => scan.scanStatus === "REJECTED",
          ).length,
          discrepancy_quantity: activeSubmissions.reduce(
            (total, scan) =>
              total + ((scan.finalQty ?? scan.scanQty) - scan.scanQty),
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
        CAST(rack.ID AS varchar(30)) AS id,
        rack.RACK_CODE AS rack_code,
        rack.RACK_NAME AS rack_name,
        rack.LOC_CODE AS loc_code,
        rack.STATUS AS status,
        submitted.submitted_line_count,
        submitted.submitted_quantity,
        submitted.final_quantity,
        submitted.printed_line_count,
        submitted.confirmed_line_count,
        rejected.rejected_line_count,
        submitted.discrepancy_quantity
      FROM dbo.MST_RACK rack
      ${scheduleId ? "INNER JOIN dbo.TR_STOCK_SCHEDULE_RACK scope ON scope.RACK_ID = rack.ID AND scope.SCHEDULE_ID = @scheduleId AND scope.STATUS = 'ACTIVE'" : ""}
      OUTER APPLY (
        SELECT
          COUNT(1) AS submitted_line_count,
          COALESCE(SUM(scan.SCAN_QTY), 0) AS submitted_quantity,
          COALESCE(SUM(scan.FINAL_QTY), 0) AS final_quantity,
          SUM(
            CASE
              WHEN NULLIF(LTRIM(RTRIM(scan.PRINT_NO)), '') IS NULL THEN 0
              ELSE 1
            END
          ) AS printed_line_count,
          SUM(
            CASE
              WHEN scan.CONFIRM_TIME IS NOT NULL
              THEN 1
              ELSE 0
            END
          ) AS confirmed_line_count,
          COALESCE(SUM(scan.FINAL_QTY - scan.SCAN_QTY), 0) AS discrepancy_quantity
        FROM dbo.TR_STOCK_TAKE_SCAN scan
        WHERE scan.RACK_ID = rack.ID
          AND (@scheduleId IS NULL OR scan.SCHEDULE_ID = @scheduleId)
          AND scan.SCAN_STATUS = 'SYNCED'
      ) submitted
      OUTER APPLY (
        SELECT COUNT(1) AS rejected_line_count
        FROM dbo.TR_STOCK_TAKE_SCAN scan
        WHERE scan.RACK_ID = rack.ID
          AND (@scheduleId IS NULL OR scan.SCHEDULE_ID = @scheduleId)
          AND scan.SCAN_STATUS = 'REJECTED'
      ) rejected
      WHERE rack.LOC_CODE = @locCode
        AND rack.STATUS = 'ACTIVE'
      ORDER BY rack.RACK_CODE;
    `);
  return result.recordset.map(mapRack);
}

export async function listRackMastersByLocation(
  locCode?: string,
): Promise<RackMasterResponse[]> {
  if (env.SQL_MODE === "mock") {
    return mockRacks
      .filter((rack) => (!locCode || rack.locCode === locCode))
      .map((rack) =>
        mapRackMaster({
          id: rack.id,
          rack_code: rack.rackCode,
          rack_name: rack.rackName,
          loc_code: rack.locCode,
          status: rack.status,
        }),
      );
  }

  const pool = await getSqlPool();
  const result = await pool
    .request()
    .input("locCode", sql.Char(4), locCode ?? null)
    .query<RackRow>(`
      SELECT TOP (1000)
        CAST(ID AS varchar(30)) AS id,
        RACK_CODE AS rack_code,
        RACK_NAME AS rack_name,
        LOC_CODE AS loc_code,
        STATUS AS status
      FROM dbo.MST_RACK
      WHERE (@locCode IS NULL OR LOC_CODE = @locCode)
      ORDER BY LOC_CODE, RACK_CODE;
    `);
  return result.recordset.map(mapRackMaster);
}

export async function createRackMaster(
  payload: CreateRackPayload,
): Promise<RackMasterResponse> {
  const normalizedRackCode = normalizeRackCode(payload.rackCode);
  const normalizedRackName = payload.rackName.trim();
  assertRackCodePattern(normalizedRackCode);

  if (env.SQL_MODE === "mock") {
    if (
      mockRacks.some(
        (rack) =>
          rack.locCode === payload.locCode &&
          rack.rackCode.toUpperCase() === normalizedRackCode,
      )
    ) {
      throw new AppError(409, "Kode rack sudah terdaftar di lokasi ini.", "RACK_CODE_EXISTS");
    }
    const nextId = String(Math.max(...mockRacks.map((rack) => Number(rack.id)), 0) + 1);
    const rack = {
      id: nextId,
      rackCode: normalizedRackCode,
      rackName: normalizedRackName,
      locCode: payload.locCode,
      status: payload.status,
    };
    mockRacks.push(rack);
    return mapRackMaster({
      id: rack.id,
      rack_code: rack.rackCode,
      rack_name: rack.rackName,
      loc_code: rack.locCode,
      status: rack.status,
    });
  }

  const pool = await getSqlPool();
  try {
    const result = await pool
      .request()
      .input("rackCode", sql.VarChar(30), normalizedRackCode)
      .input("rackName", sql.NVarChar(100), normalizedRackName)
      .input("locCode", sql.Char(4), payload.locCode)
      .input("status", sql.VarChar(10), payload.status)
      .input("username", sql.VarChar(100), payload.username)
      .query<RackRow>(`
        IF EXISTS (
          SELECT 1
          FROM dbo.MST_RACK WITH (UPDLOCK, HOLDLOCK)
          WHERE LOC_CODE = @locCode
            AND RACK_CODE = @rackCode
        )
        BEGIN
          THROW 51001, 'RACK_CODE_EXISTS', 1;
        END;

        INSERT INTO dbo.MST_RACK (
          RACK_CODE,
          RACK_NAME,
          LOC_CODE,
          STATUS,
          USER_CREATED
        )
        OUTPUT
          CAST(INSERTED.ID AS varchar(30)) AS id,
          INSERTED.RACK_CODE AS rack_code,
          INSERTED.RACK_NAME AS rack_name,
          INSERTED.LOC_CODE AS loc_code,
          INSERTED.STATUS AS status
        VALUES (
          @rackCode,
          @rackName,
          @locCode,
          @status,
          @username
        );
      `);
    const row = result.recordset[0];
    if (!row) {
      throw new AppError(500, "Rack gagal dibuat.", "RACK_CREATE_FAILED");
    }
    return mapRackMaster(row);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("RACK_CODE_EXISTS")) {
      throw new AppError(409, "Kode rack sudah terdaftar di lokasi ini.", "RACK_CODE_EXISTS");
    }
    throw error;
  }
}

export async function createRackMastersBulk(
  payload: CreateRackBulkPayload,
): Promise<RackMasterResponse[]> {
  const normalizedLetterCode = payload.letterCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalizedLetterCode)) {
    throw new AppError(400, "Kode huruf wajib tepat 2 huruf, contoh FR.", "RACK_LETTER_CODE_INVALID");
  }
  if (payload.startSequence < 1 || payload.startSequence > 999) {
    throw new AppError(400, "Sequence awal harus di antara 001 sampai 999.", "RACK_SEQUENCE_INVALID");
  }
  if (payload.count < 1 || payload.count > 200) {
    throw new AppError(400, "Jumlah generate rack harus 1 sampai 200.", "RACK_BULK_COUNT_INVALID");
  }
  if (payload.startSequence + payload.count - 1 > 999) {
    throw new AppError(400, "Sequence hasil generate tidak boleh melewati 999.", "RACK_SEQUENCE_OVERFLOW");
  }

  const rackCodes = buildRackCodes(normalizedLetterCode, payload.startSequence, payload.count);
  const normalizedNamePrefix = payload.rackNamePrefix.trim();

  if (env.SQL_MODE === "mock") {
    const duplicateCodes = rackCodes.filter((rackCode) =>
      mockRacks.some((rack) => rack.locCode === payload.locCode && rack.rackCode.toUpperCase() === rackCode),
    );
    if (duplicateCodes.length > 0) {
      throw new AppError(
        409,
        `Kode rack sudah terdaftar: ${duplicateCodes.slice(0, 5).join(", ")}${duplicateCodes.length > 5 ? "..." : ""}.`,
        "RACK_CODE_EXISTS",
      );
    }
    let nextId = Math.max(...mockRacks.map((rack) => Number(rack.id)), 0) + 1;
    const racks = rackCodes.map((rackCode) => {
      const sequence = rackCode.slice(-3);
      const rack = {
        id: String(nextId++),
        rackCode,
        rackName: `${normalizedNamePrefix} ${sequence}`.trim(),
        locCode: payload.locCode,
        status: payload.status,
      };
      mockRacks.push(rack);
      return mapRackMaster({
        id: rack.id,
        rack_code: rack.rackCode,
        rack_name: rack.rackName,
        loc_code: rack.locCode,
        status: rack.status,
      });
    });
    return racks;
  }

  const pool = await getSqlPool();
  const values = rackCodes
    .map((rackCode) => {
      const sequence = rackCode.slice(-3);
      return {
        rackCode,
        rackName: `${normalizedNamePrefix} ${sequence}`.trim(),
      };
    });
  const valueRows = values
    .map((_, index) => `(@rackCode${index}, @rackName${index})`)
    .join(",\n          ");
  const request = pool
    .request()
    .input("locCode", sql.Char(4), payload.locCode)
    .input("status", sql.VarChar(10), payload.status)
    .input("username", sql.VarChar(100), payload.username);
  values.forEach((value, index) => {
    request.input(`rackCode${index}`, sql.VarChar(30), value.rackCode);
    request.input(`rackName${index}`, sql.NVarChar(100), value.rackName);
  });

  try {
    const result = await request.query<RackRow>(`
      DECLARE @selectedRack TABLE (
        RACK_CODE varchar(30) NOT NULL,
        RACK_NAME nvarchar(100) NOT NULL
      );

      INSERT INTO @selectedRack (RACK_CODE, RACK_NAME)
      VALUES
        ${valueRows};

      IF EXISTS (
        SELECT 1
        FROM dbo.MST_RACK rack WITH (UPDLOCK, HOLDLOCK)
        INNER JOIN @selectedRack selected
          ON selected.RACK_CODE = rack.RACK_CODE
        WHERE rack.LOC_CODE = @locCode
      )
      BEGIN
        DECLARE @duplicateCodes varchar(max) = (
          SELECT STRING_AGG(rack.RACK_CODE, ', ')
          FROM dbo.MST_RACK rack
          INNER JOIN @selectedRack selected
            ON selected.RACK_CODE = rack.RACK_CODE
          WHERE rack.LOC_CODE = @locCode
        );
        THROW 51001, @duplicateCodes, 1;
      END;

      INSERT INTO dbo.MST_RACK (
        RACK_CODE,
        RACK_NAME,
        LOC_CODE,
        STATUS,
        USER_CREATED
      )
      OUTPUT
        CAST(INSERTED.ID AS varchar(30)) AS id,
        INSERTED.RACK_CODE AS rack_code,
        INSERTED.RACK_NAME AS rack_name,
        INSERTED.LOC_CODE AS loc_code,
        INSERTED.STATUS AS status
      SELECT
        selected.RACK_CODE,
        selected.RACK_NAME,
        @locCode,
        @status,
        @username
      FROM @selectedRack selected
      ORDER BY selected.RACK_CODE;
    `);
    return result.recordset.map(mapRackMaster);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("51001") || message.includes("RCK-")) {
      const duplicateText = message
        .split("\n")
        .find((line) => line.includes("RCK-"))
        ?.trim();
      throw new AppError(
        409,
        duplicateText ? `Kode rack sudah terdaftar: ${duplicateText}.` : "Kode rack sudah terdaftar.",
        "RACK_CODE_EXISTS",
      );
    }
    throw error;
  }
}

export async function addRackToScheduleScope(
  scheduleId: number,
  rackId: number,
  username: string,
): Promise<{ added: boolean; rack: RackMasterResponse }> {
  if (env.SQL_MODE === "mock") {
    const schedule = mockSchedules.find((candidate) => Number(candidate.id) === scheduleId);
    if (!schedule) {
      throw new AppError(404, "Schedule tidak ditemukan.", "SCHEDULE_NOT_FOUND");
    }
    if (["COMPLETED", "CLOSED", "CANCELLED"].includes(schedule.status)) {
      throw new AppError(409, "Schedule sudah close sehingga rack tidak bisa ditambah.", "SCHEDULE_CLOSED");
    }
    const rack = mockRacks.find((candidate) => Number(candidate.id) === rackId);
    if (!rack || rack.locCode !== schedule.locCode || rack.status !== "ACTIVE") {
      throw new AppError(400, "Rack tidak aktif atau tidak sesuai lokasi schedule.", "RACK_SCOPE_INVALID");
    }
    const existing = mockScheduleRacks.find(
      (scope) => Number(scope.scheduleId) === scheduleId && Number(scope.rackId) === rackId,
    );
    if (existing) {
      existing.rackCode = rack.rackCode;
      existing.rackName = rack.rackName;
      existing.locCode = rack.locCode;
      existing.status = "ACTIVE";
      return {
        added: false,
        rack: mapRackMaster({
          id: rack.id,
          rack_code: rack.rackCode,
          rack_name: rack.rackName,
          loc_code: rack.locCode,
          status: rack.status,
        }),
      };
    }
    mockScheduleRacks.push({
      scheduleId: String(scheduleId),
      rackId: rack.id,
      rackCode: rack.rackCode,
      rackName: rack.rackName,
      locCode: rack.locCode,
      status: "ACTIVE",
    });
    return {
      added: true,
      rack: mapRackMaster({
        id: rack.id,
        rack_code: rack.rackCode,
        rack_name: rack.rackName,
        loc_code: rack.locCode,
        status: rack.status,
      }),
    };
  }

  const pool = await getSqlPool();
  const scheduleResult = await pool
    .request()
    .input("scheduleId", sql.BigInt, scheduleId)
    .query<{ loc_code: string; status: string }>(`
      SELECT TOP (1) LOC_CODE AS loc_code, STATUS AS status
      FROM dbo.TR_STOCK_SCHEDULE
      WHERE ID = @scheduleId;
    `);
  const schedule = scheduleResult.recordset[0];
  if (!schedule) {
    throw new AppError(404, "Schedule tidak ditemukan.", "SCHEDULE_NOT_FOUND");
  }
  if (["COMPLETED", "CLOSED", "CANCELLED"].includes(schedule.status)) {
    throw new AppError(409, "Schedule sudah close sehingga rack tidak bisa ditambah.", "SCHEDULE_CLOSED");
  }

  const rackResult = await pool
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
  const rack = rackResult.recordset[0];
  if (!rack || rack.loc_code.trim() !== schedule.loc_code.trim() || rack.status !== "ACTIVE") {
    throw new AppError(400, "Rack tidak aktif atau tidak sesuai lokasi schedule.", "RACK_SCOPE_INVALID");
  }

  const scopeResult = await pool
    .request()
    .input("scheduleId", sql.BigInt, scheduleId)
    .input("rackId", sql.BigInt, rackId)
    .input("rackCode", sql.VarChar(30), rack.rack_code)
    .input("rackName", sql.NVarChar(100), rack.rack_name)
    .input("locCode", sql.Char(4), rack.loc_code.trim())
    .input("username", sql.VarChar(100), username)
    .query<{ merge_action: "INSERT" | "UPDATE" }>(`
      MERGE dbo.TR_STOCK_SCHEDULE_RACK WITH (HOLDLOCK) AS target
      USING (
        SELECT
          @scheduleId AS SCHEDULE_ID,
          @rackId AS RACK_ID,
          @rackCode AS RACK_CODE,
          @rackName AS RACK_NAME,
          @locCode AS LOC_CODE
      ) AS source
      ON target.SCHEDULE_ID = source.SCHEDULE_ID
        AND target.RACK_ID = source.RACK_ID
      WHEN MATCHED THEN
        UPDATE SET
          RACK_CODE = source.RACK_CODE,
          RACK_NAME = source.RACK_NAME,
          LOC_CODE = source.LOC_CODE,
          STATUS = 'ACTIVE',
          USER_MODIFIED = @username,
          DATE_MODIFIED = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (
          SCHEDULE_ID,
          RACK_ID,
          RACK_CODE,
          RACK_NAME,
          LOC_CODE,
          STATUS,
          USER_CREATED
        )
        VALUES (
          source.SCHEDULE_ID,
          source.RACK_ID,
          source.RACK_CODE,
          source.RACK_NAME,
          source.LOC_CODE,
          'ACTIVE',
          @username
        )
      OUTPUT $action AS merge_action;
    `);

  return {
    added: scopeResult.recordset[0]?.merge_action === "INSERT",
    rack: mapRackMaster(rack),
  };
}

export async function isRackInScheduleScope(
  scheduleId: number,
  rackId: number,
): Promise<boolean> {
  if (env.SQL_MODE === "mock") {
    return mockScheduleRacks.some(
      (scope) =>
        Number(scope.scheduleId) === scheduleId &&
        Number(scope.rackId) === rackId &&
        scope.status === "ACTIVE",
    );
  }

  const pool = await getSqlPool();
  const result = await pool
    .request()
    .input("scheduleId", sql.BigInt, scheduleId)
    .input("rackId", sql.BigInt, rackId)
    .query<{ scope_count: number }>(`
      SELECT COUNT(1) AS scope_count
      FROM dbo.TR_STOCK_SCHEDULE_RACK
      WHERE SCHEDULE_ID = @scheduleId
        AND RACK_ID = @rackId
        AND STATUS = 'ACTIVE';
    `);
  return Number(result.recordset[0]?.scope_count ?? 0) > 0;
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
