import sql from "mssql";
import { env } from "../../config/env.js";
import { getSqlPool } from "../../db/sql.js";
import { mockUsers } from "../../shared/mock-data.js";
import type { UserRecord } from "./auth.types.js";

interface SqlUserRow {
  id: string | number;
  username: string;
  password_hash: string | null;
  full_name: string;
  role_id: number;
  role_code: string;
  role_name: string;
  loc_code: string;
  status: string;
}

function mapSqlUser(row: SqlUserRow): UserRecord {
  return {
    id: String(row.id),
    username: row.username,
    passwordHash: row.password_hash,
    fullName: row.full_name,
    roleId: row.role_id,
    roleCode: row.role_code,
    roleName: row.role_name,
    locCode: row.loc_code.trim(),
    status: row.status,
  };
}

export async function findActiveUserByUsername(
  username: string,
): Promise<UserRecord | null> {
  if (env.SQL_MODE === "mock") {
    const user = mockUsers.find(
      (candidate) =>
        candidate.username.toLowerCase() === username.toLowerCase() &&
        candidate.status === "ACTIVE",
    );
    return user ?? null;
  }

  const pool = await getSqlPool();
  const result = await pool
    .request()
    .input("username", sql.VarChar(100), username)
    .query<SqlUserRow>(`
      SELECT TOP (1)
        CAST(u.ID AS varchar(30)) AS id,
        u.USERNAME AS username,
        u.PASSWORD_HASH AS password_hash,
        u.FULLNAME AS full_name,
        u.ROLE_ID AS role_id,
        u.LOC_CODE AS loc_code,
        r.ROLE_CODE AS role_code,
        r.ROLE_NAME AS role_name,
        u.STATUS AS status
      FROM dbo.MST_USERS u
      INNER JOIN dbo.MST_ROLE r ON r.ID = u.ROLE_ID
      WHERE u.USERNAME = @username
        AND u.STATUS = 'ACTIVE'
        AND r.STATUS = 'ACTIVE';
    `);
  const row = result.recordset[0];
  return row ? mapSqlUser(row) : null;
}

export async function recordSuccessfulLogin(userId: string): Promise<void> {
  if (env.SQL_MODE === "mock") {
    return;
  }
  const numericId = Number(userId);
  if (!Number.isSafeInteger(numericId)) {
    return;
  }
  const pool = await getSqlPool();
  await pool
    .request()
    .input("userId", sql.BigInt, numericId)
    .query(`
      UPDATE dbo.MST_USERS
      SET LAST_LOGIN_AT = SYSUTCDATETIME(),
          USER_MODIFIED = USERNAME,
          DATE_MODIFIED = SYSUTCDATETIME()
      WHERE ID = @userId;
    `);
}
