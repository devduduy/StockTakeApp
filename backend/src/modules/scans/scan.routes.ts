import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/app-error.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { lookupItemByBarcode } from "../items/item.repository.js";
import { findRackById } from "../racks/rack.repository.js";
import { findScheduleLocation } from "../schedules/schedule.repository.js";
import { submitRackScans } from "./scan.repository.js";
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

export const scanRouter = Router({ mergeParams: true });

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
    if (schedule.status === "CANCELLED") {
      throw new AppError(
        409,
        "Schedule sudah dibatalkan.",
        "SCHEDULE_CANCELLED",
      );
    }
    if (request.auth?.locCode && request.auth.locCode !== schedule.locCode) {
      throw new AppError(
        403,
        "User tidak memiliki akses ke lokasi schedule ini.",
        "SCHEDULE_LOCATION_FORBIDDEN",
      );
    }

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
