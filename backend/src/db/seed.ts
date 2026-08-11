import bcrypt from "bcryptjs";
import sql from "mssql";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { getSqlPool } from "./sql.js";

export interface SeedResult {
  mode: "mock" | "sql";
  config: {
    locCodes: string[];
    password: string;
  };
  inserted: {
    roles: number;
    stockTypes: number;
    users: number;
    racks: number;
    schedules: number;
  };
}

interface CountRow {
  roles_before: number;
  stock_types_before: number;
  users_before: number;
  roles_after: number;
  stock_types_after: number;
  users_after: number;
}

interface DemoUser {
  username: string;
  fullName: string;
  roleId: number;
  locCode: string;
}

function normalizeSeedLocCode(rawLocCode: string): string {
  const trimmed = rawLocCode.trim().toUpperCase();
  if (!trimmed) {
    return "";
  }
  return /^\d+$/.test(trimmed) ? trimmed.padStart(4, "0") : trimmed;
}

function seedLocCodes(): string[] {
  const rawLocCodes = process.env.SEED_LOC_CODES ?? "6168";
  const locCodes = rawLocCodes
    .split(",")
    .map(normalizeSeedLocCode)
    .filter(Boolean);
  return [...new Set(locCodes)].filter((locCode) => /^[A-Z0-9]{4}$/.test(locCode));
}

function seedPassword(): string {
  return process.env.SEED_PASSWORD?.trim() || "prototype";
}

function demoUsersForLocations(locCodes: string[]): DemoUser[] {
  const primaryLocCode = locCodes[0] ?? "6168";
  const users: DemoUser[] = [
    {
      username: "inventory_control01",
      fullName: "Inventory Control Demo",
      roleId: 1,
      locCode: "0000",
    },
    // {
    //   username: "scanner01",
    //   fullName: `Scanner Demo ${primaryLocCode}`,
    //   roleId: 4,
    //   locCode: primaryLocCode,
    // },
    // {
    //   username: "store_manager01",
    //   fullName: `Store Manager Demo ${primaryLocCode}`,
    //   roleId: 2,
    //   locCode: primaryLocCode,
    // },
  ];

  for (const locCode of locCodes) {
    users.push(
      {
        username: `scanner_${locCode}`,
        fullName: `Scanner Demo ${locCode}`,
        roleId: 4,
        locCode,
      },
      {
        username: `store_manager_${locCode}`,
        fullName: `Store Manager Demo ${locCode}`,
        roleId: 2,
        locCode,
      },
      {
        username: `admin_store_${locCode}`,
        fullName: `Admin Store Demo ${locCode}`,
        roleId: 3,
        locCode,
      },
    );
  }

  return [
    ...new Map(users.map((user) => [user.username, user])).values(),
  ];
}

