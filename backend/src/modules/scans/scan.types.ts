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

export interface RackScanLineResponse {
  id: string;
  clientScanId: string;
  rackSeq: number;
  barcode: string;
  plu: string;
  pluDescription: string;
  scanQty: number;
  finalQty: number;
  discrepancyQty: number;
  inputType: "SCAN" | "MANUAL";
  scanStatus: string;
  printNo: string | null;
  recheckUser: string | null;
  confirmUser: string | null;
  confirmTime: string | null;
  dateCreated: string;
  dateModified: string | null;
}

export interface RackFinalQuantityLineInput {
  scanId: number;
  finalQty: number;
}

export interface UpdateRackFinalQuantitiesInput {
  scheduleId: number;
  rackId: number;
  username: string;
  recheckUser: string;
  lines: RackFinalQuantityLineInput[];
}

export interface ConfirmRackInput extends UpdateRackFinalQuantitiesInput {}

export interface RejectRackInput {
  scheduleId: number;
  rackId: number;
  username: string;
}

export interface PrintRackScansInput {
  scheduleId: number;
  rackId: number;
  username: string;
}

export interface PrintRackScansResponse {
  printNo: string;
  printTime: string;
  printedLineCount: number;
  printedQuantity: number;
}
