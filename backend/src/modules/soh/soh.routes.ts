import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/app-error.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { assertCanAccessLocation } from "../../shared/location-access.js";
import { broadcastStockTakeEvent } from "../realtime/stock-take-events.js";
import { findScheduleLocation } from "../schedules/schedule.repository.js";
import { generateSohFromStockCard, getSohScheduleSummary } from "./soh.repository.js";

const paramsSchema = z.object({
  scheduleId: z.coerce.number().int().positive().safe(),
});

export const sohRouter = Router();

function assertCanManageSoh(roleCode: string | undefined): void {
  if (roleCode === "SCANNER") {
    throw new AppError(
      403,
      "Role scanner tidak diizinkan generate SOH.",
      "FORBIDDEN",
    );
  }
}

async function assertCanAccessSohSchedule(
  scheduleId: number,
  auth: Express.Request["auth"],
): Promise<{ locCode: string }> {
  const schedule = await findScheduleLocation(scheduleId);
  if (!schedule) {
    throw new AppError(404, "Schedule tidak ditemukan.", "SCHEDULE_NOT_FOUND");
  }
  assertCanAccessLocation(auth, schedule.locCode, "User tidak memiliki akses ke lokasi schedule ini.");
  return { locCode: schedule.locCode };
}

sohRouter.get(
  "/:scheduleId",
  authenticate,
  asyncHandler(async (request, response) => {
    const { scheduleId } = paramsSchema.parse(request.params);
    await assertCanAccessSohSchedule(scheduleId, request.auth);
    const summary = await getSohScheduleSummary(scheduleId);
    response.status(200).json({ data: summary });
  }),
);

sohRouter.post(
  "/:scheduleId/generate",
  authenticate,
  asyncHandler(async (request, response) => {
    assertCanManageSoh(request.auth?.roleCode);
    const { scheduleId } = paramsSchema.parse(request.params);
    const schedule = await assertCanAccessSohSchedule(scheduleId, request.auth);
    const result = await generateSohFromStockCard(
      scheduleId,
      request.auth?.username ?? "SYSTEM",
    );
    broadcastStockTakeEvent({
      type: "soh.generated",
      scheduleId,
      locCode: schedule.locCode,
      username: request.auth?.username,
      metadata: {
        insertedRowCount: result.insertedRowCount,
        sohRowCount: result.sohRowCount,
      },
    });
    response.status(200).json({ data: result });
  }),
);
