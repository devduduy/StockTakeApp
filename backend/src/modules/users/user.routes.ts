import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.js";
import { AppError } from "../../shared/app-error.js";
import { asyncHandler } from "../../shared/async-handler.js";
import { assertCanAccessLocation, resolveReadableLocCodes } from "../../shared/location-access.js";
import { isInventoryControl } from "../../shared/roles.js";
import { createManagedUser, findRoleByCode, findRoleById, listManagedUsers, listRoles, updateManagedUser } from "./user.repository.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";
import type { UserMutatePayload } from "./user.types.js";

const userPayloadSchema = z.object({
  username: z.string().trim().min(3).max(100),
  fullName: z.string().trim().min(3).max(150),
  password: z.string().min(6).max(100).optional(),
  roleId: z.coerce.number().int().positive(),
  locCode: z.string().trim().regex(/^[A-Za-z0-9]{4}$/),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

const importRowSchema = z.object({
  username: z.string().trim().min(3).max(100),
  fullName: z.string().trim().min(3).max(150),
  password: z.string().min(6).max(100).optional(),
  roleCode: z.string().trim().min(2).max(50),
  locCode: z.string().trim().regex(/^[A-Za-z0-9]{4}$/),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
});

const importBodySchema = z.object({
  rows: z.array(importRowSchema).min(1).max(500),
});

const paramsSchema = z.object({
  userId: z.coerce.number().int().positive().safe(),
});

export const userRouter = Router();

function assertCanManageUsers(auth: AuthenticatedUser | undefined): void {
  if (auth?.roleCode === "SCANNER") {
    throw new AppError(403, "Role scanner tidak diizinkan mengelola user.", "FORBIDDEN");
  }
}

async function assertPayloadAllowed(auth: AuthenticatedUser | undefined, payload: Pick<UserMutatePayload, "roleId" | "locCode">): Promise<void> {
  const role = await findRoleById(payload.roleId);
  if (!role) {
    throw new AppError(400, "Role user tidak valid.", "ROLE_NOT_FOUND");
  }
  if (!isInventoryControl(auth) && role.code === "INVENTORY_CONTROL") {
    throw new AppError(403, "Hanya Inventory Control yang boleh membuat role Inventory Control.", "ROLE_FORBIDDEN");
  }
  if (isInventoryControl(auth)) return;

  assertCanAccessLocation(
    auth,
    payload.locCode,
    "User hanya boleh dibuat untuk lokasi asli store manager.",
  );
}

userRouter.get(
  "/roles",
  authenticate,
  asyncHandler(async (request, response) => {
    assertCanManageUsers(request.auth);
    const roles = await listRoles();
    response.status(200).json({ data: roles });
  }),
);

userRouter.get(
  "/",
  authenticate,
  asyncHandler(async (request, response) => {
    assertCanManageUsers(request.auth);
    const locCodes = resolveReadableLocCodes(request.auth);
    const users = await listManagedUsers(locCodes);
    response.status(200).json({ data: users });
  }),
);

userRouter.post(
  "/",
  authenticate,
  asyncHandler(async (request, response) => {
    assertCanManageUsers(request.auth);
    const body = userPayloadSchema.parse(request.body);
    await assertPayloadAllowed(request.auth, body);
    const user = await createManagedUser({
      ...body,
      locCode: body.locCode.toUpperCase(),
      usernameActor: request.auth?.username ?? "SYSTEM",
    });
    response.status(201).json({ data: user });
  }),
);

userRouter.put(
  "/:userId",
  authenticate,
  asyncHandler(async (request, response) => {
    assertCanManageUsers(request.auth);
    const { userId } = paramsSchema.parse(request.params);
    const body = userPayloadSchema.parse(request.body);
    await assertPayloadAllowed(request.auth, body);
    const user = await updateManagedUser(userId, {
      ...body,
      locCode: body.locCode.toUpperCase(),
      usernameActor: request.auth?.username ?? "SYSTEM",
    });
    response.status(200).json({ data: user });
  }),
);

userRouter.post(
  "/import",
  authenticate,
  asyncHandler(async (request, response) => {
    assertCanManageUsers(request.auth);
    const { rows } = importBodySchema.parse(request.body);
    let created = 0;
    let updated = 0;
    const failed: Array<{ row: number; username: string; message: string }> = [];
    const existingUsers = await listManagedUsers(resolveReadableLocCodes(request.auth));

    for (const [index, row] of rows.entries()) {
      try {
        const role = await findRoleByCode(row.roleCode.toUpperCase());
        if (!role) {
          throw new AppError(400, `Role ${row.roleCode} tidak ditemukan.`, "ROLE_NOT_FOUND");
        }
        const payload: UserMutatePayload = {
          username: row.username,
          fullName: row.fullName,
          password: row.password,
          roleId: role.id,
          locCode: row.locCode.toUpperCase(),
          status: row.status ?? "ACTIVE",
          usernameActor: request.auth?.username ?? "SYSTEM",
        };
        await assertPayloadAllowed(request.auth, payload);
        const existing = existingUsers.find((user) => user.username.toLowerCase() === row.username.toLowerCase());
        if (existing) {
          await updateManagedUser(Number(existing.id), payload);
          updated += 1;
        } else {
          await createManagedUser(payload);
          created += 1;
        }
      } catch (error) {
        failed.push({
          row: index + 2,
          username: row.username,
          message: error instanceof Error ? error.message : "Row gagal diproses.",
        });
      }
    }

    response.status(200).json({ data: { created, updated, failed } });
  }),
);
