import sql from "mssql";
import { env } from "../../config/env.js";
import { getSqlPool } from "../../db/sql.js";
import { listCategoriesByIds } from "../categories/category.repository.js";
import { mockRacks, mockScheduleRacks, mockSchedules, mockScanSubmissions } from "../../shared/mock-data.js";
import { AppError } from "../../shared/app-error.js";
import { parseCategoryIds } from "../../shared/category-filter.js";
import type {
  ActiveSchedule,
  ScheduleMutatePayload,
  ScheduleLocation,
} from "./schedule.types.js";

interface ScheduleRow {
  id: string | number;
  schedule_no: string;
  schedule_desc: string;
  loc_code: string;
  loc_name: string | null;
  schedule_date: Date | string;
  end_date: Date | string | null;
  cut_off_date: Date | string | null;
  start_time: Date | string | null;
  end_time: Date | string | null;
  stock_type_id: number;
  stock_type_code: string;
  stock_type_name: string;
  stock_type_value: string | null;
  category_id: string | null;
  status: string;
  total_rack: number;
  submitted_rack_count: number;
  rack_ids: string | null;
}
function isoDate(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
}

function isoDateTime(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function stockTypeId(stockType: "ALL" | "PARTIAL"): number {
  return stockType === "ALL" ? 1 : 2;
}

function stockTypeCode(stockType: "ALL" | "PARTIAL"): string {
  return stockType === "ALL" ? "STOCK_ALL" : "STOCK_PARTIAL";
}

function stockTypeName(stockType: "ALL" | "PARTIAL"): string {
  return stockType;
}

function categoryValue(payload: ScheduleMutatePayload): string | null {
  return payload.stockType === "ALL" ? null : payload.categoryIds.join(",");
}

function scheduleDescription(payload: ScheduleMutatePayload): string {
  return `STOCK TAKE ${payload.locCode} ${payload.stockType} ${payload.cutOffDate}`;
}

function combineDateTime(date: string, time: string | null): string | null {
  return time ? `${date}T${time}:00` : null;
}

function assertValidSchedulePeriod(payload: ScheduleMutatePayload): void {
  const startDate = new Date(`${payload.startDate}T00:00:00`);
  const endDate = new Date(`${payload.endDate}T00:00:00`);
  if (endDate < startDate) {
    throw new AppError(
      400,
      "Tanggal selesai tidak boleh lebih kecil dari tanggal mulai.",
      "INVALID_SCHEDULE_PERIOD",
    );
  }
  if (
    payload.startDate === payload.endDate &&
    payload.startTime &&
    payload.endTime &&
    payload.endTime < payload.startTime
  ) {
    throw new AppError(
      400,
      "Jam selesai tidak boleh lebih kecil dari jam mulai untuk schedule di tanggal yang sama.",
      "INVALID_SCHEDULE_TIME",
    );
  }
}

async function assertValidCategories(payload: ScheduleMutatePayload): Promise<void> {
  if (payload.stockType === "ALL") {
    return;
  }
  if (payload.categoryIds.length === 0) {
    throw new AppError(
      400,
      "Schedule PARTIAL wajib memiliki minimal satu kategori.",
      "CATEGORY_REQUIRED",
    );
  }
  const categories = await listCategoriesByIds(payload.categoryIds);
  if (categories.length !== new Set(payload.categoryIds).size) {
    throw new AppError(
      400,
      "Ada kategori yang tidak ditemukan di MasterData.",
      "CATEGORY_NOT_FOUND",
    );
  }
}

async function mapSchedule(row: ScheduleRow): Promise<ActiveSchedule> {
  const categoryIds = parseCategoryIds(row.category_id);
  const startDate = isoDate(row.schedule_date);
  const endDate = row.end_date ? isoDate(row.end_date) : startDate;
  const cutOffDate = row.cut_off_date ? isoDate(row.cut_off_date) : startDate;
  return {
    id: String(row.id),
    scheduleNo: row.schedule_no,
    scheduleDesc: row.schedule_desc,
    locCode: row.loc_code.trim(),
    location: {
      code: row.loc_code.trim(),
      name: row.loc_name?.trim() || row.loc_code.trim(),
    },
    scheduleDate: startDate,
    startDate,
    endDate,
    cutOffDate,
    startTime: isoDateTime(row.start_time),
    endTime: isoDateTime(row.end_time),
    stockType: {
      id: row.stock_type_id,
      code: row.stock_type_code,
      name: row.stock_type_name,
      value: row.stock_type_value,
    },
    categoryIds,
    rackIds: parseCategoryIds(row.rack_ids),
    categories: await listCategoriesByIds(categoryIds),
    status: row.status,
    progress: {
      totalRack: row.total_rack,
      rackWithSubmittedScan: row.submitted_rack_count,
      percentage:
        row.total_rack <= 0
          ? 0
          : Math.round((row.submitted_rack_count / row.total_rack) * 100),
    },
  };
}

function uniqueRackIds(rackIds: string[]): string[] {
  return [...new Set(rackIds.map((rackId) => rackId.trim()).filter(Boolean))];
}

async function applyMockScheduleRackScope(
  scheduleId: string,
  payload: ScheduleMutatePayload,
): Promise<void> {
  const rackIds =
    payload.stockType === "ALL"
      ? mockRacks
          .filter((rack) => rack.locCode === payload.locCode && rack.status === "ACTIVE")
          .map((rack) => rack.id)
      : uniqueRackIds(payload.rackIds);

  if (payload.stockType === "PARTIAL" && rackIds.length === 0) {
    throw new AppError(
      400,
      "Schedule PARTIAL wajib memilih minimal satu rack.",
      "RACK_SCOPE_REQUIRED",
    );
  }

  const racks = mockRacks.filter(
    (rack) => rackIds.includes(rack.id) && rack.locCode === payload.locCode && rack.status === "ACTIVE",
  );
  if (racks.length === 0) {
    throw new AppError(
      400,
      "Lokasi schedule belum memiliki rack aktif. Buat master rack terlebih dahulu.",
      "RACK_SCOPE_REQUIRED",
    );
  }
  if (racks.length !== rackIds.length) {
    throw new AppError(
      400,
      "Ada rack yang tidak ditemukan atau tidak sesuai lokasi schedule.",
      "RACK_SCOPE_INVALID",
    );
  }

  for (let index = mockScheduleRacks.length - 1; index >= 0; index -= 1) {
    if (mockScheduleRacks[index]?.scheduleId === scheduleId) {
      mockScheduleRacks.splice(index, 1);
    }
  }
  mockScheduleRacks.push(
    ...racks.map((rack) => ({
      scheduleId,
      rackId: rack.id,
      rackCode: rack.rackCode,
      rackName: rack.rackName,
      locCode: rack.locCode,
      status: "ACTIVE",
    })),
  );
}

async function applySqlScheduleRackScope(
  transaction: sql.Transaction,
  scheduleId: number,
  payload: ScheduleMutatePayload,
): Promise<void> {
  await transaction
    .request()
    .input("scheduleId", sql.BigInt, scheduleId)
    .query(`
      DELETE FROM dbo.TR_STOCK_SCHEDULE_RACK
      WHERE SCHEDULE_ID = @scheduleId;
    `);

  if (payload.stockType === "ALL") {
    const insertResult = await transaction
      .request()
      .input("scheduleId", sql.BigInt, scheduleId)
      .input("locCode", sql.Char(4), payload.locCode)
      .input("username", sql.VarChar(100), payload.username)
      .query<{ inserted_rack_count: number }>(`
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
          @scheduleId,
          rack.ID,
          rack.RACK_CODE,
          rack.RACK_NAME,
          rack.LOC_CODE,
          'ACTIVE',
          @username
        FROM dbo.MST_RACK rack
        WHERE rack.LOC_CODE = @locCode
          AND rack.STATUS = 'ACTIVE';

        SELECT @@ROWCOUNT AS inserted_rack_count;
      `);
    if (Number(insertResult.recordset[0]?.inserted_rack_count ?? 0) === 0) {
      throw new AppError(
        400,
        "Lokasi schedule belum memiliki rack aktif. Buat master rack terlebih dahulu.",
        "RACK_SCOPE_REQUIRED",
      );
    }
    return;
  }

  const rackIds = uniqueRackIds(payload.rackIds);
  if (rackIds.length === 0) {
    throw new AppError(
      400,
      "Schedule PARTIAL wajib memilih minimal satu rack.",
      "RACK_SCOPE_REQUIRED",
    );
  }

  const rackIdCsv = rackIds.join(",");
  const validation = await transaction
    .request()
    .input("locCode", sql.Char(4), payload.locCode)
    .input("rackIdCsv", sql.VarChar(sql.MAX), rackIdCsv)
    .query<{ valid_rack_count: number }>(`
      SELECT COUNT(DISTINCT rack.ID) AS valid_rack_count
      FROM dbo.MST_RACK rack
      INNER JOIN STRING_SPLIT(@rackIdCsv, ',') selected
        ON TRY_CONVERT(bigint, selected.value) = rack.ID
      WHERE rack.LOC_CODE = @locCode
        AND rack.STATUS = 'ACTIVE';
    `);
  if (Number(validation.recordset[0]?.valid_rack_count ?? 0) !== rackIds.length) {
    throw new AppError(
      400,
      "Ada rack yang tidak ditemukan atau tidak sesuai lokasi schedule.",
      "RACK_SCOPE_INVALID",
    );
  }

  await transaction
    .request()
    .input("scheduleId", sql.BigInt, scheduleId)
    .input("locCode", sql.Char(4), payload.locCode)
    .input("rackIdCsv", sql.VarChar(sql.MAX), rackIdCsv)
    .input("username", sql.VarChar(100), payload.username)
    .query(`
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
        @scheduleId,
        rack.ID,
        rack.RACK_CODE,
        rack.RACK_NAME,
        rack.LOC_CODE,
        'ACTIVE',
        @username
      FROM dbo.MST_RACK rack
      INNER JOIN STRING_SPLIT(@rackIdCsv, ',') selected
        ON TRY_CONVERT(bigint, selected.value) = rack.ID
      WHERE rack.LOC_CODE = @locCode
        AND rack.STATUS = 'ACTIVE';
    `);
}

export async function listActiveSchedules(
  locCode?: string,
): Promise<ActiveSchedule[]> {
  if (env.SQL_MODE === "mock") {
    const schedules = mockSchedules
      .filter(
        (schedule) =>
          ["OPEN", "IN_PROGRESS"].includes(schedule.status) &&
          (!locCode || schedule.locCode === locCode),
      )
      .map(async (schedule) =>
        mapSchedule({
          id: schedule.id,
          schedule_no: schedule.scheduleNo,
          schedule_desc: schedule.scheduleDesc,
          loc_code: schedule.locCode,
          loc_name: schedule.locationName ?? schedule.locCode,
          schedule_date: schedule.scheduleDate,
          end_date: schedule.endDate,
          cut_off_date: schedule.cutOffDate ?? schedule.scheduleDate,
          start_time: schedule.startTime,
          end_time: schedule.endTime,
          stock_type_id: schedule.stockTypeId,
          stock_type_code: schedule.stockTypeCode,
          stock_type_name: schedule.stockTypeName,
          stock_type_value: schedule.stockTypeValue,
          category_id: schedule.categoryId,
          status: schedule.status,
          total_rack: mockScheduleRacks.filter(
            (scope) => scope.scheduleId === schedule.id && scope.status === "ACTIVE",
          ).length,
          submitted_rack_count: new Set(
            mockScanSubmissions
              .filter((scan) => scan.scheduleId === schedule.id)
              .map((scan) => scan.rackId),
          ).size,
          rack_ids: mockScheduleRacks
            .filter((scope) => scope.scheduleId === schedule.id && scope.status === "ACTIVE")
            .map((scope) => scope.rackId)
            .join(","),
        }),
      );
    return Promise.all(schedules);
  }

  const pool = await getSqlPool();
  const request = pool.request();
  request.input("locCode", sql.Char(4), locCode ?? null);
  const result = await request.query<ScheduleRow>(`
    SELECT TOP (100)
      CAST(s.ID AS varchar(30)) AS id,
      s.SCHEDULE_NO AS schedule_no,
      s.SCHEDULE_DESC AS schedule_desc,
      s.LOC_CODE AS loc_code,
      loc.flocname AS loc_name,
      s.SCHEDULE_DATE AS schedule_date,
      ISNULL(s.END_DATE, s.SCHEDULE_DATE) AS end_date,
      ISNULL(s.CUT_OFF_SOH_DATE, s.SCHEDULE_DATE) AS cut_off_date,
      s.START_TIME AS start_time,
      s.END_TIME AS end_time,
      s.STOCK_TYPE_ID AS stock_type_id,
      st.STOCK_TYPE_CODE AS stock_type_code,
      st.STOCK_TYPE_NAME AS stock_type_name,
      s.STOCK_TYPE_VALUE AS stock_type_value,
      s.CATEGORY_ID AS category_id,
      s.STATUS AS status,
      (
        SELECT COUNT(*)
        FROM dbo.TR_STOCK_SCHEDULE_RACK scope
        WHERE scope.SCHEDULE_ID = s.ID
          AND scope.STATUS = 'ACTIVE'
      ) AS total_rack,
      (
        SELECT COUNT(DISTINCT scan.RACK_ID)
        FROM dbo.TR_STOCK_TAKE_SCAN scan
        WHERE scan.SCHEDULE_ID = s.ID
          AND scan.SCAN_STATUS = 'SYNCED'
      ) AS submitted_rack_count,
      (
        SELECT STRING_AGG(CONVERT(varchar(30), scope.RACK_ID), ',')
        FROM dbo.TR_STOCK_SCHEDULE_RACK scope
        WHERE scope.SCHEDULE_ID = s.ID
          AND scope.STATUS = 'ACTIVE'
      ) AS rack_ids
    FROM dbo.TR_STOCK_SCHEDULE s
    INNER JOIN dbo.MST_STOCK_TYPE st ON st.ID = s.STOCK_TYPE_ID
    LEFT JOIN MasterData.dbo.MFLOCATION loc
      ON loc.floccode COLLATE DATABASE_DEFAULT = s.LOC_CODE COLLATE DATABASE_DEFAULT
    WHERE s.STATUS IN ('OPEN', 'IN_PROGRESS')
      AND (@locCode IS NULL OR s.LOC_CODE = @locCode)
    ORDER BY s.SCHEDULE_DATE DESC, s.ID DESC;
  `);
  return Promise.all(result.recordset.map(mapSchedule));
}

export async function listSchedules(locCode?: string): Promise<ActiveSchedule[]> {
  if (env.SQL_MODE === "mock") {
    const schedules = mockSchedules
      .filter((schedule) => !locCode || schedule.locCode === locCode)
      .map(async (schedule) =>
        mapSchedule({
          id: schedule.id,
          schedule_no: schedule.scheduleNo,
          schedule_desc: schedule.scheduleDesc,
          loc_code: schedule.locCode,
          loc_name: schedule.locationName ?? schedule.locCode,
          schedule_date: schedule.scheduleDate,
          end_date: schedule.endDate,
          cut_off_date: schedule.cutOffDate ?? schedule.scheduleDate,
          start_time: schedule.startTime,
          end_time: schedule.endTime,
          stock_type_id: schedule.stockTypeId,
          stock_type_code: schedule.stockTypeCode,
          stock_type_name: schedule.stockTypeName,
          stock_type_value: schedule.stockTypeValue,
          category_id: schedule.categoryId,
          status: schedule.status,
          total_rack: mockScheduleRacks.filter(
            (scope) => scope.scheduleId === schedule.id && scope.status === "ACTIVE",
          ).length,
          submitted_rack_count: new Set(
            mockScanSubmissions
              .filter((scan) => scan.scheduleId === schedule.id)
              .map((scan) => scan.rackId),
          ).size,
          rack_ids: mockScheduleRacks
            .filter((scope) => scope.scheduleId === schedule.id && scope.status === "ACTIVE")
            .map((scope) => scope.rackId)
            .join(","),
        }),
      );
    return Promise.all(schedules);
  }

  const pool = await getSqlPool();
  const request = pool.request();
  request.input("locCode", sql.Char(4), locCode ?? null);
  const result = await request.query<ScheduleRow>(`
    SELECT TOP (200)
      CAST(s.ID AS varchar(30)) AS id,
      s.SCHEDULE_NO AS schedule_no,
      s.SCHEDULE_DESC AS schedule_desc,
      s.LOC_CODE AS loc_code,
      loc.flocname AS loc_name,
      s.SCHEDULE_DATE AS schedule_date,
      ISNULL(s.END_DATE, s.SCHEDULE_DATE) AS end_date,
      ISNULL(s.CUT_OFF_SOH_DATE, s.SCHEDULE_DATE) AS cut_off_date,
      s.START_TIME AS start_time,
      s.END_TIME AS end_time,
      s.STOCK_TYPE_ID AS stock_type_id,
      st.STOCK_TYPE_CODE AS stock_type_code,
      st.STOCK_TYPE_NAME AS stock_type_name,
      s.STOCK_TYPE_VALUE AS stock_type_value,
      s.CATEGORY_ID AS category_id,
      s.STATUS AS status,
      (
        SELECT COUNT(*)
        FROM dbo.TR_STOCK_SCHEDULE_RACK scope
        WHERE scope.SCHEDULE_ID = s.ID
          AND scope.STATUS = 'ACTIVE'
      ) AS total_rack,
      (
        SELECT COUNT(DISTINCT scan.RACK_ID)
        FROM dbo.TR_STOCK_TAKE_SCAN scan
        WHERE scan.SCHEDULE_ID = s.ID
          AND scan.SCAN_STATUS = 'SYNCED'
      ) AS submitted_rack_count,
      (
        SELECT STRING_AGG(CONVERT(varchar(30), scope.RACK_ID), ',')
        FROM dbo.TR_STOCK_SCHEDULE_RACK scope
        WHERE scope.SCHEDULE_ID = s.ID
          AND scope.STATUS = 'ACTIVE'
      ) AS rack_ids
    FROM dbo.TR_STOCK_SCHEDULE s
    INNER JOIN dbo.MST_STOCK_TYPE st ON st.ID = s.STOCK_TYPE_ID
    LEFT JOIN MasterData.dbo.MFLOCATION loc
      ON loc.floccode COLLATE DATABASE_DEFAULT = s.LOC_CODE COLLATE DATABASE_DEFAULT
    WHERE (@locCode IS NULL OR s.LOC_CODE = @locCode)
    ORDER BY s.SCHEDULE_DATE DESC, s.ID DESC;
  `);
  return Promise.all(result.recordset.map(mapSchedule));
}

export async function listSchedulesByIds(
  scheduleIds: number[],
  activeOnly = false,
): Promise<ActiveSchedule[]> {
  const uniqueIds = [...new Set(scheduleIds.filter(Number.isSafeInteger))];
  if (uniqueIds.length === 0) return [];

  if (env.SQL_MODE === "mock") {
    const idSet = new Set(uniqueIds.map(String));
    const schedules = mockSchedules
      .filter((schedule) => idSet.has(schedule.id))
      .filter((schedule) => !activeOnly || ["OPEN", "IN_PROGRESS"].includes(schedule.status))
      .map(async (schedule) =>
        mapSchedule({
          id: schedule.id,
          schedule_no: schedule.scheduleNo,
          schedule_desc: schedule.scheduleDesc,
          loc_code: schedule.locCode,
          loc_name: schedule.locationName ?? schedule.locCode,
          schedule_date: schedule.scheduleDate,
          end_date: schedule.endDate,
          cut_off_date: schedule.cutOffDate ?? schedule.scheduleDate,
          start_time: schedule.startTime,
          end_time: schedule.endTime,
          stock_type_id: schedule.stockTypeId,
          stock_type_code: schedule.stockTypeCode,
          stock_type_name: schedule.stockTypeName,
          stock_type_value: schedule.stockTypeValue,
          category_id: schedule.categoryId,
          status: schedule.status,
          total_rack: mockScheduleRacks.filter(
            (scope) => scope.scheduleId === schedule.id && scope.status === "ACTIVE",
          ).length,
          submitted_rack_count: new Set(
            mockScanSubmissions
              .filter((scan) => scan.scheduleId === schedule.id)
              .map((scan) => scan.rackId),
          ).size,
          rack_ids: mockScheduleRacks
            .filter((scope) => scope.scheduleId === schedule.id && scope.status === "ACTIVE")
            .map((scope) => scope.rackId)
            .join(","),
        }),
      );
    return Promise.all(schedules);
  }

  const pool = await getSqlPool();
  const result = await pool
    .request()
    .input("scheduleIds", sql.VarChar(sql.MAX), uniqueIds.join(","))
    .input("activeOnly", sql.Bit, activeOnly ? 1 : 0)
    .query<ScheduleRow>(`
      SELECT TOP (200)
        CAST(s.ID AS varchar(30)) AS id,
        s.SCHEDULE_NO AS schedule_no,
        s.SCHEDULE_DESC AS schedule_desc,
        s.LOC_CODE AS loc_code,
        loc.flocname AS loc_name,
        s.SCHEDULE_DATE AS schedule_date,
        ISNULL(s.END_DATE, s.SCHEDULE_DATE) AS end_date,
        ISNULL(s.CUT_OFF_SOH_DATE, s.SCHEDULE_DATE) AS cut_off_date,
        s.START_TIME AS start_time,
        s.END_TIME AS end_time,
        s.STOCK_TYPE_ID AS stock_type_id,
        st.STOCK_TYPE_CODE AS stock_type_code,
        st.STOCK_TYPE_NAME AS stock_type_name,
        s.STOCK_TYPE_VALUE AS stock_type_value,
        s.CATEGORY_ID AS category_id,
        s.STATUS AS status,
        (
          SELECT COUNT(*)
          FROM dbo.TR_STOCK_SCHEDULE_RACK scope
          WHERE scope.SCHEDULE_ID = s.ID
            AND scope.STATUS = 'ACTIVE'
        ) AS total_rack,
        (
          SELECT COUNT(DISTINCT scan.RACK_ID)
          FROM dbo.TR_STOCK_TAKE_SCAN scan
          WHERE scan.SCHEDULE_ID = s.ID
            AND scan.SCAN_STATUS = 'SYNCED'
        ) AS submitted_rack_count,
        (
          SELECT STRING_AGG(CONVERT(varchar(30), scope.RACK_ID), ',')
          FROM dbo.TR_STOCK_SCHEDULE_RACK scope
          WHERE scope.SCHEDULE_ID = s.ID
            AND scope.STATUS = 'ACTIVE'
        ) AS rack_ids
      FROM dbo.TR_STOCK_SCHEDULE s
      INNER JOIN dbo.MST_STOCK_TYPE st ON st.ID = s.STOCK_TYPE_ID
      LEFT JOIN MasterData.dbo.MFLOCATION loc
        ON loc.floccode COLLATE DATABASE_DEFAULT = s.LOC_CODE COLLATE DATABASE_DEFAULT
      INNER JOIN STRING_SPLIT(@scheduleIds, ',') selected
        ON TRY_CONVERT(bigint, selected.value) = s.ID
      WHERE (@activeOnly = 0 OR s.STATUS IN ('OPEN', 'IN_PROGRESS'))
      ORDER BY s.SCHEDULE_DATE DESC, s.ID DESC;
    `);
  return Promise.all(result.recordset.map(mapSchedule));
}

export async function createSchedule(
  payload: ScheduleMutatePayload,
): Promise<ActiveSchedule> {
  assertValidSchedulePeriod(payload);
  await assertValidCategories(payload);
  const generatedScheduleDesc = scheduleDescription(payload);

  if (env.SQL_MODE === "mock") {
    const nextId = String(Math.max(...mockSchedules.map((schedule) => Number(schedule.id)), 0) + 1);
    const sequence = String(mockSchedules.length + 1).padStart(4, "0");
    const scheduleNo = `ST/${payload.startDate.slice(0, 4)}/${payload.startDate.slice(5, 7)}/${sequence}`;
    await applyMockScheduleRackScope(nextId, payload);
    mockSchedules.push({
      id: nextId,
      scheduleNo,
      scheduleDesc: generatedScheduleDesc,
      locCode: payload.locCode,
      locationName: `HERO SUPERMARKET ${payload.locCode}`,
      scheduleDate: payload.startDate,
      endDate: payload.endDate,
      cutOffDate: payload.cutOffDate,
      startTime: combineDateTime(payload.startDate, payload.startTime),
      endTime: combineDateTime(payload.endDate, payload.endTime),
      stockTypeId: stockTypeId(payload.stockType),
      stockTypeCode: stockTypeCode(payload.stockType),
      stockTypeName: stockTypeName(payload.stockType),
      stockTypeValue: payload.stockType,
      categoryId: categoryValue(payload),
      status: payload.status,
    });
    const schedule = await listSchedules(payload.locCode);
    return schedule.find((item) => item.id === nextId)!;
  }

  const pool = await getSqlPool();
  const transaction = new sql.Transaction(pool);
  let createdId: string | number | undefined;
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const result = await transaction
      .request()
      .input("locCode", sql.Char(4), payload.locCode)
      .input("scheduleDesc", sql.NVarChar(250), generatedScheduleDesc)
      .input("scheduleDate", sql.Date, payload.startDate)
      .input("endDate", sql.Date, payload.endDate)
      .input("cutOffDate", sql.Date, payload.cutOffDate)
      .input("startTime", sql.VarChar(19), combineDateTime(payload.startDate, payload.startTime))
      .input("endTime", sql.VarChar(19), combineDateTime(payload.endDate, payload.endTime))
      .input("stockTypeId", sql.SmallInt, stockTypeId(payload.stockType))
      .input("stockTypeValue", sql.VarChar(50), payload.stockType)
      .input("categoryId", sql.VarChar(sql.MAX), categoryValue(payload))
      .input("status", sql.VarChar(20), payload.status)
      .input("username", sql.VarChar(100), payload.username)
      .query<{ id: string | number }>(`
        DECLARE @period varchar(7) = FORMAT(CONVERT(date, @scheduleDate), 'yyyy/MM');
        DECLARE @nextSequence int = (
          SELECT ISNULL(MAX(TRY_CONVERT(int, RIGHT(SCHEDULE_NO, 4))), 0) + 1
          FROM dbo.TR_STOCK_SCHEDULE WITH (UPDLOCK, HOLDLOCK)
          WHERE SCHEDULE_NO LIKE 'ST/' + @period + '/%'
        );
        DECLARE @scheduleNo varchar(50) = 'ST/' + @period + '/' + RIGHT('0000' + CONVERT(varchar(10), @nextSequence), 4);

        INSERT INTO dbo.TR_STOCK_SCHEDULE (
          SCHEDULE_NO,
          SCHEDULE_DESC,
          LOC_CODE,
          SCHEDULE_DATE,
          END_DATE,
          CUT_OFF_SOH_DATE,
          START_TIME,
          END_TIME,
          STOCK_TYPE_ID,
          STOCK_TYPE_VALUE,
          STATUS,
          USER_CREATED,
          CATEGORY_ID
        )
        OUTPUT CAST(INSERTED.ID AS varchar(30)) AS id
        VALUES (
          @scheduleNo,
          @scheduleDesc,
          @locCode,
          @scheduleDate,
          @endDate,
          @cutOffDate,
          CASE WHEN @startTime IS NULL THEN NULL ELSE CONVERT(datetime2, @startTime, 126) END,
          CASE WHEN @endTime IS NULL THEN NULL ELSE CONVERT(datetime2, @endTime, 126) END,
          @stockTypeId,
          @stockTypeValue,
          @status,
          @username,
          @categoryId
        );
      `);
    const created = result.recordset[0];
    if (!created) {
      throw new AppError(500, "Schedule gagal dibuat.", "SCHEDULE_CREATE_FAILED");
    }
    createdId = created.id;
    await applySqlScheduleRackScope(transaction, Number(created.id), payload);
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

  const schedules = await listSchedules(payload.locCode);
  return schedules.find((schedule) => schedule.id === String(createdId))!;
}
export async function updateSchedule(
  scheduleId: number,
  payload: ScheduleMutatePayload,
): Promise<ActiveSchedule> {
  assertValidSchedulePeriod(payload);
  await assertValidCategories(payload);
  const generatedScheduleDesc = scheduleDescription(payload);

  if (env.SQL_MODE === "mock") {
    if (mockScanSubmissions.some((scan) => Number(scan.scheduleId) === scheduleId)) {
      throw new AppError(409, "Schedule sudah memiliki data scan.", "SCHEDULE_HAS_SCANS");
    }
    const schedule = mockSchedules.find((candidate) => Number(candidate.id) === scheduleId);
    if (!schedule || schedule.locCode !== payload.locCode) {
      throw new AppError(404, "Schedule tidak ditemukan.", "SCHEDULE_NOT_FOUND");
    }
    schedule.scheduleDesc = generatedScheduleDesc;
    schedule.scheduleDate = payload.startDate;
    schedule.endDate = payload.endDate;
    schedule.cutOffDate = payload.cutOffDate;
    schedule.startTime = combineDateTime(payload.startDate, payload.startTime);
    schedule.endTime = combineDateTime(payload.endDate, payload.endTime);
    schedule.stockTypeId = stockTypeId(payload.stockType);
    schedule.stockTypeCode = stockTypeCode(payload.stockType);
    schedule.stockTypeName = stockTypeName(payload.stockType);
    schedule.stockTypeValue = payload.stockType;
    schedule.categoryId = categoryValue(payload);
    schedule.status = payload.status;
    await applyMockScheduleRackScope(String(scheduleId), payload);
    const schedules = await listSchedules(payload.locCode);
    return schedules.find((item) => item.id === String(scheduleId))!;
  }

  const pool = await getSqlPool();
  const result = await pool
    .request()
    .input("scheduleId", sql.BigInt, scheduleId)
    .input("locCode", sql.Char(4), payload.locCode)
    .query<{ scan_count: number }>(`
      SELECT COUNT(1) AS scan_count
      FROM dbo.TR_STOCK_TAKE_SCAN
      WHERE SCHEDULE_ID = @scheduleId;

      SELECT TOP (1) CAST(ID AS varchar(30)) AS id
      FROM dbo.TR_STOCK_SCHEDULE
      WHERE ID = @scheduleId AND LOC_CODE = @locCode;
    `);

  const scanCount = result.recordsets[0]?.[0]?.scan_count ?? 0;
  const scheduleExists = (result.recordsets[1]?.length ?? 0) > 0;
  if (!scheduleExists) {
    throw new AppError(404, "Schedule tidak ditemukan.", "SCHEDULE_NOT_FOUND");
  }
  if (scanCount > 0) {
    throw new AppError(409, "Schedule sudah memiliki data scan.", "SCHEDULE_HAS_SCANS");
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    await transaction
      .request()
      .input("scheduleId", sql.BigInt, scheduleId)
      .input("locCode", sql.Char(4), payload.locCode)
      .input("scheduleDesc", sql.NVarChar(250), generatedScheduleDesc)
      .input("scheduleDate", sql.Date, payload.startDate)
      .input("endDate", sql.Date, payload.endDate)
      .input("cutOffDate", sql.Date, payload.cutOffDate)
      .input("startTime", sql.VarChar(19), combineDateTime(payload.startDate, payload.startTime))
      .input("endTime", sql.VarChar(19), combineDateTime(payload.endDate, payload.endTime))
      .input("stockTypeId", sql.SmallInt, stockTypeId(payload.stockType))
      .input("stockTypeValue", sql.VarChar(50), payload.stockType)
      .input("categoryId", sql.VarChar(sql.MAX), categoryValue(payload))
      .input("status", sql.VarChar(20), payload.status)
      .input("username", sql.VarChar(100), payload.username)
      .query(`
        UPDATE dbo.TR_STOCK_SCHEDULE
        SET SCHEDULE_DESC = @scheduleDesc,
            SCHEDULE_DATE = @scheduleDate,
            END_DATE = @endDate,
            CUT_OFF_SOH_DATE = @cutOffDate,
            START_TIME = CASE WHEN @startTime IS NULL THEN NULL ELSE CONVERT(datetime2, @startTime, 126) END,
            END_TIME = CASE WHEN @endTime IS NULL THEN NULL ELSE CONVERT(datetime2, @endTime, 126) END,
            STOCK_TYPE_ID = @stockTypeId,
            STOCK_TYPE_VALUE = @stockTypeValue,
            STATUS = @status,
            CATEGORY_ID = @categoryId,
            USER_MODIFIED = @username,
            DATE_MODIFIED = SYSUTCDATETIME()
        WHERE ID = @scheduleId
          AND LOC_CODE = @locCode;
      `);
    await applySqlScheduleRackScope(transaction, scheduleId, payload);
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

  const schedules = await listSchedules(payload.locCode);
  return schedules.find((schedule) => schedule.id === String(scheduleId))!;
}

export async function closeSchedule(
  scheduleId: number,
  username: string,
): Promise<ActiveSchedule> {
  if (env.SQL_MODE === "mock") {
    const schedule = mockSchedules.find((candidate) => Number(candidate.id) === scheduleId);
    if (!schedule) {
      throw new AppError(404, "Schedule tidak ditemukan.", "SCHEDULE_NOT_FOUND");
    }
    const scopedRacks = mockScheduleRacks.filter(
      (scope) => Number(scope.scheduleId) === scheduleId && scope.status === "ACTIVE",
    );
    if (scopedRacks.length === 0) {
      throw new AppError(409, "Schedule belum memiliki rack scope.", "SCHEDULE_RACK_SCOPE_EMPTY");
    }
    const readyRackCount = scopedRacks.filter((scope) => {
      const activeScans = mockScanSubmissions.filter(
        (scan) =>
          scan.scheduleId === schedule.id &&
          scan.rackId === scope.rackId &&
          scan.scanStatus === "SYNCED",
      );
      return activeScans.length > 0 &&
        activeScans.every((scan) => Boolean(scan.printNo?.trim()) && Boolean(scan.confirmTime));
    }).length;
    if (readyRackCount !== scopedRacks.length) {
      throw new AppError(
        409,
        "Schedule hanya bisa di-close jika semua rack sudah print dan confirm.",
        "SCHEDULE_CLOSE_NOT_READY",
      );
    }
    schedule.status = "CLOSED";
    const schedules = await listSchedules(schedule.locCode);
    return schedules.find((item) => item.id === String(scheduleId))!;
  }

  const pool = await getSqlPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const validation = await transaction
      .request()
      .input("scheduleId", sql.BigInt, scheduleId)
      .query<{
        schedule_id: string | number;
        loc_code: string;
        status: string;
        total_rack: number;
        ready_rack: number;
      }>(`
        ;WITH rack_state AS (
          SELECT
            scope.RACK_ID,
            COUNT(scan.ID) AS submitted_line_count,
            SUM(CASE WHEN NULLIF(LTRIM(RTRIM(scan.PRINT_NO)), '') IS NOT NULL THEN 1 ELSE 0 END) AS printed_line_count,
            SUM(CASE WHEN scan.CONFIRM_TIME IS NOT NULL THEN 1 ELSE 0 END) AS confirmed_line_count
          FROM dbo.TR_STOCK_SCHEDULE_RACK scope
          LEFT JOIN dbo.TR_STOCK_TAKE_SCAN scan
            ON scan.SCHEDULE_ID = scope.SCHEDULE_ID
           AND scan.RACK_ID = scope.RACK_ID
           AND scan.SCAN_STATUS = 'SYNCED'
          WHERE scope.SCHEDULE_ID = @scheduleId
            AND scope.STATUS = 'ACTIVE'
          GROUP BY scope.RACK_ID
        )
        SELECT TOP (1)
          CAST(schedule.ID AS varchar(30)) AS schedule_id,
          schedule.LOC_CODE AS loc_code,
          schedule.STATUS AS status,
          (SELECT COUNT(1) FROM rack_state) AS total_rack,
          (
            SELECT COUNT(1)
            FROM rack_state
            WHERE submitted_line_count > 0
              AND printed_line_count = submitted_line_count
              AND confirmed_line_count = submitted_line_count
          ) AS ready_rack
        FROM dbo.TR_STOCK_SCHEDULE schedule
        WHERE schedule.ID = @scheduleId;
      `);
    const row = validation.recordset[0];
    if (!row) {
      throw new AppError(404, "Schedule tidak ditemukan.", "SCHEDULE_NOT_FOUND");
    }
    if (["CLOSED", "COMPLETED", "CANCELLED"].includes(row.status)) {
      throw new AppError(409, "Schedule sudah close.", "SCHEDULE_ALREADY_CLOSED");
    }
    if (Number(row.total_rack) === 0) {
      throw new AppError(409, "Schedule belum memiliki rack scope.", "SCHEDULE_RACK_SCOPE_EMPTY");
    }
    if (Number(row.ready_rack) !== Number(row.total_rack)) {
      throw new AppError(
        409,
        "Schedule hanya bisa di-close jika semua rack sudah print dan confirm.",
        "SCHEDULE_CLOSE_NOT_READY",
      );
    }

    await transaction
      .request()
      .input("scheduleId", sql.BigInt, scheduleId)
      .input("username", sql.VarChar(100), username)
      .query(`
        UPDATE dbo.TR_STOCK_SCHEDULE
        SET STATUS = 'CLOSED',
            USER_MODIFIED = @username,
            DATE_MODIFIED = SYSUTCDATETIME()
        WHERE ID = @scheduleId;
      `);
    await transaction.commit();
    const schedules = await listSchedules(row.loc_code.trim());
    return schedules.find((schedule) => schedule.id === String(scheduleId))!;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function findScheduleLocation(
  scheduleId: number,
): Promise<ScheduleLocation | null> {
  if (env.SQL_MODE === "mock") {
    const schedule = mockSchedules.find(
      (candidate) => Number(candidate.id) === scheduleId,
    );
    return schedule
      ? {
          id: schedule.id,
          scheduleNo: schedule.scheduleNo,
          locCode: schedule.locCode,
          status: schedule.status,
          stockTypeCode: schedule.stockTypeCode,
          categoryIds: parseCategoryIds(schedule.categoryId),
        }
      : null;
  }

  const pool = await getSqlPool();
  const result = await pool
    .request()
    .input("scheduleId", sql.BigInt, scheduleId)
    .query<{
      id: string | number;
      schedule_no: string;
      loc_code: string;
      status: string;
      stock_type_code: string;
      category_id: string | null;
    }>(`
      SELECT TOP (1)
        CAST(s.ID AS varchar(30)) AS id,
        s.SCHEDULE_NO AS schedule_no,
        s.LOC_CODE AS loc_code,
        s.STATUS AS status,
        st.STOCK_TYPE_CODE AS stock_type_code,
        s.CATEGORY_ID AS category_id
      FROM dbo.TR_STOCK_SCHEDULE s
      INNER JOIN dbo.MST_STOCK_TYPE st ON st.ID = s.STOCK_TYPE_ID
      WHERE s.ID = @scheduleId;
    `);
  const row = result.recordset[0];
  return row
    ? {
        id: String(row.id),
        scheduleNo: row.schedule_no,
        locCode: row.loc_code.trim(),
        status: row.status,
        stockTypeCode: row.stock_type_code,
        categoryIds: parseCategoryIds(row.category_id),
      }
    : null;
}
