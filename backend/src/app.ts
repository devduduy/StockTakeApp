import { randomUUID } from "node:crypto";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { categoryRouter } from "./modules/categories/category.routes.js";
import { itemRouter } from "./modules/items/item.routes.js";
import { locationRouter } from "./modules/locations/location.routes.js";
import { rackMasterRouter, rackRouter } from "./modules/racks/rack.routes.js";
import { scheduleRouter } from "./modules/schedules/schedule.routes.js";
import { scanRouter } from "./modules/scans/scan.routes.js";

export function createApp(): express.Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(
    pinoHttp({
      logger,
      genReqId(request, response) {
        const requestId = request.headers["x-request-id"];
        const resolved = Array.isArray(requestId) ? requestId[0] : requestId;
        const id = resolved || randomUUID();
        response.setHeader("x-request-id", id);
        return id;
      },
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || env.CORS_ORIGINS.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`Origin ${origin} tidak diizinkan oleh CORS.`));
      },
      credentials: false,
      allowedHeaders: ["authorization", "content-type", "x-request-id"],
      exposedHeaders: ["x-request-id"],
    }),
  );
  app.use(express.json({ limit: "1mb" }));

  app.get(`${env.API_PREFIX}/health`, (_request, response) => {
    response.status(200).json({
      data: {
        status: "ok",
        service: "hero-stock-take-api",
        mode: env.SQL_MODE,
        timestamp: new Date().toISOString(),
      },
    });
  });

  app.use(`${env.API_PREFIX}/auth`, authRouter);
  app.use(`${env.API_PREFIX}/stock-take/schedules`, scheduleRouter);
  app.use(`${env.API_PREFIX}/stock-take/schedules`, rackRouter);
  app.use(`${env.API_PREFIX}/stock-take/schedules`, scanRouter);
  app.use(`${env.API_PREFIX}/stock-take/racks`, rackMasterRouter);
  app.use(`${env.API_PREFIX}/stock-take/items`, itemRouter);
  app.use(`${env.API_PREFIX}/stock-take/categories`, categoryRouter);
  app.use(`${env.API_PREFIX}/stock-take/locations`, locationRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
