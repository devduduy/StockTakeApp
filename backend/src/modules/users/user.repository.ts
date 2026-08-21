import bcrypt from "bcryptjs";
import sql from "mssql";
import { env } from "../../config/env.js";
import { getSqlPool } from "../../db/sql.js";
import { mockUsers } from "../../shared/mock-data.js";
import { AppError } from "../../shared/app-error.js";
import type { ManagedUserResponse, RoleResponse, UserMutatePayload } from "./user.types.js";

interface UserRow {
  id: string | number;
  username: string;
  full_name: string;
  role_id: number;
  role_code: string;
  role_name: string;
  loc_code: string;
  status: string;
  last_login_at: Date | string | null;
}

interface RoleRow {
  id: number;
  role_code: string;
  role_name: string;
  status: string;
}

function isoDateTime(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapUser(row: UserRow): ManagedUserResponse {
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
    status: row.status,
    lastLoginAt: isoDateTime(row.last_login_at),
  };
}

function mapRole(row: RoleRow): RoleResponse {
  return {
    id: row.id,
    code: row.role_code,
    name: row.role_name,
    status: row.status,
  };
}

function mockRoleMap(): RoleResponse[] {
  return [
    { id: 1, code: "INVENTORY_CONTROL", name: "Inventory Control", status: "ACTIVE" },
    { id: 2, code: "STORE_MANAGER", name: "Store Manager", status: "ACTIVE" },
    { id: 3, code: "SUPERVISOR", name: "Supervisor", status: "ACTIVE" },
    { id: 4, code: "SCANNER", name: "Scanner", status: "ACTIVE" },
  ];
}

function roleById(roleId: number): RoleResponse | null {
  return mockRoleMap().find((role) => role.id === roleId) ?? null;
}

function roleByCode(roleCode: string): RoleResponse | null {
  return mockRoleMap().find((role) => role.code === roleCode) ?? null;
}

function mapMockUser(user: (typeof mockUsers)[number]): ManagedUserResponse {
  const role = roleById(user.roleId) ?? {
    id: user.roleId,
    code: user.roleCode,
    name: user.roleName,
    status: "ACTIVE",
  };
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: { id: role.id, code: role.code, name: role.name },
    locCode: user.locCode,
    status: user.status,
    lastLoginAt: null,
  };
}

export async function listRoles(): Promise<RoleResponse[]> {
  if (env.SQL_MODE === "mock") return mockRoleMap();

  const pool = await getSqlPool();
  const result = await pool.request().query<RoleRow>(`
    SELECT ID AS id, ROLE_CODE AS role_code, ROLE_NAME AS role_name, STATUS AS status
    FROM dbo.MST_ROLE
    ORDER BY ID;
  `);
  return result.recordset.map(mapRole);
}

export async function findRoleById(roleId: number): Promise<RoleResponse | null> {
  if (env.SQL_MODE === "mock") return roleById(roleId);

  const pool = await getSqlPool();
  const result = await pool
    .request()
    .input("roleId", sql.Int, roleId)
    .query<RoleRow>(`
      SELECT TOP (1) ID AS id, ROLE_CODE AS role_code, ROLE_NAME AS role_name, STATUS AS status
      FROM dbo.MST_ROLE
      WHERE ID = @roleId;
    `);
  return result.recordset[0] ? mapRole(result.recordset[0]) : null;
}

export async function findRoleByCode(roleCode: string): Promise<RoleResponse | null> {
  if (env.SQL_MODE === "mock") return roleByCode(roleCode);

  const pool = await getSqlPool();
  const result = await pool
    .request()
    .input("roleCode", sql.VarChar(50), roleCode)
    .query<RoleRow>(`
      SELECT TOP (1) ID AS id, ROLE_CODE AS role_code, ROLE_NAME AS role_name, STATUS AS status
      FROM dbo.MST_ROLE
      WHERE ROLE_CODE = @roleCode;
    `);
  return result.recordset[0] ? mapRole(result.recordset[0]) : null;
}

export async function listManagedUsers(allowedLocCodes?: string[]): Promise<ManagedUserResponse[]> {
  if (env.SQL_MODE === "mock") {
    const locSet = allowedLocCodes ? new Set(allowedLocCodes) : null;
    return mockUsers
      .map(mapMockUser)
      .filter((user) => !locSet || locSet.has(user.locCode));
  }

  const pool = await getSqlPool();
  const locCodes = allowedLocCodes?.join(",") || null;
  const result = await pool
    .request()
    .input("locCodes", sql.VarChar(sql.MAX), locCodes)
    .query<UserRow>(`
      SELECT
        CAST(u.ID AS varchar(30)) AS id,
        u.USERNAME AS username,
        u.FULLNAME AS full_name,
        u.ROLE_ID AS role_id,
        r.ROLE_CODE AS role_code,
        r.ROLE_NAME AS role_name,
        u.LOC_CODE AS loc_code,
        u.STATUS AS status,
        u.LAST_LOGIN_AT AS last_login_at
      FROM dbo.MST_USERS u
      INNER JOIN dbo.MST_ROLE r ON r.ID = u.ROLE_ID
      WHERE @locCodes IS NULL
         OR u.LOC_CODE COLLATE DATABASE_DEFAULT IN (SELECT value COLLATE DATABASE_DEFAULT FROM STRING_SPLIT(@locCodes, ','))
      ORDER BY u.FULLNAME, u.USERNAME;
    `);
  return result.recordset.map(mapUser);
}

