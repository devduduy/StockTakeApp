export interface ApiEnvelope<T> {
  data: T;
}

export interface ApiErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
    details?: unknown;
  };
}

export interface PageResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  role: {
    id: number;
    code: string;
    name: string;
  };
  locCode: string;
  accessibleLocCodes: string[];
  status: string;
}

export interface UserOption {
  id: string;
  username: string;
  fullName: string;
  roleCode: string;
  locCode: string;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
  user: AuthUser;
}

export interface Category {
  id: string;
  name: string;
  department: { id: string; name: string };
  division: { id: string; name: string };
}

export interface Location {
  code: string;
  name: string;
}

export interface ItemSearchResult {
  barcode: string;
  plu: string;
  pluDescription: string;
}

export interface RoleOption {
  id: number;
  code: string;
  name: string;
  status: string;
}

export interface ManagedUser {
  id: string;
  username: string;
  fullName: string;
  role: {
    id: number;
    code: string;
    name: string;
  };
  locCode: string;
  status: string;
  lastLoginAt: string | null;
}

export interface ManagedUserPayload {
  username: string;
  fullName: string;
  password?: string;
  roleId: number;
  locCode: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface ScheduleUser {
  id: string;
  username: string;
  fullName: string;
  role: {
    id: number;
    code: string;
    name: string;
  };
  locCode: string;
  assigned: boolean;
  assignmentType: 'LOCATION' | 'MANUAL' | 'NONE';
  locked: boolean;
}

export interface UserImportRow {
  username: string;
  fullName: string;
  password?: string;
  roleCode: string;
  locCode: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface UserImportResult {
  created: number;
  updated: number;
  failed: Array<{
    row: number;
    username: string;
    message: string;
  }>;
}

export interface SchedulePayload {
  scheduleDesc?: string;
  locCode: string;
  startDate: string;
  endDate: string;
  cutOffDate: string;
  startTime: string | null;
  endTime: string | null;
  stockType: 'ALL' | 'PARTIAL';
  categoryIds: string[];
  rackIds: string[];
  status: 'DRAFT' | 'OPEN';
}

export interface ActiveSchedule {
  id: string;
  scheduleNo: string;
  scheduleDesc: string;
  locCode: string;
  location: { code: string; name: string };
  scheduleDate: string;
  startDate: string;
  endDate: string;
  cutOffDate: string;
  startTime: string | null;
  endTime: string | null;
  stockType: {
    id: number;
    code: string;
    name: string;
    value: string | null;
  };
  categoryIds: string[];
  rackIds: string[];
  categories: Category[];
  status: string;
  progress: {
    totalRack: number;
    rackWithSubmittedScan: number;
    percentage: number;
  };
}

export interface RackMaster {
  id: string;
  rackCode: string;
  rackName: string;
  locCode: string;
  status: string;
}

export interface RackCreatePayload {
  rackCode: string;
  rackName: string;
  locCode: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface RackBulkCreatePayload {
  letterCode: string;
  startSequence: number;
  count: number;
  rackNamePrefix: string;
  locCode: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface ScheduleRackScopeResponse {
  added: boolean;
  rack: RackMaster;
}

export interface ScheduleLocation {
  id: string;
  scheduleNo: string;
  locCode: string;
  status: string;
  stockTypeCode: string;
  categoryIds: string[];
}

export interface Rack {
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
  rackStatus: 'EMPTY' | 'SUBMITTED' | 'PRINTED' | 'CONFIRMED' | 'REJECTED';
  confirmedLineCount: number;
  rejectedLineCount: number;
  discrepancyQuantity: number;
}

export interface RackListResponse {
  schedule: ScheduleLocation;
  racks: Rack[];
}

export interface RackScan {
  id: string;
  clientScanId: string;
  rackSeq: number;
  barcode: string;
  plu: string;
  pluDescription: string;
  scanQty: number;
  finalQty: number;
  discrepancyQty: number;
  inputType: 'SCAN' | 'MANUAL';
  scanStatus: string;
  printNo: string | null;
  recheckUser: string | null;
  confirmUser: string | null;
  confirmTime: string | null;
  dateCreated: string;
  dateModified: string | null;
}

export interface RackScanListResponse {
  scans: RackScan[];
}

export interface RackFinalQtyLinePayload {
  scanId: string;
  finalQty: number;
}

export interface RackFinalQtyPayload {
  recheckUser: string;
  lines: RackFinalQtyLinePayload[];
}

export interface PrintRackResponse {
  printNo: string;
  printTime: string;
  printedLineCount: number;
  printedQuantity: number;
}

export interface DashboardSnapshot {
  schedules: ActiveSchedule[];
  totalRacks: number;
  submittedRacks: number;
  totalLines: number;
  totalQuantity: number;
}

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
