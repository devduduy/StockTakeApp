export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string | null;
  fullName: string;
  roleId: number;
  roleCode: string;
  roleName: string;
  locCode: string;
  status: string;
}

export interface AuthenticatedUser {
  userId: string;
  username: string;
  roleCode: string;
  locCode: string;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: string;
  user: {
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
  };
}
