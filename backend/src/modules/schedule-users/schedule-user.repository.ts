import sql from "mssql";
import { env } from "../../config/env.js";
import { getSqlPool } from "../../db/sql.js";
import { AppError } from "../../shared/app-error.js";
import { mockScheduleUsers, mockUsers } from "../../shared/mock-data.js";
import { findScheduleLocation } from "../schedules/schedule.repository.js";
import type { ScheduleUserResponse } from "./schedule-user.types.js";

interface ScheduleUserRow {
  id: string | number;
  username: string;
  full_name: string;
  role_id: number;
  role_code: string;
  role_name: string;
  loc_code: string;
  assigned: number | boolean;
  assignment_type: "LOCATION" | "MANUAL" | "NONE";
  locked: number | boolean;
}

function uniqueUserIds(userIds: Array<string | number>): string[] {
  return [...new Set(
    userIds
      .map((userId) => String(userId).trim())
      .filter((userId) => /^\d+$/.test(userId)),
  )];
}

function mapScheduleUser(row: ScheduleUserRow): ScheduleUserResponse {
  return {
    id: String(row.id),
    username: row.username,
    fullName: row.full_name,
    role: {
      id: row.role_id,
      code: row.role_code,
      name: row.role_name,
    },
    locCode: row.loc_code.trim(),
    assigned: row.assigned === true || row.assigned === 1,
    assignmentType: row.assignment_type,
    locked: row.locked === true || row.locked === 1,
  };
}

function mapMockScheduleUser(
  user: (typeof mockUsers)[number],
  assigned: boolean,
  assignmentType: ScheduleUserResponse["assignmentType"],
): ScheduleUserResponse {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: {
      id: user.roleId,
      code: user.roleCode,
      name: user.roleName,
    },
    locCode: user.locCode,
    assigned,
    assignmentType,
    locked: assignmentType === "LOCATION",
  };
}

async function getScheduleLocCode(scheduleId: number): Promise<string> {
  const schedule = await findScheduleLocation(scheduleId);
  if (!schedule) {
    throw new AppError(404, "Schedule tidak ditemukan.", "SCHEDULE_NOT_FOUND");
  }
  return schedule.locCode;
}

export async function listScheduleUsers(scheduleId: number): Promise<ScheduleUserResponse[]> {
  const scheduleLocCode = await getScheduleLocCode(scheduleId);

  if (env.SQL_MODE === "mock") {
    const assignedIds = new Set(
      mockScheduleUsers
        .filter((item) => Number(item.scheduleId) === scheduleId && item.status === "ACTIVE")
        .map((item) => item.userId),
    );
    return mockUsers
      .filter((user) => user.status === "ACTIVE" && (user.locCode === scheduleLocCode || assignedIds.has(user.id)))
      .map((user) => mapMockScheduleUser(
        user,
        true,
        user.locCode === scheduleLocCode ? "LOCATION" : "MANUAL",
      ))
      .sort((left, right) => left.fullName.localeCompare(right.fullName));
  }

  const pool = await getSqlPool();
  const result = await pool
    .request()
    .input("scheduleId", sql.BigInt, scheduleId)
    .query<ScheduleUserRow>(`
      SELECT
        CAST(u.ID AS varchar(30)) AS id,
        u.USERNAME AS username,
        u.FULLNAME AS full_name,
        u.ROLE_ID AS role_id,
        role.ROLE_CODE AS role_code,
        role.ROLE_NAME AS role_name,
        u.LOC_CODE AS loc_code,
        CAST(1 AS bit) AS assigned,
        CASE
          WHEN u.LOC_CODE = schedule.LOC_CODE THEN 'LOCATION'
          ELSE 'MANUAL'
        END AS assignment_type,
        CASE WHEN u.LOC_CODE = schedule.LOC_CODE THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS locked
      FROM dbo.TR_STOCK_SCHEDULE schedule
      INNER JOIN dbo.MST_USERS u
        ON u.LOC_CODE = schedule.LOC_CODE
        OR EXISTS (
          SELECT 1
          FROM dbo.TR_STOCK_SCHEDULE_USER team
          WHERE team.SCHEDULE_ID = schedule.ID
            AND team.USER_ID = u.ID
            AND team.STATUS = 'ACTIVE'
        )
      INNER JOIN dbo.MST_ROLE role ON role.ID = u.ROLE_ID
      WHERE schedule.ID = @scheduleId
        AND u.STATUS = 'ACTIVE'
        AND role.STATUS = 'ACTIVE'
      ORDER BY u.FULLNAME, u.USERNAME;
    `);
  return result.recordset.map(mapScheduleUser);
}