export async function seedEmptyTables(): Promise<SeedResult> {
  const locCodes = seedLocCodes();
  const password = seedPassword();

  if (env.SQL_MODE === "mock") {
    return {
      mode: "mock",
      config: { locCodes, password },
      inserted: {
        roles: 0,
        stockTypes: 0,
        users: 0,
        racks: 0,
        schedules: 0,
      },
    };
  }

  if (locCodes.length === 0) {
    throw new Error("SEED_LOC_CODES tidak valid. Isi kode lokasi 4 karakter, contoh 6168,0023.");
  }

  const pool = await getSqlPool();
  const passwordHash = await bcrypt.hash(password, 12);
  const demoUsers = demoUsersForLocations(locCodes);
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const request = new sql.Request(transaction)
      .input("passwordHash", sql.VarChar(255), passwordHash)
      .input("seedUser", sql.VarChar(100), "backend-seed");

    demoUsers.forEach((user, index) => {
      request.input(`username${index}`, sql.VarChar(100), user.username);
      request.input(`fullName${index}`, sql.NVarChar(150), user.fullName);
      request.input(`roleId${index}`, sql.Int, user.roleId);
      request.input(`locCode${index}`, sql.Char(4), user.locCode);
    });

    const userRows = demoUsers
      .map(
        (_, index) =>
          `(@username${index}, @passwordHash, @fullName${index}, @roleId${index}, @locCode${index}, 'ACTIVE', @seedUser, SYSUTCDATETIME())`,
      )
      .join(",\n          ");

    const result = await request.query<CountRow>(`
      SET NOCOUNT ON;
      SET XACT_ABORT ON;

      DECLARE
        @roles_before int = (SELECT COUNT(*) FROM dbo.MST_ROLE WITH (UPDLOCK, HOLDLOCK)),
        @stock_types_before int = (SELECT COUNT(*) FROM dbo.MST_STOCK_TYPE WITH (UPDLOCK, HOLDLOCK)),
        @users_before int = (SELECT COUNT(*) FROM dbo.MST_USERS WITH (UPDLOCK, HOLDLOCK));

      MERGE dbo.MST_ROLE WITH (HOLDLOCK) AS target
      USING (VALUES
        (1, 'INVENTORY_CONTROL', N'Inventory Control', 'ACTIVE'),
        (2, 'STORE_MANAGER', N'Store Manager', 'ACTIVE'),
        (3, 'ADMIN_STORE', N'Admin Store', 'ACTIVE'),
        (4, 'SCANNER', N'Scanner', 'ACTIVE')
      ) AS source (ID, ROLE_CODE, ROLE_NAME, STATUS)
      ON target.ID = source.ID
      WHEN MATCHED THEN
        UPDATE SET
          ROLE_CODE = source.ROLE_CODE,
          ROLE_NAME = source.ROLE_NAME,
          STATUS = source.STATUS
      WHEN NOT MATCHED THEN
        INSERT (ID, ROLE_CODE, ROLE_NAME, STATUS, DATE_CREATED)
        VALUES (source.ID, source.ROLE_CODE, source.ROLE_NAME, source.STATUS, SYSUTCDATETIME());

      MERGE dbo.MST_STOCK_TYPE WITH (HOLDLOCK) AS target
      USING (VALUES
        (1, 'STOCK_ALL', N'ALL', 'ACTIVE'),
        (2, 'STOCK_PARTIAL', N'PARTIAL', 'ACTIVE')
      ) AS source (ID, STOCK_TYPE_CODE, STOCK_TYPE_NAME, STATUS)
      ON target.ID = source.ID
      WHEN MATCHED THEN
        UPDATE SET
          STOCK_TYPE_CODE = source.STOCK_TYPE_CODE,
          STOCK_TYPE_NAME = source.STOCK_TYPE_NAME,
          STATUS = source.STATUS,
          DATE_MODIFIED = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (ID, STOCK_TYPE_CODE, STOCK_TYPE_NAME, STATUS, DATE_CREATED)
        VALUES (source.ID, source.STOCK_TYPE_CODE, source.STOCK_TYPE_NAME, source.STATUS, SYSUTCDATETIME());

      MERGE dbo.MST_USERS WITH (HOLDLOCK) AS target
      USING (VALUES
          ${userRows}
      ) AS source (USERNAME, PASSWORD_HASH, FULLNAME, ROLE_ID, LOC_CODE, STATUS, USER_CREATED, DATE_CREATED)
      ON target.USERNAME = source.USERNAME
      WHEN MATCHED THEN
        UPDATE SET
          PASSWORD_HASH = source.PASSWORD_HASH,
          FULLNAME = source.FULLNAME,
          ROLE_ID = source.ROLE_ID,
          LOC_CODE = source.LOC_CODE,
          STATUS = source.STATUS,
          USER_MODIFIED = source.USER_CREATED,
          DATE_MODIFIED = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (USERNAME, PASSWORD_HASH, FULLNAME, ROLE_ID, LOC_CODE, STATUS, USER_CREATED, DATE_CREATED)
        VALUES (source.USERNAME, source.PASSWORD_HASH, source.FULLNAME, source.ROLE_ID, source.LOC_CODE, source.STATUS, source.USER_CREATED, source.DATE_CREATED);

      SELECT
        @roles_before AS roles_before,
        @stock_types_before AS stock_types_before,
        @users_before AS users_before,
        (SELECT COUNT(*) FROM dbo.MST_ROLE) AS roles_after,
        (SELECT COUNT(*) FROM dbo.MST_STOCK_TYPE) AS stock_types_after,
        (SELECT COUNT(*) FROM dbo.MST_USERS) AS users_after;
    `);

    await transaction.commit();
    const counts = result.recordset[0];
    if (!counts) {
      throw new Error("Seed SQL tidak mengembalikan hasil count.");
    }

    const seedResult: SeedResult = {
      mode: "sql",
      config: { locCodes, password },
      inserted: {
        roles: counts.roles_after - counts.roles_before,
        stockTypes: counts.stock_types_after - counts.stock_types_before,
        users: counts.users_after - counts.users_before,
        racks: 0,
        schedules: 0,
      },
    };
    logger.info({ seed: seedResult.inserted, locCodes }, "Database seed selesai");
    return seedResult;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
