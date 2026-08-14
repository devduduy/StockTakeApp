import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/app-error.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { isInventoryControl } from "../../shared/roles.js";
import { lookupItemByBarcode } from "../items/item.repository.js";
import { findRackById, isRackInScheduleScope } from "../racks/rack.repository.js";
import { findScheduleLocation } from "../schedules/schedule.repository.js";
import { confirmRackScans, isRackPrinted, listRackScans, printRackScans, rejectRackScans, submitRackScans, updateRackFinalQuantities } from "./scan.repository.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
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

function assertCanAccessScheduleLocation(
  auth: AuthenticatedUser | undefined,
  scheduleLocCode: string,
): void {
  if (!isInventoryControl(auth) && auth?.locCode && auth.locCode !== scheduleLocCode) {
    throw new AppError(
      403,
      "User tidak memiliki akses ke lokasi schedule ini.",
      "SCHEDULE_LOCATION_FORBIDDEN",
    );
  }
}

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
    assertCanAccessScheduleLocation(request.auth, schedule.locCode);

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
    assertCanAccessScheduleLocation(request.auth, schedule.locCode);

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
    assertCanAccessScheduleLocation(request.auth, schedule.locCode);

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
    assertCanAccessScheduleLocation(request.auth, schedule.locCode);

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
    assertCanAccessScheduleLocation(request.auth, schedule.locCode);

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
    assertCanAccessScheduleLocation(request.auth, schedule.locCode);

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
    response.status(200).json({ data: { rejected: true } });
  }),
);
