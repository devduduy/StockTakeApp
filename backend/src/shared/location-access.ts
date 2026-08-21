import { AppError } from "./app-error.js";
import { isInventoryControl } from "./roles.js";
import type { AuthenticatedUser } from "../modules/auth/auth.types.js";

export function userAccessibleLocCodes(auth: AuthenticatedUser | undefined): string[] {
  return [...new Set([
    auth?.locCode,
  ].map((locCode) => locCode?.trim()).filter((locCode): locCode is string => Boolean(locCode)))].sort();
}

export function canAccessLocation(auth: AuthenticatedUser | undefined, locCode: string): boolean {
  return isInventoryControl(auth) || userAccessibleLocCodes(auth).includes(locCode.trim());
}

export function assertCanAccessLocation(
  auth: AuthenticatedUser | undefined,
  locCode: string,
  message = "User tidak memiliki akses ke lokasi ini.",
): void {
  if (!canAccessLocation(auth, locCode)) {
    throw new AppError(403, message, "LOCATION_FORBIDDEN");
  }
}

export function resolveReadableLocCodes(
  auth: AuthenticatedUser | undefined,
  requestedLocCode?: string,
): string[] | undefined {
  if (isInventoryControl(auth)) {
    return requestedLocCode ? [requestedLocCode] : undefined;
  }
  const allowed = userAccessibleLocCodes(auth);
  if (allowed.length === 0) {
    throw new AppError(400, "LOC_CODE user belum tersedia.", "LOC_CODE_REQUIRED");
  }
  if (requestedLocCode) {
    assertCanAccessLocation(auth, requestedLocCode);
    return [requestedLocCode];
  }
  return allowed;
}

export function resolveWritableLocCode(
  auth: AuthenticatedUser | undefined,
  requestedLocCode?: string,
  message = "Data hanya boleh dikelola untuk lokasi yang dimapping ke user.",
): string {
  const locCode = requestedLocCode?.trim() || auth?.locCode;
  if (!locCode) {
    throw new AppError(400, "Lokasi wajib dipilih.", "LOC_CODE_REQUIRED");
  }
  if (!isInventoryControl(auth)) {
    assertCanAccessLocation(auth, locCode, message);
  }
  return locCode;
}
