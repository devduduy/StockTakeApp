import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/app-error.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { assertCanAccessSchedule } from "../../shared/schedule-access.js";
import { lookupItemByBarcode } from "../items/item.repository.js";
import { broadcastStockTakeEvent } from "../realtime/stock-take-events.js";
import { findRackById, isRackInScheduleScope } from "../racks/rack.repository.js";
import { findScheduleLocation } from "../schedules/schedule.repository.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import { addManualRackScan, confirmRackScans, deleteRackScan, isRackPrinted, listRackScans, printRackScans, rejectRackScans, submitRackScans, updateRackFinalQuantities } from "./scan.repository.js";
import type { CanonicalScanLine } from "./scan.types.js";

const paramsSchema = z.object({
  scheduleId: z.coerce.number().int().positive().safe(),
  rackId: z.coerce.number().int().positive().safe(),
});

const lineSchema = z.object({
  clientScanId: z.string().trim().min(1).max(64),
  barcode: z.string().trim().min(1).max(50),
  plu: z.string().trim().max(30).optional(),
  pluDescription: z.string().trim().max(255).optional(),
  scanQty: z.coerce.number().int().positive().max(999_999),
  inputType: z.enum(["SCAN", "MANUAL"]).default("SCAN"),
  clientUpdatedAt: z.coerce.number().int().positive().optional(),
});

const bodySchema = z.object({
  lines: z.array(lineSchema).min(1).max(500),
});

const finalQtyLineSchema = z.object({
  scanId: z.coerce.number().int().positive().safe(),
  finalQty: z.coerce.number().int().min(0).max(999_999),
});

const finalQtyBodySchema = z.object({
  recheckUser: z.string().trim().min(1).max(100),
  lines: z.array(finalQtyLineSchema).min(1).max(500),
});

export const scanRouter = Router({ mergeParams: true });

function assertCanPrint(roleCode: string | undefined): void {
  if (roleCode === "SCANNER") {
    throw new AppError(
      403,
      "Role scanner tidak diizinkan melakukan print rack.",
      "FORBIDDEN",
    );
  }
}

function assertScheduleAllowsRackAction(status: string): void {
  if (["CLOSED", "COMPLETED", "CANCELLED"].includes(status)) {
    throw new AppError(
      409,
      "Schedule sudah selesai atau dibatalkan. Aksi rack tidak bisa diproses.",
      "SCHEDULE_NOT_EDITABLE",
    );
  }
}

async function assertRackInScheduleScope(
  scheduleId: number,
  rackId: number,
): Promise<void> {
  if (!(await isRackInScheduleScope(scheduleId, rackId))) {
    throw new AppError(
      422,
      "Rack tidak termasuk scope schedule ini.",
      "RACK_NOT_IN_SCHEDULE_SCOPE",
    );
  }
}

async function resolveScheduleRackContext(
  auth: AuthenticatedUser | undefined,
  scheduleId: number,
  rackId: number,
) {
  const schedule = await findScheduleLocation(scheduleId);
  if (!schedule) {
    throw new AppError(
      404,
      "Schedule tidak ditemukan.",
      "SCHEDULE_NOT_FOUND",
    );
  }
  assertScheduleAllowsRackAction(schedule.status);
  await assertCanAccessSchedule(
    auth,
    scheduleId,
    schedule.locCode,
    "User tidak memiliki akses ke schedule ini.",
  );

  const rack = await findRackById(rackId);
  if (!rack) {
    throw new AppError(404, "Rack tidak ditemukan.", "RACK_NOT_FOUND");
  }
  if (rack.locCode !== schedule.locCode) {
    throw new AppError(
      422,
      "Rack tidak sesuai dengan lokasi schedule.",
      "RACK_LOCATION_MISMATCH",
    );
  }
  await assertRackInScheduleScope(scheduleId, rackId);

  return { schedule, rack };
}

