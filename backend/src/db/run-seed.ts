import { logger } from "../config/logger.js";
import { closeSqlPool } from "./sql.js";
import { ensureDatabaseSchema } from "./migrate.js";
import { seedEmptyTables } from "./seed.js";

try {
  await ensureDatabaseSchema();
  const result = await seedEmptyTables();
  logger.info({ result }, "Seed command selesai");
} catch (error) {
  logger.error({ err: error }, "Seed command gagal");
  process.exitCode = 1;
} finally {
  await closeSqlPool();
}
