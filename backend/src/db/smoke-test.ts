import request from "supertest";
import { createApp } from "../app.js";
import { env } from "../config/env.js";
import { closeSqlPool } from "./sql.js";

function assertStatus(
  actual: number,
  expected: number,
  operation: string,
): void {
  if (actual !== expected) {
    throw new Error(
      `${operation} gagal: expected HTTP ${expected}, received ${actual}.`,
    );
  }
}

async function main(): Promise<void> {
  if (env.SQL_MODE !== "sql") {
    throw new Error("Smoke test wajib dijalankan dengan SQL_MODE=sql.");
  }

  const app = createApp();

  const health = await request(app).get(`${env.API_PREFIX}/health`);
  assertStatus(health.status, 200, "Health check");

  const login = await request(app)
    .post(`${env.API_PREFIX}/auth/login`)
    .send({ username: "scanner01", password: "prototype" });
  assertStatus(login.status, 200, "Login");

  const accessToken = login.body.data.accessToken as string;
  const schedules = await request(app)
    .get(`${env.API_PREFIX}/stock-take/schedules/active`)
    .query({ locCode: "6168" })
    .set("authorization", `Bearer ${accessToken}`);
  assertStatus(schedules.status, 200, "Active schedule");

  const scheduleId = schedules.body.data[0]?.id as string | undefined;
  if (!scheduleId) {
    throw new Error("Active schedule untuk lokasi 6168 tidak ditemukan.");
  }

  const racks = await request(app)
    .get(`${env.API_PREFIX}/stock-take/schedules/${scheduleId}/racks`)
    .set("authorization", `Bearer ${accessToken}`);
  assertStatus(racks.status, 200, "Rack list");

  const categories = await request(app)
    .get(`${env.API_PREFIX}/stock-take/categories`)
    .set("authorization", `Bearer ${accessToken}`);
  assertStatus(categories.status, 200, "Category list");

  const item = await request(app)
    .get(`${env.API_PREFIX}/stock-take/items/lookup`)
    .query({ barcode: "383800000013", scheduleId })
    .set("authorization", `Bearer ${accessToken}`);
  assertStatus(item.status, 200, "Item lookup");

  process.stdout.write(
    `${JSON.stringify({
      health: health.body.data.status,
      mode: health.body.data.mode,
      loginUser: login.body.data.user.username,
      loginLocCode: login.body.data.user.locCode,
      role: login.body.data.user.role.code,
      activeScheduleCount: schedules.body.data.length,
      scheduleId,
      rackCount: racks.body.data.racks.length,
      categoryCount: categories.body.data.length,
      itemLookupSource: item.body.data.source,
      itemCategory: item.body.data.category,
    })}\n`,
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeSqlPool();
  });
