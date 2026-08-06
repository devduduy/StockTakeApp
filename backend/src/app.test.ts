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

  it("lets store manager create and update a partial schedule", async () => {
    const loginResponse = await request(app).post("/api/auth/login").send({
      username: "store_manager01",
      password: "prototype",
    });
    expect(loginResponse.status).toBe(200);
    const token = loginResponse.body.data.accessToken as string;

    const locationsResponse = await request(app)
      .get("/api/stock-take/locations")
      .set("authorization", `Bearer ${token}`);
    expect(locationsResponse.status).toBe(200);
    expect(locationsResponse.body.data[0].code).toBe("6168");

    const createResponse = await request(app)
      .post("/api/stock-take/schedules")
      .set("authorization", `Bearer ${token}`)
      .send({
        scheduleDesc: "Stock Take Partial Fresh",
        locCode: "6168",
        startDate: "2026-08-04",
        endDate: "2026-08-05",
        startTime: "08:00",
        endTime: null,
        stockType: "PARTIAL",
        categoryIds: ["40601"],
        status: "OPEN",
      });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data.stockType.name).toBe("PARTIAL");
    expect(createResponse.body.data.categoryIds).toEqual(["40601"]);

    const scheduleId = createResponse.body.data.id as string;
    const updateResponse = await request(app)
      .put(`/api/stock-take/schedules/${scheduleId}`)
      .set("authorization", `Bearer ${token}`)
      .send({
        scheduleDesc: "Stock Take Partial Fresh Updated",
        locCode: "6168",
        startDate: "2026-08-05",
        endDate: "2026-08-05",
        startTime: "09:00",
        endTime: "17:00",
        stockType: "ALL",
        categoryIds: [],
        status: "DRAFT",
      });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.data.scheduleDesc).toBe(
      "Stock Take Partial Fresh Updated",
    );
    expect(updateResponse.body.data.stockType.name).toBe("ALL");
    expect(updateResponse.body.data.categoryIds).toEqual([]);
    expect(updateResponse.body.data.status).toBe("DRAFT");
  });

  it("lets inventory control access every location and create cross-location schedules", async () => {
    const loginResponse = await request(app).post("/api/auth/login").send({
      username: "inventory_control01",
      password: "prototype",
    });
    expect(loginResponse.status).toBe(200);
    const token = loginResponse.body.data.accessToken as string;

    const locationsResponse = await request(app)
      .get("/api/stock-take/locations")
      .set("authorization", `Bearer ${token}`);
    expect(locationsResponse.status).toBe(200);
    expect(locationsResponse.body.data.length).toBeGreaterThan(1);

    const createResponse = await request(app)
      .post("/api/stock-take/schedules")
      .set("authorization", `Bearer ${token}`)
      .send({
        scheduleDesc: "Inventory Control Cross Store",
        locCode: "1001",
        startDate: "2026-08-04",
        endDate: "2026-08-06",
        startTime: "08:00",
        endTime: "17:00",
        stockType: "ALL",
        categoryIds: [],
        status: "OPEN",
      });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data.locCode).toBe("1001");
    expect(createResponse.body.data.endDate).toBe("2026-08-06");
  });

  it("prints submitted rack scans and locks further mobile submissions", async () => {
    const loginResponse = await request(app).post("/api/auth/login").send({
      username: "store_manager01",
      password: "prototype",
    });
    expect(loginResponse.status).toBe(200);
    const token = loginResponse.body.data.accessToken as string;

    const scheduleResponse = await request(app)
      .get("/api/stock-take/schedules?locCode=6168")
      .set("authorization", `Bearer ${token}`);
    expect(scheduleResponse.status).toBe(200);
    const scheduleId = scheduleResponse.body.data[0].id as string;

    const rackResponse = await request(app)
      .get(`/api/stock-take/schedules/${scheduleId}/racks`)
      .set("authorization", `Bearer ${token}`);
    expect(rackResponse.status).toBe(200);
    const rackId = rackResponse.body.data.racks[1].id as string;

    const submitResponse = await request(app)
      .post(`/api/stock-take/schedules/${scheduleId}/racks/${rackId}/scans/submit`)
      .set("authorization", `Bearer ${token}`)
      .send({
        lines: [
          {
            clientScanId: "print-flow-scan-1",
            barcode: "383800000013",
            scanQty: 2,
            inputType: "SCAN",
          },
        ],
      });
    expect(submitResponse.status).toBe(200);

    const printResponse = await request(app)
      .post(`/api/stock-take/schedules/${scheduleId}/racks/${rackId}/print`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(printResponse.status).toBe(200);
    expect(printResponse.body.data.printNo).toMatch(/^PRN-/);
    expect(printResponse.body.data.printedLineCount).toBe(1);
    expect(printResponse.body.data.printedQuantity).toBe(2);

    const scanLinesResponse = await request(app)
      .get(`/api/stock-take/schedules/${scheduleId}/racks/${rackId}/scans`)
      .set("authorization", `Bearer ${token}`);
    expect(scanLinesResponse.status).toBe(200);
    expect(scanLinesResponse.body.data.scans[0].printNo).toBe(
      printResponse.body.data.printNo,
    );

    const reprintResponse = await request(app)
      .post(`/api/stock-take/schedules/${scheduleId}/racks/${rackId}/print`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(reprintResponse.status).toBe(200);
    expect(reprintResponse.body.data.printNo).toBe(
      printResponse.body.data.printNo,
    );
    expect(reprintResponse.body.data.printTime).toEqual(expect.any(String));

    const submitAfterPrintResponse = await request(app)
      .post(`/api/stock-take/schedules/${scheduleId}/racks/${rackId}/scans/submit`)
      .set("authorization", `Bearer ${token}`)
      .send({
        lines: [
          {
            clientScanId: "print-flow-scan-after-print",
            barcode: "8990123456789",
            scanQty: 1,
            inputType: "SCAN",
          },
        ],
      });
    expect(submitAfterPrintResponse.status).toBe(409);
    expect(submitAfterPrintResponse.body.error.code).toBe("RACK_ALREADY_PRINTED");
  });

  it("prevents scanners from managing schedules", async () => {
    const loginResponse = await request(app).post("/api/auth/login").send({
      username: "scanner01",
      password: "prototype",
    });
    const token = loginResponse.body.data.accessToken as string;

    const response = await request(app)
      .post("/api/stock-take/schedules")
      .set("authorization", `Bearer ${token}`)
      .send({
        scheduleDesc: "Unauthorized schedule",
        locCode: "6168",
        startDate: "2026-08-04",
        endDate: "2026-08-04",
        stockType: "ALL",
        categoryIds: [],
        status: "OPEN",
      });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  it("protects stock-take endpoints", async () => {
    const response = await request(app).get(
      "/api/stock-take/schedules/active",
    );
    expect(response.status).toBe(401);
  });
});
