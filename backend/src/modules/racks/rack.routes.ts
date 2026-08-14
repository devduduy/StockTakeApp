import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { findScheduleLocation } from "../schedules/schedule.repository.js";
import { AppError } from "../../shared/app-error.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { isInventoryControl } from "../../shared/roles.js";
import { addRackToScheduleScope, createRackMaster, createRackMastersBulk, listActiveRacksByLocation, listRackMastersByLocation } from "./rack.repository.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";

const paramsSchema = z.object({
  scheduleId: z.coerce
    .number()
    .int()
    .positive()
    .safe(),
});

export const rackRouter = Router({ mergeParams: true });
export const rackMasterRouter = Router();

const rackQuerySchema = z.object({
  locCode: z.string().trim().regex(/^[A-Za-z0-9]{4}$/).optional(),
});

const createRackBodySchema = z.object({
  rackCode: z.string().trim().regex(/^RCK-([A-Za-z])\1-\d{3}$/, "Format kode rack harus RCK-{2 huruf sama}-{3 angka}, contoh RCK-AA-001."),
  rackName: z.string().trim().min(2).max(100),
  locCode: z.string().trim().regex(/^[A-Za-z0-9]{4}$/).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

const createRackBulkBodySchema = z.object({
  letterCode: z.string().trim().regex(/^([A-Za-z])\1$/, "Kode huruf wajib 2 huruf sama, contoh AA."),
  startSequence: z.coerce.number().int().min(1).max(999),
  count: z.coerce.number().int().min(1).max(200),
  rackNamePrefix: z.string().trim().min(2).max(80),
  locCode: z.string().trim().regex(/^[A-Za-z0-9]{4}$/).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

const addRackScopeBodySchema = z.object({
  rackId: z.coerce.number().int().positive().safe(),
});

function assertCanManageRack(roleCode: string | undefined): void {
  if (roleCode === "SCANNER") {
    throw new AppError(
      403,
      "Role scanner tidak diizinkan mengelola rack.",
      "FORBIDDEN",
    );
  }
}

function resolveReadableLocCode(
  auth: AuthenticatedUser | undefined,
  requestedLocCode?: string,
): string | undefined {
  if (isInventoryControl(auth)) {
    return requestedLocCode;
  }
  return auth?.locCode ?? requestedLocCode;
}

function resolveWritableLocCode(
  auth: AuthenticatedUser | undefined,
  requestedLocCode?: string,
): string {
  if (!auth?.locCode && !requestedLocCode) {
    throw new AppError(400, "LOC_CODE belum tersedia.", "LOC_CODE_REQUIRED");
  }
  if (isInventoryControl(auth)) {
    if (!requestedLocCode) {
      throw new AppError(400, "Lokasi wajib dipilih.", "LOC_CODE_REQUIRED");
    }
    return requestedLocCode;
  }
  if (requestedLocCode && requestedLocCode !== auth?.locCode) {
    throw new AppError(403, "Rack hanya boleh dikelola untuk lokasi user.", "LOCATION_FORBIDDEN");
  }
  return auth?.locCode ?? requestedLocCode!;
}

rackMasterRouter.get(
  "/",
  authenticate,
  asyncHandler(async (request, response) => {
    const query = rackQuerySchema.parse(request.query);
    const locCode = resolveReadableLocCode(request.auth, query.locCode);
    const racks = await listRackMastersByLocation(locCode);
    response.status(200).json({ data: racks });
  }),
);

rackMasterRouter.post(
  "/",
  authenticate,
  asyncHandler(async (request, response) => {
    assertCanManageRack(request.auth?.roleCode);
    const body = createRackBodySchema.parse(request.body);
    const locCode = resolveWritableLocCode(request.auth, body.locCode);
    const rack = await createRackMaster({
      ...body,
      locCode,
      username: request.auth?.username ?? "SYSTEM",
    });
    response.status(201).json({ data: rack });
  }),
);

rackMasterRouter.post(
  "/bulk",
  authenticate,
  asyncHandler(async (request, response) => {
    assertCanManageRack(request.auth?.roleCode);
    const body = createRackBulkBodySchema.parse(request.body);
    const locCode = resolveWritableLocCode(request.auth, body.locCode);
    const racks = await createRackMastersBulk({
      ...body,
      locCode,
      username: request.auth?.username ?? "SYSTEM",
    });
    response.status(201).json({ data: racks });
  }),
);

rackRouter.get(
  "/:scheduleId/racks",
  authenticate,
  asyncHandler(async (request, response) => {
    const { scheduleId } = paramsSchema.parse(request.params);
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
    if (!isInventoryControl(request.auth) && request.auth?.locCode && request.auth.locCode !== schedule.locCode) {
      throw new AppError(
        403,
        "User tidak memiliki akses ke lokasi schedule ini.",
        "SCHEDULE_LOCATION_FORBIDDEN",
      );
    }

    const racks = await listActiveRacksByLocation(schedule.locCode, scheduleId);
    response.status(200).json({
      data: {
        schedule,
        racks,
      },
    });
  }),
);

rackRouter.post(
  "/:scheduleId/racks/scope",
  authenticate,
  asyncHandler(async (request, response) => {
    assertCanManageRack(request.auth?.roleCode);
    const { scheduleId } = paramsSchema.parse(request.params);
    const { rackId } = addRackScopeBodySchema.parse(request.body);
    const schedule = await findScheduleLocation(scheduleId);
    if (!schedule) {
      throw new AppError(
        404,
        "Schedule tidak ditemukan.",
        "SCHEDULE_NOT_FOUND",
      );
    }
    if (["COMPLETED", "CLOSED", "CANCELLED"].includes(schedule.status)) {
      throw new AppError(
        409,
        "Schedule sudah close sehingga rack tidak bisa ditambah.",
        "SCHEDULE_CLOSED",
      );
    }
    if (!isInventoryControl(request.auth) && request.auth?.locCode && request.auth.locCode !== schedule.locCode) {
      throw new AppError(
        403,
        "User tidak memiliki akses ke lokasi schedule ini.",
        "SCHEDULE_LOCATION_FORBIDDEN",
      );
    }

    const result = await addRackToScheduleScope(
      scheduleId,
      rackId,
      request.auth?.username ?? "SYSTEM",
    );
    response.status(result.added ? 201 : 200).json({ data: result });
  }),
);
