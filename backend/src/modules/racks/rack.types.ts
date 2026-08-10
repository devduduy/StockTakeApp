export interface RackResponse {
  id: string;
  rackCode: string;
  rackName: string;
  locCode: string;
  status: string;
  localDraftCount: number;
  submittedLineCount: number;
  submittedQuantity: number;
  finalQuantity: number;
  printedLineCount: number;
  printed: boolean;
  rackStatus: "EMPTY" | "SUBMITTED" | "PRINTED" | "CONFIRMED" | "REJECTED";
  confirmedLineCount: number;
  rejectedLineCount: number;
  discrepancyQuantity: number;
}

export interface RackMasterResponse {
  id: string;
  rackCode: string;
  rackName: string;
  locCode: string;
  status: string;
}

export interface CreateRackPayload {
  rackCode: string;
  rackName: string;
  locCode: string;
  status: "ACTIVE" | "INACTIVE";
  username: string;
}

export interface CreateRackBulkPayload {
  locCode: string;
  letterCode: string;
  startSequence: number;
  count: number;
  rackNamePrefix: string;
  status: "ACTIVE" | "INACTIVE";
  username: string;
}
