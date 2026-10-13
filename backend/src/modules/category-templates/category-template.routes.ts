import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/app-error.js";
import { asyncHandler } from "../../shared/async-handler.js";
import {
  activateCategoryTemplate,
  createCategoryTemplate,
  deactivateCategoryTemplate,
  findCategoryTemplate,
  listCategoryTemplates,
  updateCategoryTemplate,
} from "./category-template.repository.js";

const paramsSchema = z.object({
  templateId: z.coerce.number().int().positive().safe(),
});

const categoryTemplatePayloadSchema = z.object({
  templateName: z.string().trim().min(2).max(150),
  description: z.string().trim().max(500).nullable().optional(),
  categoryIds: z.array(z.string().trim().min(1).max(30)).min(1),
});

export const categoryTemplateRouter = Router();

function assertCanManageCategoryTemplate(roleCode: string | undefined): void {
  if (roleCode !== "INVENTORY_CONTROL") {
    throw new AppError(403, "Hanya Inventory Control yang boleh mengelola template category.", "FORBIDDEN");
  }
}

categoryTemplateRouter.get(
  "/",
  authenticate,
  asyncHandler(async (_request, response) => {
    const templates = await listCategoryTemplates();
    response.status(200).json({ data: templates });
  }),
);

categoryTemplateRouter.get(
  "/:templateId",
  authenticate,
  asyncHandler(async (request, response) => {
    const { templateId } = paramsSchema.parse(request.params);
    const template = await findCategoryTemplate(templateId);
    if (!template) {
      throw new AppError(404, "Template category tidak ditemukan.", "CATEGORY_TEMPLATE_NOT_FOUND");
    }
    response.status(200).json({ data: template });
  }),
);

categoryTemplateRouter.post(
  "/",
  authenticate,
  asyncHandler(async (request, response) => {
    assertCanManageCategoryTemplate(request.auth?.roleCode);
    const body = categoryTemplatePayloadSchema.parse(request.body);
    const template = await createCategoryTemplate({
      ...body,
      description: body.description ?? null,
      username: request.auth?.username ?? "SYSTEM",
    });
    response.status(201).json({ data: template });
  }),
);

categoryTemplateRouter.put(
  "/:templateId",
  authenticate,
  asyncHandler(async (request, response) => {
    assertCanManageCategoryTemplate(request.auth?.roleCode);
    const { templateId } = paramsSchema.parse(request.params);
    const body = categoryTemplatePayloadSchema.parse(request.body);
    const template = await updateCategoryTemplate(templateId, {
      ...body,
      description: body.description ?? null,
      username: request.auth?.username ?? "SYSTEM",
    });
    response.status(200).json({ data: template });
  }),
);

categoryTemplateRouter.post(
  "/:templateId/activate",
  authenticate,
  asyncHandler(async (request, response) => {
    assertCanManageCategoryTemplate(request.auth?.roleCode);
    const { templateId } = paramsSchema.parse(request.params);
    const template = await activateCategoryTemplate(templateId, request.auth?.username ?? "SYSTEM");
    response.status(200).json({ data: template });
  }),
);

categoryTemplateRouter.delete(
  "/:templateId",
  authenticate,
  asyncHandler(async (request, response) => {
    assertCanManageCategoryTemplate(request.auth?.roleCode);
    const { templateId } = paramsSchema.parse(request.params);
    const template = await deactivateCategoryTemplate(templateId, request.auth?.username ?? "SYSTEM");
    response.status(200).json({ data: template });
  }),
);
