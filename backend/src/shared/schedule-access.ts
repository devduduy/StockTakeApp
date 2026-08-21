import { AppError } from "./app-error.js";
import { canAccessLocation } from "./location-access.js";
import { isUserAssignedToSchedule } from "../modules/schedule-users/schedule-user.repository.js";
import type { AuthenticatedUser } from "../modules/auth/auth.types.js";

export async function assertCanAccessSchedule(
  auth: AuthenticatedUser | undefined,
  scheduleId: number,
  locCode: string,
  message = "User tidak memiliki akses ke schedule ini.",
): Promise<void> {
  if (canAccessLocation(auth, locCode)) {
    return;
  }

  const assigned = await isUserAssignedToSchedule(scheduleId, auth?.userId, auth?.username);
  if (!assigned) {
    throw new AppError(403, message, "SCHEDULE_FORBIDDEN");
  }
}
