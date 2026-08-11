import sql from "mssql";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { getSqlPool } from "./sql.js";

export interface ResetTestDataResult {
  mode: "mock" | "sql";
  dryRun: boolean;
  targetDatabase: string;
  deleted: Record<string, number>;
  skippedTables: string[];
}

const RESET_TABLES = [
  "TR_STOCK_TAKE_SCAN",
  "TR_STOCK_SCHEDULE_RACK",
  "MST_SOH",
  "TR_STOCK_SCHEDULE",
  "MST_RACK",
  "MST_USERS",
  "MST_STOCK_TYPE",
  "MST_ROLE",
] as const;

type ResetTableName = (typeof RESET_TABLES)[number];

function requireResetConfirmation(): boolean {
  const confirmReset = process.env.CONFIRM_RESET === "YES";
  const resetScope = process.env.RESET_SCOPE === "ALL";
  const dryRun = process.env.RESET_DRY_RUN !== "NO";

  if (!dryRun && (!confirmReset || !resetScope)) {
    throw new Error(
      "Reset data ditolak. Set CONFIRM_RESET=YES, RESET_SCOPE=ALL, dan RESET_DRY_RUN=NO untuk menjalankan delete.",
    );
  }

  return dryRun;
}

export async function resetTestData(): Promise<ResetTestDataResult> {
  const dryRun = requireResetConfirmation();

  if (env.SQL_MODE === "mock") {
    return {
      mode: "mock",
      dryRun,
      targetDatabase: "mock",
      deleted: {},
      skippedTables: [],
    };
  }

  const pool = await getSqlPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const result = await new sql.Request(transaction).query<{
      table_name: ResetTableName;
      existing_rows: number;
      table_exists: number;
    }>(`
      SET NOCOUNT ON;
      SET XACT_ABORT ON;

      DECLARE @target TABLE (
        table_name sysname NOT NULL,
        delete_order int NOT NULL
      );

      INSERT INTO @target (table_name, delete_order)
      VALUES
        ('TR_STOCK_TAKE_SCAN', 10),
        ('TR_STOCK_SCHEDULE_RACK', 20),
        ('MST_SOH', 30),
        ('TR_STOCK_SCHEDULE', 40),
        ('MST_RACK', 50),
        ('MST_USERS', 60),
        ('MST_STOCK_TYPE', 70),
        ('MST_ROLE', 80);

      SELECT
        target.table_name,
        CASE WHEN tables.object_id IS NULL THEN 0 ELSE 1 END AS table_exists,
        CASE
          WHEN tables.object_id IS NULL THEN 0
          ELSE SUM(partitions.rows)
        END AS existing_rows
      FROM @target target
      LEFT JOIN sys.tables tables
        ON tables.name = target.table_name
       AND SCHEMA_NAME(tables.schema_id) = 'dbo'
      LEFT JOIN sys.partitions partitions
        ON partitions.object_id = tables.object_id
       AND partitions.index_id IN (0, 1)
      GROUP BY target.table_name, target.delete_order, tables.object_id
      ORDER BY target.delete_order;
    `);

    const counts = result.recordset;
    if (dryRun) {
      await transaction.rollback();
      const summary = buildResetSummary(counts, true);
      logger.warn(
        { result: summary },
        "Dry run reset data selesai. Tidak ada data yang dihapus.",
      );
      return summary;
    }

    for (const table of RESET_TABLES) {
      await new sql.Request(transaction).query(`
        IF OBJECT_ID('dbo.${table}', 'U') IS NOT NULL
        BEGIN
          DELETE FROM dbo.${table};

          IF COLUMNPROPERTY(OBJECT_ID('dbo.${table}'), 'ID', 'IsIdentity') = 1
          BEGIN
            DBCC CHECKIDENT ('dbo.${table}', RESEED, 0) WITH NO_INFOMSGS;
          END;
        END;
      `);
    }

    await transaction.commit();
    const summary = buildResetSummary(counts, false);
    logger.warn({ result: summary }, "Reset data testing selesai.");
    return summary;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

function buildResetSummary(
  rows: Array<{ table_name: ResetTableName; existing_rows: number; table_exists: number }>,
  dryRun: boolean,
): ResetTestDataResult {
  const deleted: Record<string, number> = {};
  const skippedTables: string[] = [];

  for (const table of RESET_TABLES) {
    const row = rows.find((candidate) => candidate.table_name === table);
    if (!row || row.table_exists !== 1) {
      skippedTables.push(`dbo.${table}`);
      continue;
    }
    deleted[`dbo.${table}`] = Number(row.existing_rows ?? 0);
  }

  return {
    mode: "sql",
    dryRun,
    targetDatabase: env.SQL_DATABASE ?? "-",
    deleted,
    skippedTables,
  };
}
