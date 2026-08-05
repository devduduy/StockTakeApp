import sql from "mssql";
import { env } from "../../config/env.js";
import { getSqlPool } from "../../db/sql.js";
import type { LocationResponse } from "./location.types.js";

interface LocationRow {
  loc_code: string;
  loc_name: string | null;
}

function mapLocation(row: LocationRow): LocationResponse {
  return {
    code: row.loc_code.trim(),
    name: row.loc_name?.trim() || row.loc_code.trim(),
  };
}

export async function listLocations(locCode?: string): Promise<LocationResponse[]> {
  if (env.SQL_MODE === "mock") {
    const locations = [
      { code: "6168", name: "HERO SUPERMARKET 6168" },
      { code: "1001", name: "HERO SUPERMARKET 1001" },
    ];
    return locCode ? locations.filter((location) => location.code === locCode) : locations;
  }

  const pool = await getSqlPool();
  const result = await pool
    .request()
    .input("locCode", sql.Char(4), locCode ?? null)
    .query<LocationRow>(`
      SELECT TOP (500)
        RTRIM(floccode) AS loc_code,
        RTRIM(flocname) AS loc_name
      FROM MasterData.dbo.MFLOCATION
      WHERE (@locCode IS NULL
         OR floccode COLLATE DATABASE_DEFAULT = @locCode COLLATE DATABASE_DEFAULT)
         AND fstatus = 'Y' 
         AND floctype NOT IN ('H', 'W')
      ORDER BY flocname;
    `);
  return result.recordset.map(mapLocation);
}
