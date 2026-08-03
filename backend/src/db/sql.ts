import sql from "mssql";
import { env } from "../config/env.js";

let poolPromise: Promise<sql.ConnectionPool> | undefined;

function createPool(): sql.ConnectionPool {
  if (
    !env.SQL_SERVER ||
    !env.SQL_DATABASE ||
    !env.SQL_USER ||
    !env.SQL_PASSWORD
  ) {
    throw new Error("Konfigurasi SQL Server belum lengkap.");
  }

  return new sql.ConnectionPool({
    server: env.SQL_SERVER,
    port: env.SQL_PORT,
    database: env.SQL_DATABASE,
    user: env.SQL_USER,
    password: env.SQL_PASSWORD,
    connectionTimeout: env.SQL_CONNECTION_TIMEOUT_MS,
    requestTimeout: env.SQL_REQUEST_TIMEOUT_MS,
    pool: {
      min: 0,
      max: 10,
      idleTimeoutMillis: 30_000,
    },
    options: {
      appName: "Hero Stock Take API",
      encrypt: env.SQL_ENCRYPT,
      trustServerCertificate: env.SQL_TRUST_SERVER_CERTIFICATE,
      enableArithAbort: true,
    },
  });
}

export async function getSqlPool(): Promise<sql.ConnectionPool> {
  if (env.SQL_MODE !== "sql") {
    throw new Error("SQL pool dipanggil ketika SQL_MODE bukan sql.");
  }
  poolPromise ??= createPool().connect();
  return poolPromise;
}

export async function closeSqlPool(): Promise<void> {
  if (!poolPromise) {
    return;
  }
  const pool = await poolPromise;
  poolPromise = undefined;
  await pool.close();
}

