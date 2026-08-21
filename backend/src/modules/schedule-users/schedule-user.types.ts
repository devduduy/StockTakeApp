export interface ScheduleUserResponse {
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
  assignmentType: "LOCATION" | "MANUAL" | "NONE";
  locked: boolean;
}
