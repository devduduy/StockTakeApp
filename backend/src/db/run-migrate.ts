import { logger } from "../config/logger.js";
import { closeSqlPool } from "./sql.js";
import { ensureDatabaseSchema } from "./migrate.js";

try {
  const result = await ensureDatabaseSchema();
  logger.info({ result }, "Migration command selesai");
} catch (error) {
  logger.error({ err: error }, "Migration command gagal");
  process.exitCode = 1;
} finally {
  await closeSqlPool();
}
