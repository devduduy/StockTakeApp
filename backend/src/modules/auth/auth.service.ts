import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/app-error.js";
import { findActiveUserByUsername, recordSuccessfulLogin } from "./auth.repository.js";
import type {
  AuthenticatedUser,
  LoginResponse,
} from "./auth.types.js";

export async function login(
  username: string,
  password: string,
): Promise<LoginResponse> {
  const user = await findActiveUserByUsername(username);
  const validPassword =
    user?.passwordHash &&
    (await bcrypt.compare(password, user.passwordHash));

  if (!user || !validPassword) {
    throw new AppError(
      401,
      "Username atau password tidak valid.",
      "INVALID_CREDENTIALS",
    );
  }

  const payload: AuthenticatedUser = {
    userId: user.id,
    username: user.username,
    roleCode: user.roleCode,
    locCode: user.locCode,
    accessibleLocCodes: user.accessibleLocCodes,
  };
  const tokenOptions: SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as NonNullable<
      SignOptions["expiresIn"]
    >,
    issuer: "hero-stock-take-api",
    audience: "hero-stock-take-clients",
  };
  const accessToken = jwt.sign(
    { ...payload },
    env.JWT_SECRET,
    tokenOptions,
  );

  await recordSuccessfulLogin(user.id);

  return {
    accessToken,
    tokenType: "Bearer",
    expiresIn: env.JWT_EXPIRES_IN,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: {
        id: user.roleId,
        code: user.roleCode,
        name: user.roleName,
      },
      locCode: user.locCode,
      accessibleLocCodes: user.accessibleLocCodes,
      status: user.status,
    },
  };
}
