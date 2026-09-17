import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/app-error.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { assertCanAccessLocation, resolveReadableLocCodes, resolveWritableLocCode as resolveMappedWritableLocCode } from "../../shared/location-access.js";
import { broadcastStockTakeEvent } from "../realtime/stock-take-events.js";
import { listAssignedScheduleIdsForUser, listScheduleUserCandidates, listScheduleUsers, replaceScheduleUsers } from "../schedule-users/schedule-user.repository.js";
import {
  closeSchedule,
  createSchedule,
  findScheduleLocation,
  listActiveSchedules,
  listSchedules,
  listSchedulesByIds,
  listSchedulesPage,
  updateSchedule,
} from "./schedule.repository.js";
import type { ActiveSchedule, ScheduleListFilters } from "./schedule.types.js";

const querySchema = z
  .object({
    scheduleNo: z.string().trim().min(1).max(80).optional(),
    locCode: z.string().trim().regex(/^[A-Za-z0-9]{4}$/).optional(),
    categoryId: z.string().trim().min(1).max(30).optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    status: z.enum(["DRAFT", "OPEN", "IN_PROGRESS", "CLOSED", "COMPLETED", "CANCELLED"]).optional(),
    stockType: z.enum(["ALL", "PARTIAL"]).optional(),
  })
  .superRefine((value, context) => {
    if (value.startDate && value.endDate && value.endDate < value.startDate) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "Tanggal sampai tidak boleh lebih kecil dari tanggal dari.",
      });
    }
  });

const pageQuerySchema = querySchema.extend({
  page: z.coerce.number().int().positive().safe().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
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

function matchesScheduleFilters(schedule: ActiveSchedule, filters: ScheduleListFilters): boolean {
  if (filters.startDate && schedule.endDate < filters.startDate) {
    return false;
  }
  if (filters.endDate && schedule.startDate > filters.endDate) {
    return false;
  }
  if (filters.status && schedule.status !== filters.status) {
    return false;
  }
  if (filters.stockType && schedule.stockType.name !== filters.stockType) {
    return false;
  }
  return true;
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
    const filters: ScheduleListFilters = {};
    if (query.scheduleNo) filters.scheduleNo = query.scheduleNo;
    if (query.startDate) filters.startDate = query.startDate;
    if (query.endDate) filters.endDate = query.endDate;
    if (query.status) filters.status = query.status;
    if (query.stockType) filters.stockType = query.stockType;
    if (query.categoryId) filters.categoryId = query.categoryId;
    const locationSchedules = locCodes
      ? (await Promise.all(locCodes.map((locCode) => listSchedules(locCode, filters)))).flat()
      : await listSchedules(undefined, filters);
    const assignedScheduleIds = await listAssignedScheduleIdsForUser(request.auth?.userId, request.auth?.username);
    const assignedSchedules = await listSchedulesByIds(assignedScheduleIds);
    const schedules = mergeSchedules(locationSchedules, assignedSchedules).filter((schedule) =>
      matchesScheduleFilters(schedule, filters),
    );
    response.status(200).json({ data: schedules });
  }),
);

scheduleRouter.get(
  "/page",
  authenticate,
  asyncHandler(async (request, response) => {
    const query = pageQuerySchema.parse(request.query);
    const locCodes = resolveReadableLocCodes(request.auth, query.locCode);
    const filters: ScheduleListFilters = {};
    if (query.scheduleNo) filters.scheduleNo = query.scheduleNo;
    if (query.startDate) filters.startDate = query.startDate;
    if (query.endDate) filters.endDate = query.endDate;
    if (query.status) filters.status = query.status;
    if (query.stockType) filters.stockType = query.stockType;
    if (query.categoryId) filters.categoryId = query.categoryId;
    const assignedScheduleIds = await listAssignedScheduleIdsForUser(request.auth?.userId, request.auth?.username);
    const pageOptions = {
      assignedScheduleIds,
      filters,
      page: query.page,
      pageSize: query.pageSize,
      ...(locCodes ? { locCodes } : {}),
    };
    const page = await listSchedulesPage(pageOptions);
    response.status(200).json({ data: page });
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
    broadcastStockTakeEvent({
      type: "schedule.closed",
      scheduleId: params.scheduleId,
      locCode: scheduleLocation.locCode,
      username: request.auth?.username,
    });
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
    const schedule = await findScheduleLocation(params.scheduleId);
    broadcastStockTakeEvent({
      type: "schedule.team.updated",
      scheduleId: params.scheduleId,
      locCode: schedule?.locCode,
      username: request.auth?.username,
    });
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
    broadcastStockTakeEvent({
      type: "schedule.created",
      scheduleId: Number(schedule.id),
      locCode: schedule.locCode,
      username: request.auth?.username,
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
    broadcastStockTakeEvent({
      type: "schedule.updated",
      scheduleId: params.scheduleId,
      locCode: schedule.locCode,
      username: request.auth?.username,
    });
    response.status(200).json({ data: schedule });
  }),
);