export async function listScheduleUserCandidates(scheduleId: number): Promise<ScheduleUserResponse[]> {
  const scheduleLocCode = await getScheduleLocCode(scheduleId);

  if (env.SQL_MODE === "mock") {
    const assignedIds = new Set(
      mockScheduleUsers
        .filter((item) => Number(item.scheduleId) === scheduleId && item.status === "ACTIVE")
        .map((item) => item.userId),
    );
    return mockUsers
      .filter((user) => user.status === "ACTIVE")
      .map((user) => {
        const isDefaultLocation = user.locCode === scheduleLocCode;
        return mapMockScheduleUser(
          user,
          isDefaultLocation || assignedIds.has(user.id),
          isDefaultLocation ? "LOCATION" : assignedIds.has(user.id) ? "MANUAL" : "NONE",
        );
      })
      .sort((left, right) => left.fullName.localeCompare(right.fullName));
  }

  const pool = await getSqlPool();
  const result = await pool
    .request()
    .input("scheduleId", sql.BigInt, scheduleId)
    .query<ScheduleUserRow>(`
      SELECT
        CAST(u.ID AS varchar(30)) AS id,
        u.USERNAME AS username,
        u.FULLNAME AS full_name,
        u.ROLE_ID AS role_id,
        role.ROLE_CODE AS role_code,
        role.ROLE_NAME AS role_name,
        u.LOC_CODE AS loc_code,
        CASE WHEN u.LOC_CODE = schedule.LOC_CODE OR EXISTS (
          SELECT 1
          FROM dbo.TR_STOCK_SCHEDULE_USER team
          WHERE team.SCHEDULE_ID = @scheduleId
            AND team.USER_ID = u.ID
            AND team.STATUS = 'ACTIVE'
        ) THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS assigned,
        CASE
          WHEN u.LOC_CODE = schedule.LOC_CODE THEN 'LOCATION'
          WHEN EXISTS (
            SELECT 1
            FROM dbo.TR_STOCK_SCHEDULE_USER team
            WHERE team.SCHEDULE_ID = @scheduleId
              AND team.USER_ID = u.ID
              AND team.STATUS = 'ACTIVE'
          ) THEN 'MANUAL'
          ELSE 'NONE'
        END AS assignment_type,
        CASE WHEN u.LOC_CODE = schedule.LOC_CODE THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS locked
      FROM dbo.MST_USERS u
      INNER JOIN dbo.MST_ROLE role ON role.ID = u.ROLE_ID
      CROSS JOIN dbo.TR_STOCK_SCHEDULE schedule
      WHERE u.STATUS = 'ACTIVE'
        AND role.STATUS = 'ACTIVE'
        AND schedule.ID = @scheduleId
        AND (u.LOC_CODE = schedule.LOC_CODE OR role.ROLE_CODE = 'SCANNER')

      ORDER BY role.ID, u.FULLNAME, u.USERNAME;
    `);
  return result.recordset.map(mapScheduleUser);
}

