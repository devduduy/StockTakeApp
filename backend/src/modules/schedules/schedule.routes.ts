import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { listActiveSchedules } from "./schedule.repository.js";

const querySchema = z.object({
  locCode: z.string().trim().regex(/^[A-Za-z0-9]{4}$/).optional(),
});

export const scheduleRouter = Router();

scheduleRouter.get(
  "/active",
  authenticate,
  asyncHandler(async (request, response) => {
    const query = querySchema.parse(request.query);
    const locCode = request.auth?.locCode ?? query.locCode;
    const schedules = await listActiveSchedules(locCode);
    response.status(200).json({ data: schedules });
  }),
);