scanRouter.get(
  "/:scheduleId/racks/:rackId/scans",
  authenticate,
  asyncHandler(async (request, response) => {
    const { scheduleId, rackId } = paramsSchema.parse(request.params);
    const schedule = await findScheduleLocation(scheduleId);
    if (!schedule) {
      throw new AppError(
        404,
        "Schedule tidak ditemukan.",
        "SCHEDULE_NOT_FOUND",
      );
    }
    await assertCanAccessSchedule(request.auth, scheduleId, schedule.locCode, "User tidak memiliki akses ke schedule ini.");

    const rack = await findRackById(rackId);
    if (!rack) {
      throw new AppError(404, "Rack tidak ditemukan.", "RACK_NOT_FOUND");
    }
    if (rack.locCode !== schedule.locCode) {
      throw new AppError(
        422,
        "Rack tidak sesuai dengan lokasi schedule.",
        "RACK_LOCATION_MISMATCH",
      );
    }
    await assertRackInScheduleScope(scheduleId, rackId);

    const scans = await listRackScans(scheduleId, rackId);
    response.status(200).json({ data: { scans } });
  }),
);

scanRouter.post(
  "/:scheduleId/racks/:rackId/scans/submit",
  authenticate,
  asyncHandler(async (request, response) => {
    const { scheduleId, rackId } = paramsSchema.parse(request.params);
    const body = bodySchema.parse(request.body);
    const schedule = await findScheduleLocation(scheduleId);
    if (!schedule) {
      throw new AppError(
        404,
        "Schedule tidak ditemukan.",
        "SCHEDULE_NOT_FOUND",
      );
    }
    assertScheduleAllowsRackAction(schedule.status);
    await assertCanAccessSchedule(request.auth, scheduleId, schedule.locCode, "User tidak memiliki akses ke schedule ini.");

    const rack = await findRackById(rackId);
    if (!rack) {
      throw new AppError(404, "Rack tidak ditemukan.", "RACK_NOT_FOUND");
    }
    if (rack.status !== "ACTIVE") {
      throw new AppError(409, "Rack tidak aktif.", "RACK_INACTIVE");
    }
    if (rack.locCode !== schedule.locCode) {
      throw new AppError(
        422,
        "Rack tidak sesuai dengan lokasi schedule.",
        "RACK_LOCATION_MISMATCH",
      );
    }
    await assertRackInScheduleScope(scheduleId, rackId);
    if (await isRackPrinted(scheduleId, rackId)) {
      throw new AppError(
        409,
        "Rack sudah diprint. Scan tambahan tidak boleh disubmit.",
        "RACK_ALREADY_PRINTED",
      );
    }

    const canonicalLines: CanonicalScanLine[] = [];
    for (const line of body.lines) {
      const item = await lookupItemByBarcode(line.barcode, scheduleId);
      if (!item) {
        throw new AppError(
          404,
          `Barcode ${line.barcode} tidak ditemukan di master item.`,
          "ITEM_NOT_FOUND",
          { barcode: line.barcode },
        );
      }
      const canonicalLine: CanonicalScanLine = {
        clientScanId: line.clientScanId,
        barcode: line.barcode,
        scanQty: line.scanQty,
        inputType: line.inputType,
        plu: item.plu,
        pluDescription: item.pluDescription,
      };
      if (line.clientUpdatedAt !== undefined) {
        canonicalLine.clientUpdatedAt = line.clientUpdatedAt;
      }
      canonicalLines.push(canonicalLine);
    }

    const result = await submitRackScans({
      scheduleId,
      scheduleNo: schedule.scheduleNo,
      rackId,
      rackCode: rack.rackCode,
      username: request.auth?.username ?? "mobile",
      lines: canonicalLines,
    });
    broadcastStockTakeEvent({
      type: "rack.scanned",
      scheduleId,
      rackId,
      locCode: schedule.locCode,
      username: request.auth?.username,
      metadata: {
        acceptedLines: result.acceptedLines,
        submittedQuantity: result.submittedQuantity,
      },
    });

    response.status(200).json({ data: result });
  }),
);

