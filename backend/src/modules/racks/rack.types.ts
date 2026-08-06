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
