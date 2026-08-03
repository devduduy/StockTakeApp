import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import type { AuthenticatedUser } from "../modules/auth/auth.types.js";
import { AppError } from "../shared/app-error.js";

export function authenticate(
  request: Request,
  _response: Response,
  next: NextFunction,
): void {
  const authorization = request.header("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    next(new AppError(401, "Bearer token wajib diisi.", "UNAUTHORIZED"));
    return;
  }

  try {
    request.auth = jwt.verify(authorization.slice(7), env.JWT_SECRET, {
      issuer: "hero-stock-take-api",
      audience: "hero-stock-take-clients",
    }) as AuthenticatedUser;
    next();
  } catch {
    next(new AppError(401, "Token tidak valid atau kedaluwarsa.", "UNAUTHORIZED"));
  }
}

