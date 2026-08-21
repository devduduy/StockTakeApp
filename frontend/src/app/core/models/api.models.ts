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
