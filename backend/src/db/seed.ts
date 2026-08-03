import bcrypt from "bcryptjs";
import sql from "mssql";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { getSqlPool } from "./sql.js";

export interface SeedResult {
  mode: "mock" | "sql";
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
  racks_before: number;
  schedules_before: number;
  roles_after: number;
  stock_types_after: number;
  users_after: number;
  racks_after: number;
  schedules_after: number;
}

export async function seedEmptyTables(): Promise<SeedResult> {
  if (env.SQL_MODE === "mock") {
    return {
      mode: "mock",
      inserted: {
        roles: 0,
        stockTypes: 0,
        users: 0,
        racks: 0,
        schedules: 0,
      },
    };
  }

  const pool = await getSqlPool();
  const passwordHash = await bcrypt.hash("prototype", 12);
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const request = new sql.Request(transaction)
      .input("passwordHash", sql.VarChar(255), passwordHash)
      .input("seedUser", sql.VarChar(100), "backend-seed")
      .input("locationCode", sql.Char(4), "6168");

    const result = await request.query<CountRow>(`
      SET NOCOUNT ON;
      SET XACT_ABORT ON;

      DECLARE
        @roles_before int = (SELECT COUNT(*) FROM dbo.MST_ROLE WITH (UPDLOCK, HOLDLOCK)),
        @stock_types_before int = (SELECT COUNT(*) FROM dbo.MST_STOCK_TYPE WITH (UPDLOCK, HOLDLOCK)),
        @users_before int = (SELECT COUNT(*) FROM dbo.MST_USERS WITH (UPDLOCK, HOLDLOCK)),
        @racks_before int = (SELECT COUNT(*) FROM dbo.MST_RACK WITH (UPDLOCK, HOLDLOCK)),
        @schedules_before int = (SELECT COUNT(*) FROM dbo.TR_STOCK_SCHEDULE WITH (UPDLOCK, HOLDLOCK));

      IF @roles_before = 0
      BEGIN
        INSERT INTO dbo.MST_ROLE (ID, ROLE_CODE, ROLE_NAME, STATUS, DATE_CREATED)
        VALUES
          (1, 'INVENTORY_CONTROL', N'Inventory Control', 'ACTIVE', SYSUTCDATETIME()),
          (2, 'STORE_MANAGER', N'Store Manager', 'ACTIVE', SYSUTCDATETIME()),
          (3, 'ADMIN_STORE', N'Admin Store', 'ACTIVE', SYSUTCDATETIME()),
          (4, 'SCANNER', N'Scanner', 'ACTIVE', SYSUTCDATETIME());
      END;

      IF @stock_types_before = 0
      BEGIN
        INSERT INTO dbo.MST_STOCK_TYPE
          (ID, STOCK_TYPE_CODE, STOCK_TYPE_NAME, STATUS, DATE_CREATED)
        VALUES
          (1, 'STOCK_ALL', N'ALL', 'ACTIVE', SYSUTCDATETIME()),
          (2, 'STOCK_PARTIAL', N'PARTIAL', 'ACTIVE', SYSUTCDATETIME());
      END;

      IF @users_before = 0
      BEGIN
        INSERT INTO dbo.MST_USERS
          (USERNAME, PASSWORD_HASH, FULLNAME, ROLE_ID, LOC_CODE, STATUS, USER_CREATED, DATE_CREATED)
        VALUES
          ('scanner01', @passwordHash, N'YUDHA PERMANA', 4, @locationCode, 'ACTIVE', @seedUser, SYSUTCDATETIME()),
          ('store_manager01', @passwordHash, N'Store Manager Demo', 2, @locationCode, 'ACTIVE', @seedUser, SYSUTCDATETIME()),
          ('inventory_control01', @passwordHash, N'Inventory Control Demo', 1, @locationCode, 'ACTIVE', @seedUser, SYSUTCDATETIME());
      END;

      IF @racks_before = 0
      BEGIN
        INSERT INTO dbo.MST_RACK
          (RACK_CODE, RACK_NAME, LOC_CODE, STATUS, USER_CREATED, DATE_CREATED)
        VALUES
          ('RCK-AA-001', N'Rack AA-001', @locationCode, 'ACTIVE', @seedUser, SYSUTCDATETIME()),
          ('RCK-AA-002', N'Rack AA-002', @locationCode, 'ACTIVE', @seedUser, SYSUTCDATETIME()),
          ('RCK-FF-001', N'Rack FF-001', @locationCode, 'ACTIVE', @seedUser, SYSUTCDATETIME()),
          ('RCK-GG-001', N'Rack GG-001', @locationCode, 'ACTIVE', @seedUser, SYSUTCDATETIME());
      END;

      IF @schedules_before = 0
      BEGIN
        INSERT INTO dbo.TR_STOCK_SCHEDULE
          (
            SCHEDULE_NO,
            SCHEDULE_DESC,
            LOC_CODE,
            SCHEDULE_DATE,
            START_TIME,
            END_TIME,
            STOCK_TYPE_ID,
            STOCK_TYPE_VALUE,
            STATUS,
            USER_CREATED,
            DATE_CREATED
          )
        VALUES
          (
            CONCAT('ST-', FORMAT(SYSDATETIME(), 'yyyyMMddHHmmss')),
            N'STOCK TAKE PROTOTYPE - ALL',
            @locationCode,
            CAST(GETDATE() AS date),
            SYSDATETIME(),
            DATEADD(day, 1, SYSDATETIME()),
            1,
            'ALL',
            'OPEN',
            @seedUser,
            SYSUTCDATETIME()
          );
      END;

      SELECT
        @roles_before AS roles_before,
        @stock_types_before AS stock_types_before,
        @users_before AS users_before,
        @racks_before AS racks_before,
        @schedules_before AS schedules_before,
        (SELECT COUNT(*) FROM dbo.MST_ROLE) AS roles_after,
        (SELECT COUNT(*) FROM dbo.MST_STOCK_TYPE) AS stock_types_after,
        (SELECT COUNT(*) FROM dbo.MST_USERS) AS users_after,
        (SELECT COUNT(*) FROM dbo.MST_RACK) AS racks_after,
        (SELECT COUNT(*) FROM dbo.TR_STOCK_SCHEDULE) AS schedules_after;
    `);

    await transaction.commit();
    const counts = result.recordset[0];
    if (!counts) {
      throw new Error("Seed SQL tidak mengembalikan hasil count.");
    }

    const seedResult: SeedResult = {
      mode: "sql",
      inserted: {
        roles: counts.roles_after - counts.roles_before,
        stockTypes: counts.stock_types_after - counts.stock_types_before,
        users: counts.users_after - counts.users_before,
        racks: counts.racks_after - counts.racks_before,
        schedules: counts.schedules_after - counts.schedules_before,
      },
    };
    logger.info({ seed: seedResult.inserted }, "Database seed selesai");
    return seedResult;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

