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
        cutOffDate: "2026-08-04",
        startTime: "08:00",
        endTime: null,
        stockType: "PARTIAL",
        categoryIds: ["40601"],
        rackIds: ["1", "2"],
        status: "OPEN",
      });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data.stockType.name).toBe("PARTIAL");
    expect(createResponse.body.data.scheduleDesc).toBe("STOCK TAKE 6168 PARTIAL 2026-08-04");
    expect(createResponse.body.data.categoryIds).toEqual(["40601"]);
    expect(createResponse.body.data.rackIds).toEqual(["1", "2"]);

    const scheduleId = createResponse.body.data.id as string;
    const updateResponse = await request(app)
      .put(`/api/stock-take/schedules/${scheduleId}`)
      .set("authorization", `Bearer ${token}`)
      .send({
        scheduleDesc: "Stock Take Partial Fresh Updated",
        locCode: "6168",
        startDate: "2026-08-05",
        endDate: "2026-08-05",
        cutOffDate: "2026-08-05",
        startTime: "09:00",
        endTime: "17:00",
        stockType: "ALL",
        categoryIds: [],
        rackIds: [],
        status: "DRAFT",
      });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.data.scheduleDesc).toBe("STOCK TAKE 6168 ALL 2026-08-05");
    expect(updateResponse.body.data.stockType.name).toBe("ALL");
    expect(updateResponse.body.data.categoryIds).toEqual([]);
    expect(updateResponse.body.data.status).toBe("DRAFT");
  });

  it("rejects schedule creation when the selected location has no active rack", async () => {
    const loginResponse = await request(app).post("/api/auth/login").send({
      username: "inventory_control01",
      password: "prototype",
    });
    expect(loginResponse.status).toBe(200);
    const token = loginResponse.body.data.accessToken as string;

    const createResponse = await request(app)
      .post("/api/stock-take/schedules")
      .set("authorization", `Bearer ${token}`)
      .send({
        scheduleDesc: "Schedule Without Rack",
        locCode: "1001",
        startDate: "2026-08-07",
        endDate: "2026-08-07",
        cutOffDate: "2026-08-07",
        startTime: "08:00",
        endTime: "17:00",
        stockType: "ALL",
        categoryIds: [],
        status: "OPEN",
      });
    expect(createResponse.status).toBe(400);
    expect(createResponse.body.error.code).toBe("RACK_SCOPE_REQUIRED");
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

    const rackResponse = await request(app)
      .post("/api/stock-take/racks")
      .set("authorization", `Bearer ${token}`)
      .send({
        locCode: "1001",
        rackCode: "RCK-II-901",
        rackName: "Rack Inventory Control Test",
        status: "ACTIVE",
      });
    expect(rackResponse.status).toBe(201);

    const createResponse = await request(app)
      .post("/api/stock-take/schedules")
      .set("authorization", `Bearer ${token}`)
      .send({
        scheduleDesc: "Inventory Control Cross Store",
        locCode: "1001",
        startDate: "2026-08-04",
        endDate: "2026-08-06",
        cutOffDate: "2026-08-03",
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

  it("lets store manager manage users only for their base location", async () => {
    const loginResponse = await request(app).post("/api/auth/login").send({
      username: "store_manager01",
      password: "prototype",
    });
    const token = loginResponse.body.data.accessToken as string;

    const createResponse = await request(app)
      .post("/api/stock-take/users")
      .set("authorization", `Bearer ${token}`)
      .send({
        username: "scanner_store_6168",
        fullName: "Scanner Store 6168",
        password: "prototype",
        roleId: 4,
        locCode: "6168",
        status: "ACTIVE",
      });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data.locCode).toBe("6168");

    const forbiddenResponse = await request(app)
      .post("/api/stock-take/users")
      .set("authorization", `Bearer ${token}`)
      .send({
        username: "scanner_forbidden_1001",
        fullName: "Scanner Forbidden 1001",
        password: "prototype",
        roleId: 4,
        locCode: "1001",
        status: "ACTIVE",
      });
    expect(forbiddenResponse.status).toBe(403);
    expect(forbiddenResponse.body.error.code).toBe("LOCATION_FORBIDDEN");
  });

  it("does not expose other store schedules through user master location alone", async () => {
    const loginResponse = await request(app).post("/api/auth/login").send({
      username: "inventory_control01",
      password: "prototype",
    });
    const token = loginResponse.body.data.accessToken as string;

    const createResponse = await request(app)
      .post("/api/stock-take/users")
      .set("authorization", `Bearer ${token}`)
      .send({
        username: "scanner_helper_1001",
        fullName: "Scanner Helper 1001",
        password: "prototype",
        roleId: 4,
        locCode: "1001",
        status: "ACTIVE",
      });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data.locCode).toBe("1001");

    const helperLoginResponse = await request(app).post("/api/auth/login").send({
      username: "scanner_helper_1001",
      password: "prototype",
    });
    expect(helperLoginResponse.status).toBe(200);
    expect(helperLoginResponse.body.data.user.locCode).toBe("1001");
    expect(helperLoginResponse.body.data.user.accessibleLocCodes).toEqual(["1001"]);
    const helperToken = helperLoginResponse.body.data.accessToken as string;

    const scheduleResponse = await request(app)
      .get("/api/stock-take/schedules/active")
      .set("authorization", `Bearer ${helperToken}`);
    expect(scheduleResponse.status).toBe(200);
    expect(scheduleResponse.body.data.some((schedule: { locCode: string }) => schedule.locCode === "6168")).toBe(false);
  });

  it("allows schedule team assignment without changing helper base location", async () => {
    const inventoryLoginResponse = await request(app).post("/api/auth/login").send({
      username: "inventory_control01",
      password: "prototype",
    });
    const inventoryToken = inventoryLoginResponse.body.data.accessToken as string;

    const helperResponse = await request(app)
      .post("/api/stock-take/users")
      .set("authorization", `Bearer ${inventoryToken}`)
      .send({
        username: "scanner_schedule_team_1001",
        fullName: "Scanner Schedule Team 1001",
        password: "prototype",
        roleId: 4,
        locCode: "1001",
        status: "ACTIVE",
      });
    expect(helperResponse.status).toBe(201);
    expect(helperResponse.body.data.locCode).toBe("1001");

    const managerLoginResponse = await request(app).post("/api/auth/login").send({
      username: "store_manager01",
      password: "prototype",
    });
    const managerToken = managerLoginResponse.body.data.accessToken as string;

    const scheduleResponse = await request(app)
      .get("/api/stock-take/schedules/active?locCode=6168")
      .set("authorization", `Bearer ${managerToken}`);
    expect(scheduleResponse.status).toBe(200);
    const scheduleId = scheduleResponse.body.data[0].id as string;

    const teamResponse = await request(app)
      .put(`/api/stock-take/schedules/${scheduleId}/users`)
      .set("authorization", `Bearer ${managerToken}`)
      .send({ userIds: [helperResponse.body.data.id] });
    expect(teamResponse.status).toBe(200);
    expect(teamResponse.body.data.map((user: { username: string }) => user.username)).toContain("scanner_schedule_team_1001");
    expect(teamResponse.body.data.some((user: { username: string; assignmentType: string; locked: boolean }) => (
      user.username === "scanner01" && user.assignmentType === "LOCATION" && user.locked
    ))).toBe(true);

    const helperLoginResponse = await request(app).post("/api/auth/login").send({
      username: "scanner_schedule_team_1001",
      password: "prototype",
    });
    expect(helperLoginResponse.status).toBe(200);
    expect(helperLoginResponse.body.data.user.locCode).toBe("1001");
    expect(helperLoginResponse.body.data.user.accessibleLocCodes).toEqual(["1001"]);
    const helperToken = helperLoginResponse.body.data.accessToken as string;

    const helperScheduleResponse = await request(app)
      .get("/api/stock-take/schedules/active")
      .set("authorization", `Bearer ${helperToken}`);
    expect(helperScheduleResponse.status).toBe(200);
    expect(helperScheduleResponse.body.data.some((schedule: { id: string; locCode: string }) => (
      schedule.id === scheduleId && schedule.locCode === "6168"
    ))).toBe(true);

    const rackResponse = await request(app)
      .get(`/api/stock-take/schedules/${scheduleId}/racks`)
      .set("authorization", `Bearer ${helperToken}`);
    expect(rackResponse.status).toBe(200);
    expect(rackResponse.body.data.racks.length).toBeGreaterThan(0);
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
    const scanId = scanLinesResponse.body.data.scans[0].id as string;

    const finalQtyResponse = await request(app)
      .patch(`/api/stock-take/schedules/${scheduleId}/racks/${rackId}/scans/final-qty`)
      .set("authorization", `Bearer ${token}`)
      .send({
        recheckUser: "scanner01",
        lines: [
          {
            scanId,
            finalQty: 1,
          },
        ],
      });
    expect(finalQtyResponse.status).toBe(200);
    expect(finalQtyResponse.body.data.scans[0].scanQty).toBe(2);
    expect(finalQtyResponse.body.data.scans[0].finalQty).toBe(1);
    expect(finalQtyResponse.body.data.scans[0].discrepancyQty).toBe(-1);
    expect(finalQtyResponse.body.data.scans[0].recheckUser).toBe("scanner01");

    const correctedRackResponse = await request(app)
      .get(`/api/stock-take/schedules/${scheduleId}/racks`)
      .set("authorization", `Bearer ${token}`);
    expect(correctedRackResponse.status).toBe(200);
    const correctedRack = correctedRackResponse.body.data.racks.find(
      (rack: { id: string }) => rack.id === rackId,
    );
    expect(correctedRack.rackStatus).toBe("PRINTED");
    expect(correctedRack.discrepancyQuantity).toBe(-1);

    const confirmResponse = await request(app)
      .post(`/api/stock-take/schedules/${scheduleId}/racks/${rackId}/confirm`)
      .set("authorization", `Bearer ${token}`)
      .send({
        recheckUser: "scanner01",
        lines: [
          {
            scanId,
            finalQty: 1,
          },
        ],
      });
    expect(confirmResponse.status).toBe(200);
    expect(confirmResponse.body.data.scans[0].confirmTime).toEqual(expect.any(String));

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

  it("rejects printed rack scans so mobile can scan the rack again", async () => {
    const loginResponse = await request(app).post("/api/auth/login").send({
      username: "store_manager01",
      password: "prototype",
    });
    const token = loginResponse.body.data.accessToken as string;

    const scheduleResponse = await request(app)
      .get("/api/stock-take/schedules?locCode=6168")
      .set("authorization", `Bearer ${token}`);
    const scheduleId = scheduleResponse.body.data[0].id as string;

    const rackResponse = await request(app)
      .get(`/api/stock-take/schedules/${scheduleId}/racks`)
      .set("authorization", `Bearer ${token}`);
    const rackId = rackResponse.body.data.racks[2].id as string;

    const submitResponse = await request(app)
      .post(`/api/stock-take/schedules/${scheduleId}/racks/${rackId}/scans/submit`)
      .set("authorization", `Bearer ${token}`)
      .send({
        lines: [
          {
            clientScanId: "reject-flow-scan-1",
            barcode: "383800000013",
            scanQty: 1,
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

    const rejectResponse = await request(app)
      .post(`/api/stock-take/schedules/${scheduleId}/racks/${rackId}/reject`)
      .set("authorization", `Bearer ${token}`)
      .send({});
    expect(rejectResponse.status).toBe(200);
    expect(rejectResponse.body.data.rejected).toBe(true);

    const rejectedRackResponse = await request(app)
      .get(`/api/stock-take/schedules/${scheduleId}/racks`)
      .set("authorization", `Bearer ${token}`);
    const rejectedRack = rejectedRackResponse.body.data.racks.find(
      (rack: { id: string }) => rack.id === rackId,
    );
    expect(rejectedRack.rackStatus).toBe("REJECTED");
    expect(rejectedRack.submittedLineCount).toBe(0);

    const resubmitResponse = await request(app)
      .post(`/api/stock-take/schedules/${scheduleId}/racks/${rackId}/scans/submit`)
      .set("authorization", `Bearer ${token}`)
      .send({
        lines: [
          {
            clientScanId: "reject-flow-scan-2",
            barcode: "383800000013",
            scanQty: 2,
            inputType: "SCAN",
          },
        ],
      });
    expect(resubmitResponse.status).toBe(200);
  });

  it("rejects rack mutations when schedule is already closed", async () => {
    const loginResponse = await request(app).post("/api/auth/login").send({
      username: "store_manager01",
      password: "prototype",
    });
    const token = loginResponse.body.data.accessToken as string;
    const mockData = await import("./shared/mock-data.js");
    const schedule = mockData.mockSchedules.find((item) => item.id === "1");
    expect(schedule).toBeTruthy();
    if (!schedule) return;
    const previousStatus = schedule.status;
    schedule.status = "CLOSED";

    try {
      const submitResponse = await request(app)
        .post("/api/stock-take/schedules/1/racks/1/scans/submit")
        .set("authorization", `Bearer ${token}`)
        .send({
          lines: [
            {
              clientScanId: "closed-schedule-scan-1",
              barcode: "383800000013",
              scanQty: 1,
              inputType: "SCAN",
            },
          ],
        });
      expect(submitResponse.status).toBe(409);
      expect(submitResponse.body.error.code).toBe("SCHEDULE_NOT_EDITABLE");

      const printResponse = await request(app)
        .post("/api/stock-take/schedules/1/racks/1/print")
        .set("authorization", `Bearer ${token}`)
        .send({});
      expect(printResponse.status).toBe(409);
      expect(printResponse.body.error.code).toBe("SCHEDULE_NOT_EDITABLE");
    } finally {
      schedule.status = previousStatus;
    }
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
        cutOffDate: "2026-08-04",
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
