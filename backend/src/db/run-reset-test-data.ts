import { logger } from "../config/logger.js";
import { closeSqlPool } from "./sql.js";
import { resetTestData } from "./reset-test-data.js";

try {
  const result = await resetTestData();
  logger.info({ result }, "Reset test data command selesai");
} catch (error) {
  logger.error({ err: error }, "Reset test data command gagal");
  process.exitCode = 1;
} finally {
  await closeSqlPool();
}