export async function createManagedUser(payload: UserMutatePayload): Promise<ManagedUserResponse> {
  const role = await findRoleById(payload.roleId);
  if (!role || role.status !== "ACTIVE") {
    throw new AppError(400, "Role user tidak valid.", "ROLE_NOT_FOUND");
  }
  if (!payload.password) {
    throw new AppError(400, "Password wajib diisi untuk user baru.", "PASSWORD_REQUIRED");
  }
  const passwordHash = await bcrypt.hash(payload.password, 12);

  if (env.SQL_MODE === "mock") {
    if (mockUsers.some((user) => user.username.toLowerCase() === payload.username.toLowerCase())) {
      throw new AppError(409, "Username sudah digunakan.", "USERNAME_EXISTS");
    }
    const user = {
      id: String(mockUsers.length + 1),
      username: payload.username,
      passwordHash,
      fullName: payload.fullName,
      roleId: role.id,
      roleCode: role.code,
      roleName: role.name,
      locCode: payload.locCode,
      status: payload.status,
    };
    mockUsers.push(user as (typeof mockUsers)[number]);
    return mapMockUser(user);
  }

  const pool = await getSqlPool();
  const existing = await pool
    .request()
    .input("username", sql.VarChar(100), payload.username)
    .query<{ existing_count: number }>(`
      SELECT COUNT(1) AS existing_count
      FROM dbo.MST_USERS
      WHERE USERNAME = @username;
    `);
  if (Number(existing.recordset[0]?.existing_count ?? 0) > 0) {
    throw new AppError(409, "Username sudah digunakan.", "USERNAME_EXISTS");
  }
  const result = await pool
    .request()
    .input("username", sql.VarChar(100), payload.username)
    .input("passwordHash", sql.VarChar(255), passwordHash)
    .input("fullName", sql.NVarChar(150), payload.fullName)
    .input("roleId", sql.Int, payload.roleId)
    .input("locCode", sql.Char(4), payload.locCode)
    .input("status", sql.VarChar(10), payload.status)
    .input("usernameActor", sql.VarChar(100), payload.usernameActor)
    .query<{ id: string | number }>(`
      INSERT INTO dbo.MST_USERS (USERNAME, PASSWORD_HASH, FULLNAME, ROLE_ID, LOC_CODE, STATUS, USER_CREATED, DATE_CREATED)
      OUTPUT INSERTED.ID AS id
      VALUES (@username, @passwordHash, @fullName, @roleId, @locCode, @status, @usernameActor, SYSUTCDATETIME());
    `);
  const id = String(result.recordset[0]?.id);
  return (await listManagedUsers()).find((user) => user.id === id)!;
}

export async function updateManagedUser(userId: number, payload: UserMutatePayload): Promise<ManagedUserResponse> {
  const role = await findRoleById(payload.roleId);
  if (!role || role.status !== "ACTIVE") {
    throw new AppError(400, "Role user tidak valid.", "ROLE_NOT_FOUND");
  }

  if (env.SQL_MODE === "mock") {
    const user = mockUsers.find((candidate) => Number(candidate.id) === userId);
    if (!user) throw new AppError(404, "User tidak ditemukan.", "USER_NOT_FOUND");
    user.username = payload.username;
    user.fullName = payload.fullName;
    user.roleId = role.id;
    user.roleCode = role.code;
    user.roleName = role.name;
    user.locCode = payload.locCode;
    user.status = payload.status;
    if (payload.password) user.passwordHash = await bcrypt.hash(payload.password, 12);
    return mapMockUser(user);
  }

  const passwordHash = payload.password ? await bcrypt.hash(payload.password, 12) : null;
  const pool = await getSqlPool();
  const existing = await pool
    .request()
    .input("userId", sql.BigInt, userId)
    .input("username", sql.VarChar(100), payload.username)
    .query<{ existing_count: number }>(`
      SELECT COUNT(1) AS existing_count
      FROM dbo.MST_USERS
      WHERE USERNAME = @username
        AND ID <> @userId;
    `);
  if (Number(existing.recordset[0]?.existing_count ?? 0) > 0) {
    throw new AppError(409, "Username sudah digunakan.", "USERNAME_EXISTS");
  }
  const result = await pool
    .request()
    .input("userId", sql.BigInt, userId)
    .input("username", sql.VarChar(100), payload.username)
    .input("passwordHash", sql.VarChar(255), passwordHash)
    .input("fullName", sql.NVarChar(150), payload.fullName)
    .input("roleId", sql.Int, payload.roleId)
    .input("locCode", sql.Char(4), payload.locCode)
    .input("status", sql.VarChar(10), payload.status)
    .input("usernameActor", sql.VarChar(100), payload.usernameActor)
    .query<{ affected_count: number }>(`
      UPDATE dbo.MST_USERS
      SET USERNAME = @username,
          FULLNAME = @fullName,
          ROLE_ID = @roleId,
          LOC_CODE = @locCode,
          STATUS = @status,
          PASSWORD_HASH = COALESCE(@passwordHash, PASSWORD_HASH),
          USER_MODIFIED = @usernameActor,
          DATE_MODIFIED = SYSUTCDATETIME()
      WHERE ID = @userId;

      SELECT @@ROWCOUNT AS affected_count;
    `);
  if (Number(result.recordset[0]?.affected_count ?? 0) === 0) {
    throw new AppError(404, "User tidak ditemukan.", "USER_NOT_FOUND");
  }
  return (await listManagedUsers()).find((user) => user.id === String(userId))!;
}
