import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { assertCanAccessSchedule } from "../../shared/schedule-access.js";
import { findScheduleLocation } from "../schedules/schedule.repository.js";
import { buildStockTakeReportBundle } from "./report.repository.js";
import { AppError } from "../../shared/app-error.js";
import type { StockTakeReportBundle } from "./report.types.js";

const paramsSchema = z.object({
  scheduleId: z.coerce.number().int().positive().safe(),
});

const querySchema = z.object({
  categoryId: z.string().trim().min(1).max(30).optional(),
  section: z.enum(["ALL", "ADDRESS", "VARIANCE", "CATEGORY", "TOP_BOTTOM"]).default("ALL"),
});

const csvExportQuerySchema = z.object({
  scheduleIds: z.string().trim().min(1),
  type: z.enum(["ADDRESS", "VARIANCE"]),
  categoryId: z.string().trim().min(1).max(30).optional(),
});

export const reportRouter = Router();

function parseScheduleIds(value: string): number[] {
  const ids = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number(item));
  if (ids.length === 0 || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new AppError(400, "Schedule export tidak valid.", "INVALID_SCHEDULE_IDS");
  }
  return [...new Set(ids)];
}

function csvCell(value: string | number | null | undefined): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvLine(row: Array<string | number | null | undefined>): string {
  return row.map((cell) => csvCell(cell)).join(",");
}

function decimal(value: number): string {
  return (Number.isFinite(value) ? value : 0).toFixed(3);
}

function exportFileName(type: "ADDRESS" | "VARIANCE"): string {
  const prefix = type === "ADDRESS" ? "stock_take_address_report" : "stock_take_variance_report";
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  return `${prefix}_${stamp}.csv`;
}

function buildAddressCsv(reports: StockTakeReportBundle[]): string {
  const lines = [
    csvLine(["Date", "Branch", "SKU Code", "SKU Name", "Address", "Scanned Qty"]),
  ];
  for (const report of reports) {
    for (const row of report.addressRows) {
      lines.push(csvLine([
        row.date,
        row.branch,
        row.skuCode,
        row.skuName,
        row.address,
        decimal(row.scannedQty),
      ]));
    }
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function buildVarianceCsv(reports: StockTakeReportBundle[]): string {
  const lines = [
    csvLine([
      "Stock Take Request Number",
      "Stock Take Request Name",
      "Store",
      "Start Date",
      "End Date",
      "Stock Take Submission Date",
      "Stock Take Submission Type",
      "Status",
      "Division",
      "Department",
      "Category",
      "Article",
      "Item Barcode",
      "Article Description",
      "SOH Qty",
      "Qty Counted",
      "Stock Take Variance Qty",
      "Stock Take Variance Value",
      "Total Stock Take Variance Value by Category",
      "Grand Total",
    ]),
  ];
  for (const report of reports) {
    for (const row of report.varianceRows) {
      lines.push(csvLine([
        row.stockTakeRequestNumber,
        row.stockTakeRequestName,
        row.store,
        row.startDate,
        row.endDate,
        row.stockTakeSubmissionDate,
        row.stockTakeSubmissionType,
        row.status,
        row.division,
        row.department,
        row.category,
        row.article,
        row.itemBarcode,
        row.articleDescription,
        decimal(row.sohQty),
        decimal(row.qtyCounted),
        decimal(row.stockTakeVarianceQty),
        decimal(row.stockTakeVarianceValue),
        decimal(row.totalStockTakeVarianceValueByCategory),
        decimal(row.grandTotal),
      ]));
    }
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

reportRouter.get(
  "/export/csv",
  authenticate,
  asyncHandler(async (request, response) => {
    const query = csvExportQuerySchema.parse(request.query);
    const scheduleIds = parseScheduleIds(query.scheduleIds);
    const reports: StockTakeReportBundle[] = [];

    for (const scheduleId of scheduleIds) {
      const schedule = await findScheduleLocation(scheduleId);
      if (!schedule) {
        throw new AppError(404, `Schedule ${scheduleId} tidak ditemukan.`, "SCHEDULE_NOT_FOUND");
      }
      await assertCanAccessSchedule(
        request.auth,
        scheduleId,
        schedule.locCode,
        "User tidak memiliki akses ke report schedule ini.",
      );
      reports.push(await buildStockTakeReportBundle(scheduleId, query.categoryId, query.type));
    }

    const warnings = reports.flatMap((report) =>
      report.readiness.warnings.map((warning) => `${report.schedule.scheduleNo}: ${warning}`),
    );
    const content = query.type === "ADDRESS" ? buildAddressCsv(reports) : buildVarianceCsv(reports);
    const fileName = exportFileName(query.type);

    if (warnings.length > 0) {
      response.setHeader("x-report-warnings", encodeURIComponent([...new Set(warnings)].join(" ")));
    }
    response.setHeader("content-type", "text/csv; charset=utf-8");
    response.setHeader("content-disposition", `attachment; filename="${fileName}"`);
    response.status(200).send(content);
  }),
);

reportRouter.get(
  "/:scheduleId",
  authenticate,
  asyncHandler(async (request, response) => {
    const { scheduleId } = paramsSchema.parse(request.params);
    const { categoryId, section } = querySchema.parse(request.query);
    const schedule = await findScheduleLocation(scheduleId);
    if (!schedule) {
      throw new AppError(404, "Schedule tidak ditemukan.", "SCHEDULE_NOT_FOUND");
    }

    await assertCanAccessSchedule(
      request.auth,
      scheduleId,
      schedule.locCode,
      "User tidak memiliki akses ke report schedule ini.",
    );

    const report = await buildStockTakeReportBundle(scheduleId, categoryId, section);
    response.status(200).json({ data: report });
  }),
);
