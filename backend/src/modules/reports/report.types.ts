export interface ReportScheduleInfo {
  id: string;
  scheduleNo: string;
  scheduleDesc: string;
  locCode: string;
  locationName: string;
  startDate: string;
  endDate: string;
  cutOffDate: string;
  stockTypeName: string;
  status: string;
}

export interface AddressReportRow {
  date: string;
  branch: string;
  skuCode: string;
  skuName: string;
  address: string;
  scannedQty: number;
}

export interface VarianceReportRow {
  stockTakeRequestNumber: string;
  stockTakeRequestName: string;
  store: string;
  startDate: string;
  endDate: string;
  stockTakeSubmissionDate: string;
  stockTakeSubmissionType: string;
  status: string;
  division: string;
  department: string;
  category: string;
  article: string;
  itemBarcode: string;
  articleDescription: string;
  sohQty: number;
  qtyCounted: number;
  stockTakeVarianceQty: number;
  stockTakeVarianceValue: number;
  totalStockTakeVarianceValueByCategory: number;
  grandTotal: number;
}

export interface CategorySummaryReportRow {
  no: number;
  entryDate: string;
  categoryCode: string;
  categoryDescription: string;
  cost: number;
  sohQty: number;
  countedQty: number;
  sohValue: number;
  diffQty: number;
  diffValue: number;
}

export interface Top30ByCategoryReportRow {
  no: number;
  category: string;
  productNo: string;
  productName: string;
  itemBarcode: string;
  locationQty: string;
  uom: string;
  stockBefore: number;
  sohQty: number;
  countedQty: number;
  diffQty: number;
  diffValue: number;
}

export interface ReportSummary {
  totalSku: number;
  totalAddress: number;
  sohQty: number;
  countedQty: number;
  varianceQty: number;
  varianceValue: number;
}

export interface ReportReadiness {
  hasSoh: boolean;
  hasScan: boolean;
  sohRowCount: number;
  scanRowCount: number;
  warnings: string[];
}

export interface StockTakeReportBundle {
  schedule: ReportScheduleInfo;
  readiness: ReportReadiness;
  summary: ReportSummary;
  addressRows: AddressReportRow[];
  varianceRows: VarianceReportRow[];
  categorySummaryRows: CategorySummaryReportRow[];
  top30Rows: Top30ByCategoryReportRow[];
}
