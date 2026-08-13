import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/app-error.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { isInventoryControl } from "../../shared/roles.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import {
  closeSchedule,
  createSchedule,
  listActiveSchedules,
  listSchedules,
  updateSchedule,
} from "./schedule.repository.js";

const querySchema = z.object({
  locCode: z.string().trim().regex(/^[A-Za-z0-9]{4}$/).optional(),
});

const schedulePayloadSchema = z
  .object({
    scheduleDesc: z.string().trim().min(3).max(250).optional(),
    locCode: z.string().trim().regex(/^[A-Za-z0-9]{4}$/).optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    cutOffDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    endTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
    stockType: z.enum(["ALL", "PARTIAL"]),
    categoryIds: z.array(z.string().trim().min(1)).default([]),
    rackIds: z.array(z.string().trim().regex(/^\d+$/)).default([]),
    status: z.enum(["DRAFT", "OPEN"]).default("OPEN"),
  })
  .superRefine((value, context) => {
    if (value.stockType === "PARTIAL" && value.categoryIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["categoryIds"],
        message: "Schedule PARTIAL wajib memilih category.",
      });
    }
    if (value.stockType === "PARTIAL" && value.rackIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["rackIds"],
        message: "Schedule PARTIAL wajib memilih rack.",
      });
    }
    if (value.endDate < value.startDate) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "Tanggal selesai tidak boleh lebih kecil dari tanggal mulai.",
      });
    }
    if (
      value.startDate === value.endDate &&
      value.startTime &&
      value.endTime &&
      value.endTime < value.startTime
    ) {
      context.addIssue({
        code: "custom",
        path: ["endTime"],
        message: "Jam selesai tidak boleh lebih kecil dari jam mulai.",
      });
    }
  });

export const scheduleRouter = Router();

function assertCanManageSchedule(roleCode: string | undefined): void {
  if (roleCode === "SCANNER") {
    throw new AppError(
      403,
      "Role scanner tidak diizinkan mengelola schedule.",
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
    throw new AppError(403, "Schedule hanya boleh dikelola untuk lokasi user.", "LOCATION_FORBIDDEN");
  }
  return auth?.locCode ?? requestedLocCode!;
}

scheduleRouter.get(
  "/",
  authenticate,
  asyncHandler(async (request, response) => {
    const query = querySchema.parse(request.query);
    const locCode = resolveReadableLocCode(request.auth, query.locCode);
    const schedules = await listSchedules(locCode);
    response.status(200).json({ data: schedules });
  }),
);

scheduleRouter.post(
  "/:scheduleId/close",
  authenticate,
  asyncHandler(async (request, response) => {
    assertCanManageSchedule(request.auth?.roleCode);
    const params = z.object({ scheduleId: z.coerce.number().int().positive() }).parse(request.params);
    const schedule = await closeSchedule(params.scheduleId, request.auth?.username ?? "SYSTEM");
    response.status(200).json({ data: schedule });
  }),
);

scheduleRouter.get(
  "/active",
  authenticate,
  asyncHandler(async (request, response) => {
    const query = querySchema.parse(request.query);
    const locCode = resolveReadableLocCode(request.auth, query.locCode);
    const schedules = await listActiveSchedules(locCode);
    response.status(200).json({ data: schedules });
  }),
);

scheduleRouter.post(
  "/",
  authenticate,
  asyncHandler(async (request, response) => {
    assertCanManageSchedule(request.auth?.roleCode);
    const body = schedulePayloadSchema.parse(request.body);
    const locCode = resolveWritableLocCode(request.auth, body.locCode);
    const schedule = await createSchedule({
      ...body,
      locCode,
      startTime: body.startTime ?? null,
      endTime: body.endTime ?? null,
      username: request.auth?.username ?? "SYSTEM",
    });
    response.status(201).json({ data: schedule });
  }),
);

scheduleRouter.put(
  "/:scheduleId",
  authenticate,
  asyncHandler(async (request, response) => {
    assertCanManageSchedule(request.auth?.roleCode);
    const params = z.object({ scheduleId: z.coerce.number().int().positive() }).parse(request.params);
    const body = schedulePayloadSchema.parse(request.body);
    const locCode = resolveWritableLocCode(request.auth, body.locCode);
    const schedule = await updateSchedule(params.scheduleId, {
      ...body,
      locCode,
      startTime: body.startTime ?? null,
      endTime: body.endTime ?? null,
      username: request.auth?.username ?? "SYSTEM",
    });
    response.status(200).json({ data: schedule });
  }),
);
