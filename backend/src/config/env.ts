import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

function stripOptionalQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadConnectionFile(): void {
  const configuredPath = process.env.STOCKTAKE_CONNECTION_FILE;
  if (!configuredPath) {
    return;
  }

  const absolutePath = path.resolve(process.cwd(), configuredPath);
  const content = fs.readFileSync(absolutePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([^=]+?)\s*=\s*(.*?)\s*$/);
    if (!match) {
      continue;
    }
    const key = match[1]?.trim();
    const rawValue = match[2];
    if (key && rawValue !== undefined && process.env[key] === undefined) {
      process.env[key] = stripOptionalQuotes(rawValue);
    }
  }
}

loadConnectionFile();

const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === "boolean"
      ? value
      : ["1", "true", "yes", "on"].includes(value.toLowerCase()),
  );

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    API_PREFIX: z.string().startsWith("/").default("/api"),
    SQL_MODE: z.enum(["mock", "sql"]).default("mock"),
    SQL_SERVER: z.string().optional(),
    SQL_PORT: z.coerce.number().int().min(1).max(65535).default(1433),
    SQL_DATABASE: z.string().optional(),
    SQL_USER: z.string().optional(),
    SQL_PASSWORD: z.string().optional(),
    SQL_ENCRYPT: booleanFromEnv.default(true),
    SQL_TRUST_SERVER_CERTIFICATE: booleanFromEnv.default(true),
    SQL_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
    SQL_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    DB_SEED_ON_START: booleanFromEnv.default(false),
    JWT_SECRET: z
      .string()
      .min(32)
      .default("local-development-only-secret-change-before-production"),
    JWT_EXPIRES_IN: z.string().default("8h"),
    CORS_ORIGINS: z
      .string()
      .default("http://127.0.0.1:4200,http://localhost:4200"),
  })
  .superRefine((value, context) => {
    if (value.SQL_MODE !== "sql") {
      return;
    }
    for (const key of [
      "SQL_SERVER",
      "SQL_DATABASE",
      "SQL_USER",
      "SQL_PASSWORD",
    ] as const) {
      if (!value[key]) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: `${key} wajib diisi saat SQL_MODE=sql`,
        });
      }
    }
    if (
      value.NODE_ENV === "production" &&
      value.JWT_SECRET.startsWith("local-development-only")
    ) {
      context.addIssue({
        code: "custom",
        path: ["JWT_SECRET"],
        message: "JWT_SECRET production tidak boleh memakai nilai default.",
      });
    }
  });

const parsed = schema.parse(process.env);

interface NormalizedSqlTarget {
  server: string | undefined;
  port: number;
  database: string | undefined;
  encrypt: boolean;
  trustServerCertificate: boolean;
}

function normalizeSqlTarget(): NormalizedSqlTarget {
  const rawServer = parsed.SQL_SERVER;
  if (!rawServer?.toLowerCase().startsWith("jdbc:sqlserver://")) {
    return {
      server: rawServer,
      port: parsed.SQL_PORT,
      database: parsed.SQL_DATABASE,
      encrypt: parsed.SQL_ENCRYPT,
      trustServerCertificate: parsed.SQL_TRUST_SERVER_CERTIFICATE,
    };
  }

  const match = rawServer.match(
    /^jdbc:sqlserver:\/\/([^:;]+)(?::(\d+))?(?:;(.*))?$/i,
  );
  if (!match) {
    throw new Error("Format JDBC SQL_SERVER tidak valid.");
  }

  const properties = new Map<string, string>();
  for (const part of (match[3] ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0) {
      properties.set(
        part.slice(0, separator).trim().toLowerCase(),
        part.slice(separator + 1).trim(),
      );
    }
  }

  return {
    server: match[1],
    port: Number(match[2] ?? parsed.SQL_PORT),
    database: parsed.SQL_DATABASE ?? properties.get("databasename"),
    encrypt:
      properties.has("encrypt")
        ? properties.get("encrypt")?.toLowerCase() === "true"
        : parsed.SQL_ENCRYPT,
    trustServerCertificate:
      properties.has("trustservercertificate")
        ? properties.get("trustservercertificate")?.toLowerCase() === "true"
        : parsed.SQL_TRUST_SERVER_CERTIFICATE,
  };
}

const sqlTarget = normalizeSqlTarget();

export const env = {
  ...parsed,
  SQL_SERVER: sqlTarget.server,
  SQL_PORT: sqlTarget.port,
  SQL_DATABASE: sqlTarget.database,
  SQL_ENCRYPT: sqlTarget.encrypt,
  SQL_TRUST_SERVER_CERTIFICATE: sqlTarget.trustServerCertificate,
  CORS_ORIGINS: parsed.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};
