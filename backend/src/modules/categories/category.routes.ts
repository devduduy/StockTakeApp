import { Router } from "express";
import { authenticate } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { listCategories } from "./category.repository.js";

export const categoryRouter = Router();

categoryRouter.get(
  "/",
  authenticate,
  asyncHandler(async (_request, response) => {
    const categories = await listCategories();
    response.status(200).json({ data: categories });
  }),
);
