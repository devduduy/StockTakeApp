export interface SohScheduleSummary {
  scheduleId: string;
  scheduleNo: string;
  scheduleDesc: string;
  locCode: string;
  locationName: string;
  cutOffDate: string;
  sohRowCount: number;
  totalErpQty: number;
  generatedAt: string | null;
  lastGeneratedBy: string | null;
  sourceRowCount: number;
  validSourceRowCount: number;
}

export interface SohGenerateResponse extends SohScheduleSummary {
  replacedRowCount: number;
  insertedRowCount: number;
  skippedSourceRowCount: number;
}
