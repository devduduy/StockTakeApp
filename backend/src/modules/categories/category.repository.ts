import sql from "mssql";
import { env } from "../../config/env.js";
import { getSqlPool } from "../../db/sql.js";
import type { CategoryResponse } from "./category.types.js";

interface CategoryRow {
  category_id: string;
  category_name: string;
  department_id: string;
  department_name: string;
  division_id: string;
  division_name: string;
}

function mapCategory(row: CategoryRow): CategoryResponse {
  return {
    id: row.category_id.trim(),
    name: row.category_name.trim(),
    department: {
      id: row.department_id.trim(),
      name: row.department_name.trim(),
    },
    division: {
      id: row.division_id.trim(),
      name: row.division_name.trim(),
    },
  };
}

export async function listCategories(): Promise<CategoryResponse[]> {
  if (env.SQL_MODE === "mock") {
    return [
      {
        id: "40601",
        name: "SEAFOOD",
        department: { id: "406", name: "SEAFOOD" },
        division: { id: "4", name: "FRESH" },
      },
      {
        id: "10101",
        name: "BREAKFAST FOOD",
        department: { id: "101", name: "FOOD 1" },
        division: { id: "1", name: "GROCERY" },
      },
    ];
  }

  const pool = await getSqlPool();
  const result = await pool.request().query<CategoryRow>(`
    SELECT
      RTRIM(c.fcatcd) AS category_id,
      RTRIM(c.fcatnm) AS category_name,
      RTRIM(d.fdepcd) AS department_id,
      RTRIM(d.fdepnm) AS department_name,
      RTRIM(v.fdivcd) AS division_id,
      RTRIM(v.fdivnm) AS division_name
    FROM MasterData.dbo.MFCATEGORY c
    INNER JOIN MasterData.dbo.MFDEPARTMENT d
      ON d.fdepcd = c.fdepcd
    INNER JOIN MasterData.dbo.MFDIVISION v
      ON v.fdivcd = d.fdivcd
    ORDER BY v.fdivcd, d.fdepcd, c.fcatcd;
  `);
  return result.recordset.map(mapCategory);
}

export async function listCategoriesByIds(
  categoryIds: string[],
): Promise<CategoryResponse[]> {
  if (categoryIds.length === 0) {
    return [];
  }
  if (env.SQL_MODE === "mock") {
    const categories = await listCategories();
    return categories.filter((category) => categoryIds.includes(category.id));
  }

  const pool = await getSqlPool();
  const result = await pool
    .request()
    .input("categoryIds", sql.VarChar(sql.MAX), categoryIds.join(","))
    .query<CategoryRow>(`
      SELECT
        RTRIM(c.fcatcd) AS category_id,
        RTRIM(c.fcatnm) AS category_name,
        RTRIM(d.fdepcd) AS department_id,
        RTRIM(d.fdepnm) AS department_name,
        RTRIM(v.fdivcd) AS division_id,
        RTRIM(v.fdivnm) AS division_name
      FROM MasterData.dbo.MFCATEGORY c
      INNER JOIN MasterData.dbo.MFDEPARTMENT d
        ON d.fdepcd = c.fdepcd
      INNER JOIN MasterData.dbo.MFDIVISION v
        ON v.fdivcd = d.fdivcd
      WHERE RTRIM(c.fcatcd) COLLATE DATABASE_DEFAULT IN (
        SELECT RTRIM(value) FROM STRING_SPLIT(@categoryIds, ',')
      )
      ORDER BY v.fdivcd, d.fdepcd, c.fcatcd;
    `);
  return result.recordset.map(mapCategory);
}
