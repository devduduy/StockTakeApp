import sql from "mssql";
import { env } from "../../config/env.js";
import { getSqlPool } from "../../db/sql.js";
import { listCategoriesByIds } from "../categories/category.repository.js";
import { mockSchedules, mockScanSubmissions } from "../../shared/mock-data.js";
import { parseCategoryIds } from "../../shared/category-filter.js";
import type {
  ActiveSchedule,
  ScheduleLocation,
} from "./schedule.types.js";

interface ScheduleRow {
  id: string | number;
  schedule_no: string;
  schedule_desc: string;
  loc_code: string;
  loc_name: string | null;
  schedule_date: Date | string;
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

async function mapSchedule(row: ScheduleRow): Promise<ActiveSchedule> {
  const categoryIds = parseCategoryIds(row.category_id);
  return {
    id: String(row.id),
    scheduleNo: row.schedule_no,
    scheduleDesc: row.schedule_desc,
    locCode: row.loc_code.trim(),
    location: {
      code: row.loc_code.trim(),
      name: row.loc_name?.trim() || row.loc_code.trim(),
    },
    scheduleDate: isoDate(row.schedule_date),
    startTime: isoDateTime(row.start_time),
    endTime: isoDateTime(row.end_time),
    stockType: {
      id: row.stock_type_id,
      code: row.stock_type_code,
      name: row.stock_type_name,
      value: row.stock_type_value,
    },
    categoryIds,
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
          start_time: schedule.startTime,
          end_time: schedule.endTime,
          stock_type_id: schedule.stockTypeId,
          stock_type_code: schedule.stockTypeCode,
          stock_type_name: schedule.stockTypeName,
          stock_type_value: schedule.stockTypeValue,
          category_id: schedule.categoryId,
          status: schedule.status,
          total_rack: 3,
          submitted_rack_count: new Set(
            mockScanSubmissions
              .filter((scan) => scan.scheduleId === schedule.id)
              .map((scan) => scan.rackId),
          ).size,
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
        FROM dbo.MST_RACK r
        WHERE r.LOC_CODE = s.LOC_CODE
          AND r.STATUS = 'ACTIVE'
      ) AS total_rack,
      (
        SELECT COUNT(DISTINCT scan.RACK_ID)
        FROM dbo.TR_STOCK_TAKE_SCAN scan
        WHERE scan.SCHEDULE_ID = s.ID
          AND scan.SCAN_STATUS = 'SYNCED'
      ) AS submitted_rack_count
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
