import sql from "mssql";
import { env } from "../../config/env.js";
import { getSqlPool } from "../../db/sql.js";
import { AppError } from "../../shared/app-error.js";
import { mockCategoryTemplates } from "../../shared/mock-data.js";
import { listCategoriesByIds } from "../categories/category.repository.js";
import type { CategoryTemplateMutatePayload, CategoryTemplateResponse } from "./category-template.types.js";

interface CategoryTemplateRow {
  id: string | number;
  template_name: string;
  description: string | null;
  status: string;
  category_id: string | null;
  date_created: Date | string | null;
  date_modified: Date | string | null;
}

function isoDateTime(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function uniqueCategoryIds(categoryIds: string[]): string[] {
  return [...new Set(categoryIds.map((categoryId) => categoryId.trim()).filter(Boolean))];
}

async function assertValidPayload(payload: CategoryTemplateMutatePayload, templateId?: number): Promise<string[]> {
  const templateName = normalizeName(payload.templateName);
  if (!templateName) {
    throw new AppError(400, "Nama template wajib diisi.", "CATEGORY_TEMPLATE_NAME_REQUIRED");
  }

  const categoryIds = uniqueCategoryIds(payload.categoryIds);
  if (categoryIds.length === 0) {
    throw new AppError(400, "Template wajib memiliki minimal satu category.", "CATEGORY_TEMPLATE_CATEGORY_REQUIRED");
  }

  const categories = await listCategoriesByIds(categoryIds);
  if (categories.length !== categoryIds.length) {
    throw new AppError(400, "Ada category yang tidak ditemukan di MasterData.", "CATEGORY_TEMPLATE_CATEGORY_NOT_FOUND");
  }

  return categoryIds;
}

async function assertUniqueActiveTemplateName(templateName: string, templateId?: number): Promise<void> {
  if (env.SQL_MODE === "mock") {
    const duplicate = mockCategoryTemplates.some((template) =>
      Number(template.id) !== templateId &&
      template.status === "ACTIVE" &&
      template.templateName.trim().toLowerCase() === templateName.toLowerCase(),
    );
    if (duplicate) {
      throw new AppError(409, "Nama template active sudah digunakan.", "CATEGORY_TEMPLATE_NAME_EXISTS");
    }
    return;
  }

  const pool = await getSqlPool();
  const duplicate = await pool
    .request()
    .input("templateName", sql.NVarChar(150), templateName)
    .input("templateId", sql.BigInt, templateId ?? null)
    .query<{ duplicate_count: number }>(`
      SELECT COUNT(1) AS duplicate_count
      FROM dbo.MST_CATEGORY_TEMPLATE
      WHERE STATUS = 'ACTIVE'
        AND UPPER(LTRIM(RTRIM(TEMPLATE_NAME))) = UPPER(@templateName)
        AND (@templateId IS NULL OR ID <> @templateId);
    `);
  if ((duplicate.recordset[0]?.duplicate_count ?? 0) > 0) {
    throw new AppError(409, "Nama template active sudah digunakan.", "CATEGORY_TEMPLATE_NAME_EXISTS");
  }
}

async function mapTemplate(
  template: {
    id: string | number;
    templateName: string;
    description: string | null;
    status: string;
    categoryIds: string[];
    dateCreated?: Date | string | null;
    dateModified?: Date | string | null;
  },
): Promise<CategoryTemplateResponse> {
  const categoryIds = uniqueCategoryIds(template.categoryIds);
  return {
    id: String(template.id),
    templateName: template.templateName.trim(),
    description: template.description,
    status: template.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
    categoryIds,
    categories: await listCategoriesByIds(categoryIds),
    categoryCount: categoryIds.length,
    dateCreated: isoDateTime(template.dateCreated),
    dateModified: isoDateTime(template.dateModified),
  };
}

async function mapSqlRows(rows: CategoryTemplateRow[]): Promise<CategoryTemplateResponse[]> {
  const grouped = new Map<string, {
    id: string | number;
    templateName: string;
    description: string | null;
    status: string;
    categoryIds: string[];
    dateCreated: Date | string | null;
    dateModified: Date | string | null;
  }>();

  for (const row of rows) {
    const key = String(row.id);
    const current = grouped.get(key) ?? {
      id: row.id,
      templateName: row.template_name,
      description: row.description,
      status: row.status,
      categoryIds: [],
      dateCreated: row.date_created,
      dateModified: row.date_modified,
    };
    if (row.category_id) {
      current.categoryIds.push(row.category_id.trim());
    }
    grouped.set(key, current);
  }

  return Promise.all([...grouped.values()].map(mapTemplate));
}

export async function listCategoryTemplates(): Promise<CategoryTemplateResponse[]> {
  if (env.SQL_MODE === "mock") {
    return Promise.all(mockCategoryTemplates.map((template) => mapTemplate(template)));
  }

  const pool = await getSqlPool();
  const result = await pool.request().query<CategoryTemplateRow>(`
    SELECT
      template.ID AS id,
      template.TEMPLATE_NAME AS template_name,
      template.DESCRIPTION AS description,
      template.STATUS AS status,
      detail.CATEGORY_ID AS category_id,
      template.DATE_CREATED AS date_created,
      template.DATE_MODIFIED AS date_modified
    FROM dbo.MST_CATEGORY_TEMPLATE template
    LEFT JOIN dbo.MST_CATEGORY_TEMPLATE_DETAIL detail
      ON detail.TEMPLATE_ID = template.ID
    ORDER BY
      CASE WHEN template.STATUS = 'ACTIVE' THEN 0 ELSE 1 END,
      template.TEMPLATE_NAME,
      detail.CATEGORY_ID;
  `);
  return mapSqlRows(result.recordset);
}

export async function findCategoryTemplate(templateId: number): Promise<CategoryTemplateResponse | null> {
  if (env.SQL_MODE === "mock") {
    const template = mockCategoryTemplates.find((candidate) => Number(candidate.id) === templateId);
    return template ? mapTemplate(template) : null;
  }

  const pool = await getSqlPool();
  const result = await pool
    .request()
    .input("templateId", sql.BigInt, templateId)
    .query<CategoryTemplateRow>(`
      SELECT
        template.ID AS id,
        template.TEMPLATE_NAME AS template_name,
        template.DESCRIPTION AS description,
        template.STATUS AS status,
        detail.CATEGORY_ID AS category_id,
        template.DATE_CREATED AS date_created,
        template.DATE_MODIFIED AS date_modified
      FROM dbo.MST_CATEGORY_TEMPLATE template
      LEFT JOIN dbo.MST_CATEGORY_TEMPLATE_DETAIL detail
        ON detail.TEMPLATE_ID = template.ID
      WHERE template.ID = @templateId
      ORDER BY detail.CATEGORY_ID;
    `);
  const templates = await mapSqlRows(result.recordset);
  return templates[0] ?? null;
}

export async function createCategoryTemplate(payload: CategoryTemplateMutatePayload): Promise<CategoryTemplateResponse> {
  const categoryIds = await assertValidPayload(payload);
  const templateName = normalizeName(payload.templateName);
  const description = payload.description?.trim() || null;
  await assertUniqueActiveTemplateName(templateName);

  if (env.SQL_MODE === "mock") {
    const nextId = String(Math.max(0, ...mockCategoryTemplates.map((template) => Number(template.id))) + 1);
    mockCategoryTemplates.push({
      id: nextId,
      templateName,
      description,
      status: "ACTIVE",
      categoryIds,
      userCreated: payload.username,
      dateCreated: new Date().toISOString(),
      dateModified: null,
    });
    return (await findCategoryTemplate(Number(nextId)))!;
  }

  const pool = await getSqlPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const insert = await transaction
      .request()
      .input("templateName", sql.NVarChar(150), templateName)
      .input("description", sql.NVarChar(500), description)
      .input("username", sql.VarChar(100), payload.username)
      .query<{ id: string | number }>(`
        INSERT INTO dbo.MST_CATEGORY_TEMPLATE (
          TEMPLATE_NAME,
          DESCRIPTION,
          STATUS,
          USER_CREATED
        )
        OUTPUT CAST(INSERTED.ID AS varchar(30)) AS id
        VALUES (
          @templateName,
          @description,
          'ACTIVE',
          @username
        );
      `);
    const templateId = Number(insert.recordset[0]?.id);
    for (const categoryId of categoryIds) {
      await transaction
        .request()
        .input("templateId", sql.BigInt, templateId)
        .input("categoryId", sql.VarChar(30), categoryId)
        .input("username", sql.VarChar(100), payload.username)
        .query(`
          INSERT INTO dbo.MST_CATEGORY_TEMPLATE_DETAIL (
            TEMPLATE_ID,
            CATEGORY_ID,
            USER_CREATED
          )
          VALUES (
            @templateId,
            @categoryId,
            @username
          );
        `);
    }
    await transaction.commit();
    return (await findCategoryTemplate(templateId))!;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function updateCategoryTemplate(
  templateId: number,
  payload: CategoryTemplateMutatePayload,
): Promise<CategoryTemplateResponse> {
  const categoryIds = await assertValidPayload(payload, templateId);
  const templateName = normalizeName(payload.templateName);
  const description = payload.description?.trim() || null;
  const currentTemplate = await findCategoryTemplate(templateId);
  if (!currentTemplate) {
    throw new AppError(404, "Template category tidak ditemukan.", "CATEGORY_TEMPLATE_NOT_FOUND");
  }
  if (currentTemplate.status === "ACTIVE") {
    await assertUniqueActiveTemplateName(templateName, templateId);
  }

  if (env.SQL_MODE === "mock") {
    const template = mockCategoryTemplates.find((candidate) => Number(candidate.id) === templateId);
    if (!template) throw new AppError(404, "Template category tidak ditemukan.", "CATEGORY_TEMPLATE_NOT_FOUND");
    template.templateName = templateName;
    template.description = description;
    template.categoryIds = categoryIds;
    template.userModified = payload.username;
    template.dateModified = new Date().toISOString();
    return (await findCategoryTemplate(templateId))!;
  }

  const pool = await getSqlPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    const update = await transaction
      .request()
      .input("templateId", sql.BigInt, templateId)
      .input("templateName", sql.NVarChar(150), templateName)
      .input("description", sql.NVarChar(500), description)
      .input("username", sql.VarChar(100), payload.username)
      .query<{ affected_count: number }>(`
        UPDATE dbo.MST_CATEGORY_TEMPLATE
        SET TEMPLATE_NAME = @templateName,
            DESCRIPTION = @description,
            USER_MODIFIED = @username,
            DATE_MODIFIED = SYSUTCDATETIME()
        WHERE ID = @templateId;

        SELECT @@ROWCOUNT AS affected_count;
      `);
    if ((update.recordset[0]?.affected_count ?? 0) === 0) {
      throw new AppError(404, "Template category tidak ditemukan.", "CATEGORY_TEMPLATE_NOT_FOUND");
    }

    await transaction
      .request()
      .input("templateId", sql.BigInt, templateId)
      .query(`DELETE FROM dbo.MST_CATEGORY_TEMPLATE_DETAIL WHERE TEMPLATE_ID = @templateId;`);

    for (const categoryId of categoryIds) {
      await transaction
        .request()
        .input("templateId", sql.BigInt, templateId)
        .input("categoryId", sql.VarChar(30), categoryId)
        .input("username", sql.VarChar(100), payload.username)
        .query(`
          INSERT INTO dbo.MST_CATEGORY_TEMPLATE_DETAIL (
            TEMPLATE_ID,
            CATEGORY_ID,
            USER_CREATED
          )
          VALUES (
            @templateId,
            @categoryId,
            @username
          );
        `);
    }

    await transaction.commit();
    return (await findCategoryTemplate(templateId))!;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function deactivateCategoryTemplate(templateId: number, username: string): Promise<CategoryTemplateResponse> {
  if (env.SQL_MODE === "mock") {
    const template = mockCategoryTemplates.find((candidate) => Number(candidate.id) === templateId);
    if (!template) {
      throw new AppError(404, "Template category tidak ditemukan.", "CATEGORY_TEMPLATE_NOT_FOUND");
    }
    template.status = "INACTIVE";
    template.userModified = username;
    template.dateModified = new Date().toISOString();
    return (await findCategoryTemplate(templateId))!;
  }

  const pool = await getSqlPool();
  const result = await pool
    .request()
    .input("templateId", sql.BigInt, templateId)
    .input("username", sql.VarChar(100), username)
    .query<{ affected_count: number }>(`
      UPDATE dbo.MST_CATEGORY_TEMPLATE
      SET STATUS = 'INACTIVE',
          USER_MODIFIED = @username,
          DATE_MODIFIED = SYSUTCDATETIME()
      WHERE ID = @templateId;

      SELECT @@ROWCOUNT AS affected_count;
    `);
  if ((result.recordset[0]?.affected_count ?? 0) === 0) {
    throw new AppError(404, "Template category tidak ditemukan.", "CATEGORY_TEMPLATE_NOT_FOUND");
  }
  return (await findCategoryTemplate(templateId))!;
}

export async function activateCategoryTemplate(templateId: number, username: string): Promise<CategoryTemplateResponse> {
  const template = await findCategoryTemplate(templateId);
  if (!template) {
    throw new AppError(404, "Template category tidak ditemukan.", "CATEGORY_TEMPLATE_NOT_FOUND");
  }
  await assertUniqueActiveTemplateName(template.templateName, templateId);

  if (env.SQL_MODE === "mock") {
    const mockTemplate = mockCategoryTemplates.find((candidate) => Number(candidate.id) === templateId)!;
    mockTemplate.status = "ACTIVE";
    mockTemplate.userModified = username;
    mockTemplate.dateModified = new Date().toISOString();
    return (await findCategoryTemplate(templateId))!;
  }

  const pool = await getSqlPool();
  const result = await pool
    .request()
    .input("templateId", sql.BigInt, templateId)
    .input("username", sql.VarChar(100), username)
    .query<{ affected_count: number }>(`
      UPDATE dbo.MST_CATEGORY_TEMPLATE
      SET STATUS = 'ACTIVE',
          USER_MODIFIED = @username,
          DATE_MODIFIED = SYSUTCDATETIME()
      WHERE ID = @templateId;

      SELECT @@ROWCOUNT AS affected_count;
    `);
  if ((result.recordset[0]?.affected_count ?? 0) === 0) {
    throw new AppError(404, "Template category tidak ditemukan.", "CATEGORY_TEMPLATE_NOT_FOUND");
  }
  return (await findCategoryTemplate(templateId))!;
}
