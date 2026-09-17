import type { RequestHandler, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import type { AuthenticatedUser } from "../auth/auth.types.js";

export type StockTakeEventType =
  | "connected"
  | "schedule.created"
  | "schedule.updated"
  | "schedule.closed"
  | "schedule.team.updated"
  | "rack.master.created"
  | "rack.master.updated"
  | "rack.master.deleted"
  | "rack.scope.updated"
  | "rack.scanned"
  | "rack.manual_scanned"
  | "rack.scan_deleted"
  | "rack.printed"
  | "rack.corrected"
  | "rack.confirmed"
  | "rack.rejected"
  | "soh.generated";

export interface StockTakeEventPayload {
  type: StockTakeEventType;
  scheduleId?: number | undefined;
  rackId?: number | undefined;
  locCode?: string | undefined;
  username?: string | undefined;
  occurredAt?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

interface StockTakeEventClient {
  id: number;
  auth: AuthenticatedUser;
  response: Response;
  keepAlive: NodeJS.Timeout;
}

let nextClientId = 1;
const clients = new Map<number, StockTakeEventClient>();

function parseStreamToken(rawToken: unknown): AuthenticatedUser | null {
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
  if (typeof token !== "string" || token.trim().length === 0) {
    return null;
  }

  try {
    return jwt.verify(token, env.JWT_SECRET, {
      issuer: "hero-stock-take-api",
      audience: "hero-stock-take-clients",
    }) as AuthenticatedUser;
  } catch {
    return null;
  }
}

function writeEvent(response: Response, eventName: string, payload: unknown): void {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function closeClient(clientId: number): void {
  const client = clients.get(clientId);
  if (!client) {
    return;
  }
  clearInterval(client.keepAlive);
  clients.delete(clientId);
}

export const stockTakeEventStream: RequestHandler = (request, response) => {
  const auth = parseStreamToken(request.query.token);
  if (!auth) {
    response.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Token stream tidak valid atau kedaluwarsa.",
      },
    });
    return;
  }

  response.status(200);
  response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders?.();

  const clientId = nextClientId++;
  const keepAlive = setInterval(() => {
    response.write(`: keep-alive ${new Date().toISOString()}\n\n`);
  }, 25_000);

  clients.set(clientId, {
    id: clientId,
    auth,
    response,
    keepAlive,
  });

  writeEvent(response, "stock-take", {
    type: "connected",
    occurredAt: new Date().toISOString(),
  } satisfies StockTakeEventPayload);

  request.on("close", () => closeClient(clientId));
};

export function broadcastStockTakeEvent(event: StockTakeEventPayload): void {
  const payload: StockTakeEventPayload = {
    ...event,
    occurredAt: event.occurredAt ?? new Date().toISOString(),
  };

  for (const client of clients.values()) {
    try {
      writeEvent(client.response, "stock-take", payload);
    } catch {
      closeClient(client.id);
    }
  }
}

export function stockTakeEventClientCount(): number {
  return clients.size;
}
