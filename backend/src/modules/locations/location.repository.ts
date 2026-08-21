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

export async function listLocations(locCode?: string | string[]): Promise<LocationResponse[]> {
  if (env.SQL_MODE === "mock") {
    const locations = [
      { code: "6168", name: "HERO SUPERMARKET 6168" },
      { code: "1001", name: "HERO SUPERMARKET 1001" },
    ];
    const locCodes = Array.isArray(locCode) ? locCode : locCode ? [locCode] : [];
    return locCodes.length > 0 ? locations.filter((location) => locCodes.includes(location.code)) : locations;
  }

  const pool = await getSqlPool();
  const locCodes = Array.isArray(locCode) ? locCode : locCode ? [locCode] : [];
  const result = await pool
    .request()
    .input("locCodes", sql.VarChar(sql.MAX), locCodes.join(",") || null)
    .query<LocationRow>(`
      SELECT TOP (500)
        RTRIM(floccode) AS loc_code,
        RTRIM(flocname) AS loc_name
      FROM MasterData.dbo.MFLOCATION
      WHERE (@locCodes IS NULL
         OR floccode COLLATE DATABASE_DEFAULT IN (
          SELECT value COLLATE DATABASE_DEFAULT FROM STRING_SPLIT(@locCodes, ',')
         ))
         AND fstatus = 'Y' 
         AND floctype NOT IN ('H', 'W')
      ORDER BY flocname;
    `);
  return result.recordset.map(mapLocation);
}
