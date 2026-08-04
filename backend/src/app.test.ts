import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import type express from "express";

process.env.SQL_MODE = "mock";
process.env.NODE_ENV = "test";

let app: express.Express;

beforeAll(async () => {
  const module = await import("./app.js");
  app = module.createApp();
});

describe("Hero Stock Take API (mock mode)", () => {
  it("returns health status", async () => {
    const response = await request(app).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe("ok");
  });

  it("rejects invalid credentials", async () => {
    const response = await request(app).post("/api/auth/login").send({
      username: "scanner01",
      password: "wrong",
    });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("logs in and returns active schedules plus racks", async () => {
    const loginResponse = await request(app).post("/api/auth/login").send({
      username: "scanner01",
      password: "prototype",
    });
    expect(loginResponse.status).toBe(200);
    const token = loginResponse.body.data.accessToken as string;
    expect(token).toBeTruthy();
    expect(loginResponse.body.data.user.locCode).toBe("6168");

    const scheduleResponse = await request(app)
      .get("/api/stock-take/schedules/active?locCode=6168")
      .set("authorization", `Bearer ${token}`);
    expect(scheduleResponse.status).toBe(200);
    expect(scheduleResponse.body.data.length).toBeGreaterThan(0);
    expect(scheduleResponse.body.data[0].locCode).toBe("6168");

    const scheduleId = scheduleResponse.body.data[0].id as string;
    const rackResponse = await request(app)
      .get(`/api/stock-take/schedules/${scheduleId}/racks`)
      .set("authorization", `Bearer ${token}`);
    expect(rackResponse.status).toBe(200);
    expect(rackResponse.body.data.racks.length).toBeGreaterThan(0);

    const itemResponse = await request(app)
      .get(`/api/stock-take/items/lookup?barcode=383800000013&scheduleId=${scheduleId}`)
      .set("authorization", `Bearer ${token}`);
    expect(itemResponse.status).toBe(200);
    expect(itemResponse.body.data.plu).toBeTruthy();

    const rackId = rackResponse.body.data.racks[0].id as string;
    const submitResponse = await request(app)
      .post(`/api/stock-take/schedules/${scheduleId}/racks/${rackId}/scans/submit`)
      .set("authorization", `Bearer ${token}`)
      .send({
        lines: [
          {
            clientScanId: "test-client-scan-1",
            barcode: "383800000013",
            plu: itemResponse.body.data.plu,
            pluDescription: itemResponse.body.data.pluDescription,
            scanQty: 3,
            inputType: "SCAN",
          },
        ],
      });
    expect(submitResponse.status).toBe(200);
    expect(submitResponse.body.data.acceptedLines).toBe(1);
    expect(submitResponse.body.data.submittedQuantity).toBe(3);

    const scanLinesResponse = await request(app)
      .get(`/api/stock-take/schedules/${scheduleId}/racks/${rackId}/scans`)
      .set("authorization", `Bearer ${token}`);
    expect(scanLinesResponse.status).toBe(200);
    expect(scanLinesResponse.body.data.scans.length).toBe(1);
    expect(scanLinesResponse.body.data.scans[0].clientScanId).toBe(
      "test-client-scan-1",
    );
    expect(scanLinesResponse.body.data.scans[0].rackSeq).toBe(1);

    const rackStatsResponse = await request(app)
      .get(`/api/stock-take/schedules/${scheduleId}/racks`)
      .set("authorization", `Bearer ${token}`);
    expect(rackStatsResponse.status).toBe(200);
    expect(rackStatsResponse.body.data.racks[0].submittedLineCount).toBe(1);
    expect(rackStatsResponse.body.data.racks[0].submittedQuantity).toBe(3);

    const mockData = await import("./shared/mock-data.js");
    const submittedScan = mockData.mockScanSubmissions.find(
      (scan) => scan.clientScanId === "test-client-scan-1",
    );
    expect(submittedScan).toBeTruthy();
    if (submittedScan) {
      submittedScan.printNo = "PRINT-001";
    }

    const printedRackResponse = await request(app)
      .get(`/api/stock-take/schedules/${scheduleId}/racks`)
      .set("authorization", `Bearer ${token}`);
    expect(printedRackResponse.status).toBe(200);
    expect(printedRackResponse.body.data.racks[0].printed).toBe(true);

    const submitAfterPrintResponse = await request(app)
      .post(`/api/stock-take/schedules/${scheduleId}/racks/${rackId}/scans/submit`)
      .set("authorization", `Bearer ${token}`)
      .send({
        lines: [
          {
            clientScanId: "test-client-scan-after-print",
            barcode: "8990123456789",
            scanQty: 1,
            inputType: "SCAN",
          },
        ],
      });
    expect(submitAfterPrintResponse.status).toBe(409);
    expect(submitAfterPrintResponse.body.error.code).toBe("RACK_ALREADY_PRINTED");
  });

  it("protects stock-take endpoints", async () => {
    const response = await request(app).get(
      "/api/stock-take/schedules/active",
    );
    expect(response.status).toBe(401);
  });
});