export async function replaceScheduleUsers(
  scheduleId: number,
  userIds: Array<string | number>,
  usernameActor: string,
): Promise<ScheduleUserResponse[]> {
  const scheduleLocCode = await getScheduleLocCode(scheduleId);
  const selectedUserIds = uniqueUserIds(userIds);

  if (env.SQL_MODE === "mock") {
    const validUserIds = new Set(mockUsers.filter((user) => user.status === "ACTIVE").map((user) => user.id));
    const invalidUserId = selectedUserIds.find((userId) => !validUserIds.has(userId));
    if (invalidUserId) {
      throw new AppError(400, `User ${invalidUserId} tidak aktif atau tidak ditemukan.`, "SCHEDULE_USER_INVALID");
    }
    const extraUserIds = selectedUserIds.filter((userId) => {
      const user = mockUsers.find((candidate) => candidate.id === userId);
      return user && user.locCode !== scheduleLocCode;
    });
    for (const item of mockScheduleUsers.filter((team) => Number(team.scheduleId) === scheduleId)) {
      item.status = extraUserIds.includes(item.userId) ? "ACTIVE" : "INACTIVE";
      item.userModified = usernameActor;
      item.dateModified = new Date().toISOString();
    }
    for (const userId of extraUserIds) {
      const existing = mockScheduleUsers.find(
        (team) => Number(team.scheduleId) === scheduleId && team.userId === userId,
      );
      if (existing) {
        existing.status = "ACTIVE";
        existing.userModified = usernameActor;
        existing.dateModified = new Date().toISOString();
      } else {
        mockScheduleUsers.push({
          scheduleId: String(scheduleId),
          userId,
          status: "ACTIVE",
          userCreated: usernameActor,
          dateCreated: new Date().toISOString(),
        });
      }
    }
    return listScheduleUsers(scheduleId);
  }

  const pool = await getSqlPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const userCsv = selectedUserIds.join(",");
    const validation = await new sql.Request(transaction)
      .input("userCsv", sql.VarChar(sql.MAX), userCsv)
      .query<{ valid_user_count: number }>(`
        SELECT COUNT(DISTINCT u.ID) AS valid_user_count
        FROM dbo.MST_USERS u
        INNER JOIN dbo.MST_ROLE role ON role.ID = u.ROLE_ID
        INNER JOIN STRING_SPLIT(@userCsv, ',') selected
          ON TRY_CONVERT(bigint, selected.value) = u.ID
        WHERE u.STATUS = 'ACTIVE'
          AND role.STATUS = 'ACTIVE';
      `);
    if (Number(validation.recordset[0]?.valid_user_count ?? 0) !== selectedUserIds.length) {
      throw new AppError(400, "Ada user yang tidak aktif atau tidak ditemukan.", "SCHEDULE_USER_INVALID");
    }

    await new sql.Request(transaction)
      .input("scheduleId", sql.BigInt, scheduleId)
      .input("userCsv", sql.VarChar(sql.MAX), userCsv)
      .input("username", sql.VarChar(100), usernameActor)
      .query(`
        UPDATE dbo.TR_STOCK_SCHEDULE_USER
        SET STATUS = 'INACTIVE',
            USER_MODIFIED = @username,
            DATE_MODIFIED = SYSUTCDATETIME()
        WHERE SCHEDULE_ID = @scheduleId
          AND USER_ID NOT IN (
            SELECT u.ID
            FROM dbo.MST_USERS u
            INNER JOIN dbo.TR_STOCK_SCHEDULE schedule ON schedule.ID = @scheduleId
            INNER JOIN STRING_SPLIT(@userCsv, ',') selected
              ON TRY_CONVERT(bigint, selected.value) = u.ID
            WHERE u.LOC_CODE <> schedule.LOC_CODE
          ));

        MERGE dbo.TR_STOCK_SCHEDULE_USER WITH (HOLDLOCK) AS target
        USING (
          SELECT DISTINCT u.ID AS USER_ID
          FROM STRING_SPLIT(@userCsv, ',')
          INNER JOIN dbo.MST_USERS u
            ON u.ID = TRY_CONVERT(bigint, value)
          INNER JOIN dbo.TR_STOCK_SCHEDULE schedule
            ON schedule.ID = @scheduleId
          WHERE u.LOC_CODE <> schedule.LOC_CODE
        ) AS source
          ON target.SCHEDULE_ID = @scheduleId
         AND target.USER_ID = source.USER_ID
        WHEN MATCHED THEN
          UPDATE SET
            STATUS = 'ACTIVE',
            USER_MODIFIED = @username,
            DATE_MODIFIED = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN
          INSERT (SCHEDULE_ID, USER_ID, STATUS, USER_CREATED)
          VALUES (@scheduleId, source.USER_ID, 'ACTIVE', @username);
      `);
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

  return listScheduleUsers(scheduleId);
}