scanRouter.post(
  "/:scheduleId/racks/:rackId/print",
  authenticate,
  asyncHandler(async (request, response) => {
    assertCanPrint(request.auth?.roleCode);
    const { scheduleId, rackId } = paramsSchema.parse(request.params);
    const schedule = await findScheduleLocation(scheduleId);
    if (!schedule) {
      throw new AppError(
        404,
        "Schedule tidak ditemukan.",
        "SCHEDULE_NOT_FOUND",
      );
    }
    assertScheduleAllowsRackAction(schedule.status);
    await assertCanAccessSchedule(request.auth, scheduleId, schedule.locCode, "User tidak memiliki akses ke schedule ini.");

    const rack = await findRackById(rackId);
    if (!rack) {
      throw new AppError(404, "Rack tidak ditemukan.", "RACK_NOT_FOUND");
    }
    if (rack.locCode !== schedule.locCode) {
      throw new AppError(
        422,
        "Rack tidak sesuai dengan lokasi schedule.",
        "RACK_LOCATION_MISMATCH",
      );
    }
    await assertRackInScheduleScope(scheduleId, rackId);

    const result = await printRackScans({
      scheduleId,
      rackId,
      username: request.auth?.username ?? "web",
    });
    broadcastStockTakeEvent({
      type: "rack.printed",
      scheduleId,
      rackId,
      locCode: schedule.locCode,
      username: request.auth?.username,
      metadata: {
        printNo: result.printNo,
        printedLineCount: result.printedLineCount,
        printedQuantity: result.printedQuantity,
      },
    });
    response.status(200).json({ data: result });
  }),
);

scanRouter.patch(
  "/:scheduleId/racks/:rackId/scans/final-qty",
  authenticate,
  asyncHandler(async (request, response) => {
    assertCanPrint(request.auth?.roleCode);
    const { scheduleId, rackId } = paramsSchema.parse(request.params);
    const body = finalQtyBodySchema.parse(request.body);
    const schedule = await findScheduleLocation(scheduleId);
    if (!schedule) {
      throw new AppError(
        404,
        "Schedule tidak ditemukan.",
        "SCHEDULE_NOT_FOUND",
      );
    }
    assertScheduleAllowsRackAction(schedule.status);
    await assertCanAccessSchedule(request.auth, scheduleId, schedule.locCode, "User tidak memiliki akses ke schedule ini.");

    const rack = await findRackById(rackId);
    if (!rack) {
      throw new AppError(404, "Rack tidak ditemukan.", "RACK_NOT_FOUND");
    }
    if (rack.locCode !== schedule.locCode) {
      throw new AppError(
        422,
        "Rack tidak sesuai dengan lokasi schedule.",
        "RACK_LOCATION_MISMATCH",
      );
    }
    await assertRackInScheduleScope(scheduleId, rackId);
    if (!(await isRackPrinted(scheduleId, rackId))) {
      throw new AppError(
        409,
        "Rack belum diprint. Final qty hanya bisa diedit setelah print pertama.",
        "RACK_NOT_PRINTED",
      );
    }

    const scans = await updateRackFinalQuantities({
      scheduleId,
      rackId,
      username: request.auth?.username ?? "web",
      recheckUser: body.recheckUser,
      lines: body.lines,
    });
    broadcastStockTakeEvent({
      type: "rack.corrected",
      scheduleId,
      rackId,
      locCode: schedule.locCode,
      username: request.auth?.username,
      metadata: { changedLines: body.lines.length },
    });
    response.status(200).json({ data: { scans } });
  }),
);

scanRouter.post(
  "/:scheduleId/racks/:rackId/confirm",
  authenticate,
  asyncHandler(async (request, response) => {
    assertCanPrint(request.auth?.roleCode);
    const { scheduleId, rackId } = paramsSchema.parse(request.params);
    const body = finalQtyBodySchema.parse(request.body);
    const schedule = await findScheduleLocation(scheduleId);
    if (!schedule) {
      throw new AppError(
        404,
        "Schedule tidak ditemukan.",
        "SCHEDULE_NOT_FOUND",
      );
    }
    assertScheduleAllowsRackAction(schedule.status);
    await assertCanAccessSchedule(request.auth, scheduleId, schedule.locCode, "User tidak memiliki akses ke schedule ini.");

    const rack = await findRackById(rackId);
    if (!rack) {
      throw new AppError(404, "Rack tidak ditemukan.", "RACK_NOT_FOUND");
    }
    if (rack.locCode !== schedule.locCode) {
      throw new AppError(
        422,
        "Rack tidak sesuai dengan lokasi schedule.",
        "RACK_LOCATION_MISMATCH",
      );
    }
    await assertRackInScheduleScope(scheduleId, rackId);

    const scans = await confirmRackScans({
      scheduleId,
      rackId,
      username: request.auth?.username ?? "web",
      recheckUser: body.recheckUser,
      lines: body.lines,
    });
    broadcastStockTakeEvent({
      type: "rack.confirmed",
      scheduleId,
      rackId,
      locCode: schedule.locCode,
      username: request.auth?.username,
      metadata: { confirmedLines: body.lines.length },
    });
    response.status(200).json({ data: { scans } });
  }),
);

