import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/app-error.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { lookupItemByBarcode } from "./item.repository.js";

const querySchema = z.object({
  barcode: z.string().trim().min(1).max(50),
  scheduleId: z.coerce.number().int().positive().safe().optional(),
});

export const itemRouter = Router();

itemRouter.get(
  "/lookup",
  authenticate,
  asyncHandler(async (request, response) => {
    const { barcode, scheduleId } = querySchema.parse(request.query);
    const item = await lookupItemByBarcode(barcode, scheduleId);
    if (!item) {
      throw new AppError(
        404,
        "Barcode tidak ditemukan di master item.",
        "ITEM_NOT_FOUND",
      );
    }

    response.status(200).json({ data: item });
  }),
);
