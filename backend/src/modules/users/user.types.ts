export interface RoleResponse {
  id: number;
  code: string;
  name: string;
  status: string;
}

export interface ManagedUserResponse {
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

export interface UserMutatePayload {
  username: string;
  fullName: string;
  roleId: number;
  locCode: string;
  status: "ACTIVE" | "INACTIVE";
  password?: string | undefined;
  usernameActor: string;
}

export interface UserImportRowPayload {
  username: string;
  fullName: string;
  password?: string | undefined;
  roleCode: string;
  locCode: string;
  status?: "ACTIVE" | "INACTIVE";
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
