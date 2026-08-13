export interface ActiveSchedule {
  id: string;
  scheduleNo: string;
  scheduleDesc: string;
  locCode: string;
  location: {
    code: string;
    name: string;
  };
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
  categories: Array<{
    id: string;
    name: string;
    department: {
      id: string;
      name: string;
    };
    division: {
      id: string;
      name: string;
    };
  }>;
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

export type ScheduleStockType = "ALL" | "PARTIAL";
export type EditableScheduleStatus = "DRAFT" | "OPEN";

export interface ScheduleMutatePayload {
  locCode: string;
  startDate: string;
  endDate: string;
  cutOffDate: string;
  startTime: string | null;
  endTime: string | null;
  stockType: ScheduleStockType;
  categoryIds: string[];
  rackIds: string[];
  status: EditableScheduleStatus;
  username: string;
}
