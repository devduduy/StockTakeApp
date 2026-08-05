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
  status: string;
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

export interface SchedulePayload {
  scheduleDesc: string;
  locCode: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  stockType: 'ALL' | 'PARTIAL';
  categoryIds: string[];
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
  startTime: string | null;
  endTime: string | null;
  stockType: {
    id: number;
    code: string;
    name: string;
    value: string | null;
  };
  categoryIds: string[];
  categories: Category[];
  status: string;
  progress: {
    totalRack: number;
    rackWithSubmittedScan: number;
    percentage: number;
  };
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
  printedLineCount: number;
  printed: boolean;
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
  inputType: 'SCAN' | 'MANUAL';
  scanStatus: string;
  printNo: string | null;
  dateCreated: string;
  dateModified: string | null;
}

export interface RackScanListResponse {
  scans: RackScan[];
}

export interface DashboardSnapshot {
  schedules: ActiveSchedule[];
  totalRacks: number;
  submittedRacks: number;
  totalLines: number;
  totalQuantity: number;
}
