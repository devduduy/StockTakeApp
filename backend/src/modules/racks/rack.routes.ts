import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { findScheduleLocation } from "../schedules/schedule.repository.js";
import { AppError } from "../../shared/app-error.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { listActiveRacksByLocation } from "./rack.repository.js";

const paramsSchema = z.object({
  scheduleId: z.coerce
    .number()
    .int()
    .positive()
    .safe(),
});

export const rackRouter = Router({ mergeParams: true });

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

    const racks = await listActiveRacksByLocation(schedule.locCode, scheduleId);
    response.status(200).json({
      data: {
        schedule,
        racks,
      },
    });
  }),
);
