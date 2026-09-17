import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { assertCanAccessSchedule } from "../../shared/schedule-access.js";
import { findScheduleLocation } from "../schedules/schedule.repository.js";
import { buildStockTakeReportBundle } from "./report.repository.js";
import { AppError } from "../../shared/app-error.js";

const paramsSchema = z.object({
  scheduleId: z.coerce.number().int().positive().safe(),
});

const querySchema = z.object({
  categoryId: z.string().trim().min(1).max(30).optional(),
});

export const reportRouter = Router();

reportRouter.get(
  "/:scheduleId",
  authenticate,
  asyncHandler(async (request, response) => {
    const { scheduleId } = paramsSchema.parse(request.params);
    const { categoryId } = querySchema.parse(request.query);
    const schedule = await findScheduleLocation(scheduleId);
    if (!schedule) {
      throw new AppError(404, "Schedule tidak ditemukan.", "SCHEDULE_NOT_FOUND");
    }

    await assertCanAccessSchedule(
      request.auth,
      scheduleId,
      schedule.locCode,
      "User tidak memiliki akses ke report schedule ini.",
    );

    const report = await buildStockTakeReportBundle(scheduleId, categoryId);
    response.status(200).json({ data: report });
  }),
);
