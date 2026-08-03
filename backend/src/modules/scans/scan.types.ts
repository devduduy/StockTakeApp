export interface ScanSubmitLine {
  clientScanId: string;
  barcode: string;
  plu?: string;
  pluDescription?: string;
  scanQty: number;
  inputType: "SCAN" | "MANUAL";
  clientUpdatedAt?: number;
}

export interface CanonicalScanLine extends ScanSubmitLine {
  plu: string;
  pluDescription: string;
}

export interface SubmitRackScansInput {
  scheduleId: number;
  scheduleNo: string;
  rackId: number;
  rackCode: string;
  username: string;
  lines: CanonicalScanLine[];
}

export interface SubmitRackScansResponse {
  acceptedLines: number;
  insertedLines: number;
  updatedLines: number;
  submittedQuantity: number;
  serverTime: string;
}