export async function isUserAssignedToSchedule(
  scheduleId: number,
  userId?: string,
  username?: string,
): Promise<boolean> {
  if (!userId && !username) return false;

  if (env.SQL_MODE === "mock") {
    const resolvedUser = mockUsers.find(
      (user) => (userId && user.id === userId) || (username && user.username === username),
    );
    if (!resolvedUser) return false;
    return mockScheduleUsers.some(
      (item) => Number(item.scheduleId) === scheduleId && item.userId === resolvedUser.id && item.status === "ACTIVE",
    );
  }

  const pool = await getSqlPool();
  const request = pool
    .request()
    .input("scheduleId", sql.BigInt, scheduleId)
    .input("userId", sql.BigInt, userId && /^\d+$/.test(userId) ? Number(userId) : null)
    .input("username", sql.VarChar(100), username ?? null);
  const result = await request.query<{ assigned_count: number }>(`
    SELECT COUNT(1) AS assigned_count
    FROM dbo.TR_STOCK_SCHEDULE_USER team
    INNER JOIN dbo.MST_USERS u ON u.ID = team.USER_ID
    WHERE team.SCHEDULE_ID = @scheduleId
      AND team.STATUS = 'ACTIVE'
      AND u.STATUS = 'ACTIVE'
      AND (
        (@userId IS NOT NULL AND u.ID = @userId)
        OR (@username IS NOT NULL AND u.USERNAME = @username)
      );
  `);
  return Number(result.recordset[0]?.assigned_count ?? 0) > 0;
}

export async function listAssignedScheduleIdsForUser(
  userId?: string,
  username?: string,
): Promise<number[]> {
  if (!userId && !username) return [];

  if (env.SQL_MODE === "mock") {
    const resolvedUser = mockUsers.find(
      (user) => (userId && user.id === userId) || (username && user.username === username),
    );
    if (!resolvedUser) return [];
    return [
      ...new Set(
        mockScheduleUsers
          .filter((item) => item.userId === resolvedUser.id && item.status === "ACTIVE")
          .map((item) => Number(item.scheduleId))
          .filter(Number.isSafeInteger),
      ),
    ];
  }

  const pool = await getSqlPool();
  const result = await pool
    .request()
    .input("userId", sql.BigInt, userId && /^\d+$/.test(userId) ? Number(userId) : null)
    .input("username", sql.VarChar(100), username ?? null)
    .query<{ schedule_id: string | number }>(`
      SELECT DISTINCT team.SCHEDULE_ID AS schedule_id
      FROM dbo.TR_STOCK_SCHEDULE_USER team
      INNER JOIN dbo.MST_USERS u ON u.ID = team.USER_ID
      WHERE team.STATUS = 'ACTIVE'
        AND u.STATUS = 'ACTIVE'
        AND (
          (@userId IS NOT NULL AND u.ID = @userId)
          OR (@username IS NOT NULL AND u.USERNAME = @username)
        );
    `);
  return result.recordset
    .map((row) => Number(row.schedule_id))
    .filter(Number.isSafeInteger);
}
