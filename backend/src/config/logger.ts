import pino from "pino";
import { env } from "./env.js";

export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "password",
      "*.password",
      "*.passwordHash",
      "SQL_PASSWORD",
    ],
    censor: "[REDACTED]",
  },
});