scanRouter.post(
  "/:scheduleId/racks/:rackId/reject",
  authenticate,
  asyncHandler(async (request, response) => {
    assertCanPrint(request.auth?.roleCode);
    const { scheduleId, rackId } = paramsSchema.parse(request.params);
    const schedule = await findScheduleLocation(scheduleId);
    if (!schedule) {
      throw new AppError(
        404,
        "Schedule tidak ditemukan.",
        "SCHEDULE_NOT_FOUND",
      );
    }
    assertScheduleAllowsRackAction(schedule.status);
    await assertCanAccessSchedule(request.auth, scheduleId, schedule.locCode, "User tidak memiliki akses ke schedule ini.");

    const rack = await findRackById(rackId);
    if (!rack) {
      throw new AppError(404, "Rack tidak ditemukan.", "RACK_NOT_FOUND");
    }
    if (rack.locCode !== schedule.locCode) {
      throw new AppError(
        422,
        "Rack tidak sesuai dengan lokasi schedule.",
        "RACK_LOCATION_MISMATCH",
      );
    }
    await assertRackInScheduleScope(scheduleId, rackId);

    await rejectRackScans({
      scheduleId,
      rackId,
      username: request.auth?.username ?? "web",
    });
    broadcastStockTakeEvent({
      type: "rack.rejected",
      scheduleId,
      rackId,
      locCode: schedule.locCode,
      username: request.auth?.username,
    });
    response.status(200).json({ data: { rejected: true } });
  }),
);

scanRouter.delete(
  "/:scheduleId/racks/:rackId/scans/:scanId",
  authenticate,
  asyncHandler(async (request, response) => {
    if (request.auth?.roleCode !== "INVENTORY_CONTROL") {
      throw new AppError(403, "Hanya Inventory Control yang dapat menghapus data scan dari web.", "FORBIDDEN");
    }
    const { scheduleId, rackId } = paramsSchema.parse(request.params);
    const scanId = z.coerce.number().int().positive().parse(request.params.scanId);

    const { schedule } = await resolveScheduleRackContext(request.auth, scheduleId, rackId);

    const scans = await deleteRackScan({ scheduleId, rackId, scanId });
    broadcastStockTakeEvent({
      type: "rack.scan_deleted",
      scheduleId,
      rackId,
      locCode: schedule.locCode,
      username: request.auth?.username,
      metadata: { scanId },
    });
    response.status(200).json({ data: { scans } });
  }),
);

const manualScanSchema = z.object({
  barcode: z.string().trim().min(1).max(50),
  qty: z.coerce.number().int().positive().max(999_999),
});

scanRouter.post(
  "/:scheduleId/racks/:rackId/scans/manual",
  authenticate,
  asyncHandler(async (request, response) => {
    if (request.auth?.roleCode !== "INVENTORY_CONTROL") {
      throw new AppError(403, "Hanya Inventory Control yang dapat menambah data scan dari web.", "FORBIDDEN");
    }
    const { scheduleId, rackId } = paramsSchema.parse(request.params);
    const { barcode, qty } = manualScanSchema.parse(request.body);

    const { schedule, rack } = await resolveScheduleRackContext(
      request.auth,
      scheduleId,
      rackId,
    );
    const currentScans = await listRackScans(scheduleId, rackId);
    if (currentScans.some((scan) => scan.confirmTime)) {
      throw new AppError(
        409,
        "Rack sudah confirm. Item manual tidak bisa ditambahkan.",
        "RACK_ALREADY_CONFIRMED",
      );
    }

    const item = await lookupItemByBarcode(barcode, scheduleId);
    if (!item) {
      throw new AppError(404, `Barcode ${barcode} tidak ditemukan di master item.`, "ITEM_NOT_FOUND");
    }

    const scans = await addManualRackScan({
      scheduleId,
      rackId,
      barcode,
      qty,
      plu: item.plu,
      pluDescription: item.pluDescription,
      username: request.auth?.username ?? "web",
      scheduleNo: schedule.scheduleNo,
      rackCode: rack.rackCode,
    });
    broadcastStockTakeEvent({
      type: "rack.manual_scanned",
      scheduleId,
      rackId,
      locCode: schedule.locCode,
      username: request.auth?.username,
      metadata: { barcode, qty },
    });
    response.status(200).json({ data: { scans } });
  }),
);
