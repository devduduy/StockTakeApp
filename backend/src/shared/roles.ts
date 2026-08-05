import type { AuthenticatedUser } from "../modules/auth/auth.types.js";

export function isInventoryControl(user: AuthenticatedUser | undefined): boolean {
  return user?.roleCode === "INVENTORY_CONTROL";
}
