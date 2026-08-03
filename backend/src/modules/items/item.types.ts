export interface ItemLookupResponse {
  barcode: string;
  plu: string;
  pluDescription: string;
  category: {
    id: string;
    name: string;
  };
  erpQty: number;
  source: "MFBARCODE" | "MFPLU" | "MST_SOH" | "MOCK";
}
