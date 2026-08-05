import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/app-error.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { isInventoryControl } from "../../shared/roles.js";
import { listLocations } from "./location.repository.js";

export const locationRouter = Router();

locationRouter.get(
  "/",
  authenticate,
  asyncHandler(async (request, response) => {
    const locCode = request.auth?.locCode;
    if (!locCode) {
      throw new AppError(400, "LOC_CODE user belum tersedia.", "LOC_CODE_REQUIRED");
    }
    const locations = await listLocations(isInventoryControl(request.auth) ? undefined : locCode);
    response.status(200).json({ data: locations });
  }),
);
