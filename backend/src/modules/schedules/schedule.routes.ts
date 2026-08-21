import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/app-error.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { assertCanAccessLocation, resolveReadableLocCodes, resolveWritableLocCode as resolveMappedWritableLocCode } from "../../shared/location-access.js";
import { listAssignedScheduleIdsForUser, listScheduleUserCandidates, listScheduleUsers, replaceScheduleUsers } from "../schedule-users/schedule-user.repository.js";
import {
  closeSchedule,
  createSchedule,
  findScheduleLocation,
  listActiveSchedules,
  listSchedules,
  listSchedulesByIds,
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

const scheduleUserParamsSchema = z.object({
  scheduleId: z.coerce.number().int().positive().safe(),
});

const scheduleUsersPayloadSchema = z.object({
  userIds: z.array(z.union([z.string().trim().regex(/^\d+$/), z.number().int().positive().safe()])).default([]),
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

function resolveWritableLocCode(
  auth: Parameters<typeof resolveMappedWritableLocCode>[0],
  requestedLocCode?: string,
): string {
  return resolveMappedWritableLocCode(
    auth,
    requestedLocCode,
    "Schedule hanya boleh dikelola untuk lokasi yang dimapping ke user.",
  );
}

function mergeSchedules<T extends { id: string }>(...scheduleGroups: T[][]): T[] {
  const merged = new Map<string, T>();
  for (const schedule of scheduleGroups.flat()) {
    merged.set(schedule.id, schedule);
  }
  return [...merged.values()];
}

async function assertCanManageScheduleTeam(
  scheduleId: number,
  roleCode: string | undefined,
  auth: Parameters<typeof assertCanAccessLocation>[0],
): Promise<void> {
  assertCanManageSchedule(roleCode);
  const schedule = await findScheduleLocation(scheduleId);
  if (!schedule) {
    throw new AppError(404, "Schedule tidak ditemukan.", "SCHEDULE_NOT_FOUND");
  }
  assertCanAccessLocation(
    auth,
    schedule.locCode,
    "Tim schedule hanya boleh dikelola untuk lokasi yang dimapping ke user.",
  );
}

scheduleRouter.get(
  "/",
  authenticate,
  asyncHandler(async (request, response) => {
    const query = querySchema.parse(request.query);
    const locCodes = resolveReadableLocCodes(request.auth, query.locCode);
    const locationSchedules = locCodes
      ? (await Promise.all(locCodes.map((locCode) => listSchedules(locCode)))).flat()
      : await listSchedules(undefined);
    const assignedScheduleIds = await listAssignedScheduleIdsForUser(request.auth?.userId, request.auth?.username);
    const assignedSchedules = await listSchedulesByIds(assignedScheduleIds);
    const schedules = mergeSchedules(locationSchedules, assignedSchedules);
    response.status(200).json({ data: schedules });
  }),
);

scheduleRouter.post(
  "/:scheduleId/close",
  authenticate,
  asyncHandler(async (request, response) => {
    assertCanManageSchedule(request.auth?.roleCode);
    const params = z.object({ scheduleId: z.coerce.number().int().positive() }).parse(request.params);
    const scheduleLocation = await findScheduleLocation(params.scheduleId);
    if (!scheduleLocation) {
      throw new AppError(404, "Schedule tidak ditemukan.", "SCHEDULE_NOT_FOUND");
    }
    assertCanAccessLocation(request.auth, scheduleLocation.locCode, "Schedule hanya boleh di-close untuk lokasi yang dimapping ke user.");
    const schedule = await closeSchedule(params.scheduleId, request.auth?.username ?? "SYSTEM");
    response.status(200).json({ data: schedule });
  }),
);

scheduleRouter.get(
  "/active",
  authenticate,
  asyncHandler(async (request, response) => {
    const query = querySchema.parse(request.query);
    const locCodes = resolveReadableLocCodes(request.auth, query.locCode);
    const locationSchedules = locCodes
      ? (await Promise.all(locCodes.map((locCode) => listActiveSchedules(locCode)))).flat()
      : await listActiveSchedules(undefined);
    const assignedScheduleIds = await listAssignedScheduleIdsForUser(request.auth?.userId, request.auth?.username);
    const assignedSchedules = await listSchedulesByIds(assignedScheduleIds, true);
    const schedules = mergeSchedules(locationSchedules, assignedSchedules);
    response.status(200).json({ data: schedules });
  }),
);

scheduleRouter.get(
  "/:scheduleId/users",
  authenticate,
  asyncHandler(async (request, response) => {
    const params = scheduleUserParamsSchema.parse(request.params);
    await assertCanManageScheduleTeam(params.scheduleId, request.auth?.roleCode, request.auth);
    const users = await listScheduleUsers(params.scheduleId);
    response.status(200).json({ data: users });
  }),
);

scheduleRouter.get(
  "/:scheduleId/user-candidates",
  authenticate,
  asyncHandler(async (request, response) => {
    const params = scheduleUserParamsSchema.parse(request.params);
    await assertCanManageScheduleTeam(params.scheduleId, request.auth?.roleCode, request.auth);
    const users = await listScheduleUserCandidates(params.scheduleId);
    response.status(200).json({ data: users });
  }),
);

scheduleRouter.put(
  "/:scheduleId/users",
  authenticate,
  asyncHandler(async (request, response) => {
    const params = scheduleUserParamsSchema.parse(request.params);
    const body = scheduleUsersPayloadSchema.parse(request.body);
    await assertCanManageScheduleTeam(params.scheduleId, request.auth?.roleCode, request.auth);
    const users = await replaceScheduleUsers(
      params.scheduleId,
      body.userIds,
      request.auth?.username ?? "SYSTEM",
    );
    response.status(200).json({ data: users });
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
