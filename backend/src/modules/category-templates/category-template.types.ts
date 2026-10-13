import type { CategoryResponse } from "../categories/category.types.js";

export interface CategoryTemplateResponse {
  id: string;
  templateName: string;
  description: string | null;
  status: "ACTIVE" | "INACTIVE";
  categoryIds: string[];
  categories: CategoryResponse[];
  categoryCount: number;
  dateCreated: string | null;
  dateModified: string | null;
}

export interface CategoryTemplateMutatePayload {
  templateName: string;
  description: string | null;
  categoryIds: string[];
  username: string;
}
