import { createServer } from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { ensureDatabaseSchema } from "./db/migrate.js";
import { seedEmptyTables } from "./db/seed.js";
import { closeSqlPool, getSqlPool } from "./db/sql.js";

async function bootstrap(): Promise<void> {
  if (env.SQL_MODE === "sql") {
    await getSqlPool();
    logger.info(
      { database: env.SQL_DATABASE, server: env.SQL_SERVER },
      "SQL Server connected",
    );
    await ensureDatabaseSchema();
    if (env.DB_SEED_ON_START) {
      await seedEmptyTables();
    }
  }

  const server = createServer(createApp());
  server.listen(env.PORT, env.HOST, () => {
    logger.info(
      {
        host: env.HOST,
        port: env.PORT,
        mode: env.SQL_MODE,
      },
      "Hero Stock Take API listening",
    );
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Shutting down");
    server.close(async () => {
      await closeSqlPool();
      process.exit(0);
    });
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

bootstrap().catch(async (error) => {
  logger.fatal({ err: error }, "Backend gagal dijalankan");
  await closeSqlPool();
  process.exit(1);
});
