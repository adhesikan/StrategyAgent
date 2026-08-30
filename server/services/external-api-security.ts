import crypto from "node:crypto";
import bcrypt from "bcrypt";
import type { Request, RequestHandler, Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "../db";

export const EXTERNAL_API_SCOPES = [
  "institutional:read",
  "multibagger:read",
  "fundamentals:read",
  "research:read",
] as const;

export type ExternalApiScope = (typeof EXTERNAL_API_SCOPES)[number];
export type ExternalApiEnvironment = "live" | "test";
export type ExternalApiPrincipal = {
  clientId: string;
  apiKeyId: string;
  scopes: string[];
};

export type ExternalApiClientRecord = {
  id: string;
  userId: string;
  name: string;
  status: string;
  tier: string;
  rateLimitPerMinute: number;
  createdAt: string | Date | null;
  updatedAt: string | Date | null;
};

export type ExternalApiKeyMetadata = {
  id: string;
  clientId: string;
  name: string;
  keyPrefix: string;
  environment: ExternalApiEnvironment;
  scopes: string[];
  createdAt: string | Date | null;
  lastUsedAt: string | Date | null;
  expiresAt: string | Date | null;
  revokedAt: string | Date | null;
  status: string;
};

const KEY_RE = /^sm_(live|test)_[A-Za-z0-9_-]{32,}$/;
const BEARER_RE = /^Bearer[ \t]+(\S+)$/i;
const PREFIX_LENGTH = 12;
const BCRYPT_ROUNDS = 12;
const DEFAULT_RATE_LIMIT = 60;

export class ExternalApiSecurityError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ExternalApiSecurityError";
  }
}

function safeNumber(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

export function getDefaultExternalApiRateLimit(): number {
  return getExternalApiTierRateLimit("standard");
}

export function getExternalApiTierRateLimit(tier: string): number {
  const normalizedTier = tier.trim().toLowerCase();
  const configured =
    normalizedTier === "enterprise"
      ? process.env.EXTERNAL_API_RATE_LIMIT_ENTERPRISE_PER_MIN
      : normalizedTier === "partner"
        ? process.env.EXTERNAL_API_RATE_LIMIT_PARTNER_PER_MIN
        : process.env.EXTERNAL_API_RATE_LIMIT_STANDARD_PER_MIN ??
          process.env.EXTERNAL_API_RATE_LIMIT_PER_MIN;
  const fallback =
    normalizedTier === "enterprise"
      ? 1_000
      : normalizedTier === "partner"
        ? 300
        : DEFAULT_RATE_LIMIT;
  return Math.min(
    100_000,
    safeNumber(configured, fallback),
  );
}

export function parseBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = BEARER_RE.exec(header.trim());
  return match?.[1] ?? null;
}

export function isRecognizedApiKey(key: string): boolean {
  return KEY_RE.test(key);
}

export function apiKeyPrefix(key: string): string {
  const environment = key.startsWith("sm_test_") ? "sm_test_" : "sm_live_";
  return `${environment}${key.slice(environment.length, environment.length + PREFIX_LENGTH)}`;
}

export function generateExternalApiKey(
  environment: ExternalApiEnvironment = "live",
): { key: string; prefix: string } {
  const randomPart = crypto.randomBytes(32).toString("base64url");
  const key = `sm_${environment}_${randomPart}`;
  return { key, prefix: apiKeyPrefix(key) };
}

export async function hashExternalApiKey(key: string): Promise<string> {
  return bcrypt.hash(key, BCRYPT_ROUNDS);
}

export async function verifyExternalApiKey(
  key: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(key, hash);
}

export async function ensureExternalApiSecuritySchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS external_api_clients (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      tier TEXT NOT NULL DEFAULT 'standard',
      rate_limit_per_minute INTEGER NOT NULL DEFAULT 60,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT external_api_clients_status CHECK (status IN ('ACTIVE', 'DISABLED')),
      CONSTRAINT external_api_clients_rate_limit CHECK (rate_limit_per_minute > 0)
    );
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS external_api_keys (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      client_id TEXT NOT NULL REFERENCES external_api_clients(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      key_prefix TEXT NOT NULL UNIQUE,
      key_hash TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'live',
      scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      CONSTRAINT external_api_keys_environment CHECK (environment IN ('live', 'test')),
      CONSTRAINT external_api_keys_status CHECK (status IN ('ACTIVE', 'REVOKED'))
    );
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS external_api_rate_limit_buckets (
      client_id TEXT NOT NULL REFERENCES external_api_clients(id) ON DELETE CASCADE,
      window_start TIMESTAMPTZ NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (client_id, window_start)
    );
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS external_api_usage (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      client_id TEXT,
      api_key_id TEXT,
      endpoint TEXT NOT NULL,
      method TEXT NOT NULL,
      response_status INTEGER NOT NULL,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      duration_ms INTEGER NOT NULL,
      request_id TEXT,
      CONSTRAINT external_api_usage_duration CHECK (duration_ms >= 0)
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_external_api_keys_client
      ON external_api_keys (client_id, created_at DESC);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_external_api_usage_client_time
      ON external_api_usage (client_id, requested_at DESC);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_external_api_usage_requested_at
      ON external_api_usage (requested_at DESC);
  `);
}

function clientFromRow(row: Record<string, unknown>): ExternalApiClientRecord {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    status: String(row.status),
    tier: String(row.tier),
    rateLimitPerMinute: safeNumber(row.rate_limit_per_minute, DEFAULT_RATE_LIMIT),
    createdAt: (row.created_at as string | Date | null) ?? null,
    updatedAt: (row.updated_at as string | Date | null) ?? null,
  };
}

function scopesFromRow(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((scope): scope is string => typeof scope === "string")
    : [];
}

function keyFromRow(row: Record<string, unknown>): ExternalApiKeyMetadata {
  return {
    id: String(row.id),
    clientId: String(row.client_id),
    name: String(row.name),
    keyPrefix: String(row.key_prefix),
    environment: row.environment === "test" ? "test" : "live",
    scopes: scopesFromRow(row.scopes),
    createdAt: (row.created_at as string | Date | null) ?? null,
    lastUsedAt: (row.last_used_at as string | Date | null) ?? null,
    expiresAt: (row.expires_at as string | Date | null) ?? null,
    revokedAt: (row.revoked_at as string | Date | null) ?? null,
    status: String(row.status),
  };
}

export async function createExternalApiClient(input: {
  userId: string;
  name: string;
  tier?: string;
  rateLimitPerMinute?: number;
}): Promise<ExternalApiClientRecord> {
  const name = input.name.trim();
  if (!name || name.length > 100) {
    throw new ExternalApiSecurityError(
      400,
      "INVALID_CLIENT",
      "Client name must contain 1 to 100 characters.",
    );
  }
  const tier = input.tier?.trim() || "standard";
  const rateLimit = Math.min(
    100_000,
    safeNumber(input.rateLimitPerMinute, getExternalApiTierRateLimit(tier)),
  );
  const result = await db.execute(sql`
    INSERT INTO external_api_clients (user_id, name, tier, rate_limit_per_minute)
    VALUES (${input.userId}, ${name}, ${tier}, ${rateLimit})
    RETURNING id, user_id, name, status, tier, rate_limit_per_minute, created_at, updated_at
  `);
  return clientFromRow(result.rows[0] as Record<string, unknown>);
}

export async function updateExternalApiClientPolicy(input: {
  clientId: string;
  status?: "ACTIVE" | "DISABLED";
  tier?: string;
  rateLimitPerMinute?: number;
}): Promise<ExternalApiClientRecord | null> {
  const existing = await db.execute(sql`
    SELECT id, user_id, name, status, tier, rate_limit_per_minute, created_at, updated_at
    FROM external_api_clients
    WHERE id = ${input.clientId}
    LIMIT 1
  `);
  const row = existing.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const status = input.status ?? (String(row.status) as "ACTIVE" | "DISABLED");
  const tier = input.tier?.trim() || String(row.tier);
  const rateLimit =
    input.rateLimitPerMinute !== undefined
      ? Math.min(
          100_000,
          safeNumber(input.rateLimitPerMinute, Number(row.rate_limit_per_minute)),
        )
      : input.tier !== undefined
        ? getExternalApiTierRateLimit(tier)
        : safeNumber(row.rate_limit_per_minute, DEFAULT_RATE_LIMIT);
  const result = await db.execute(sql`
    UPDATE external_api_clients
    SET status = ${status},
        tier = ${tier},
        rate_limit_per_minute = ${rateLimit},
        updated_at = NOW()
    WHERE id = ${input.clientId}
    RETURNING id, user_id, name, status, tier, rate_limit_per_minute, created_at, updated_at
  `);
  return clientFromRow(result.rows[0] as Record<string, unknown>);
}

export async function listExternalApiClients(
  userId: string,
): Promise<ExternalApiClientRecord[]> {
  const result = await db.execute(sql`
    SELECT id, user_id, name, status, tier, rate_limit_per_minute, created_at, updated_at
    FROM external_api_clients
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
  `);
  return result.rows.map((row) => clientFromRow(row as Record<string, unknown>));
}

export async function createExternalApiKey(input: {
  userId: string;
  clientId: string;
  name: string;
  environment?: ExternalApiEnvironment;
  scopes: string[];
  expiresAt?: string | null;
}): Promise<{ key: string; metadata: ExternalApiKeyMetadata }> {
  const clientResult = await db.execute(sql`
    SELECT id
    FROM external_api_clients
    WHERE id = ${input.clientId} AND user_id = ${input.userId} AND status = 'ACTIVE'
    LIMIT 1
  `);
  if (clientResult.rows.length === 0) {
    throw new ExternalApiSecurityError(
      404,
      "API_CLIENT_NOT_FOUND",
      "API client was not found.",
    );
  }
  const name = input.name.trim();
  if (!name || name.length > 100) {
    throw new ExternalApiSecurityError(
      400,
      "INVALID_API_KEY",
      "API key name must contain 1 to 100 characters.",
    );
  }
  const scopes = Array.from(new Set(input.scopes));
  if (
    scopes.length === 0 ||
    scopes.some(
      (scope) =>
        !EXTERNAL_API_SCOPES.includes(scope as ExternalApiScope),
    )
  ) {
    throw new ExternalApiSecurityError(
      400,
      "INVALID_SCOPE",
      "API key scopes must use the supported API scope names.",
    );
  }
  let expiresAt: Date | null = null;
  if (input.expiresAt) {
    expiresAt = new Date(input.expiresAt);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw new ExternalApiSecurityError(
        400,
        "INVALID_EXPIRATION",
        "expiresAt must be a future ISO date.",
      );
    }
  }
  const environment = input.environment ?? "live";
  const generated = generateExternalApiKey(environment);
  const keyHash = await hashExternalApiKey(generated.key);
  const result = await db.execute(sql`
    INSERT INTO external_api_keys
      (client_id, name, key_prefix, key_hash, environment, scopes, expires_at)
    VALUES
      (${input.clientId}, ${name}, ${generated.prefix}, ${keyHash},
       ${environment},
       ARRAY(
         SELECT jsonb_array_elements_text(${JSON.stringify(scopes)}::jsonb)
       ),
       ${expiresAt})
    RETURNING id, client_id, name, key_prefix, environment, scopes,
              created_at, last_used_at, expires_at, revoked_at, status
  `);
  return {
    key: generated.key,
    metadata: keyFromRow(result.rows[0] as Record<string, unknown>),
  };
}

export async function listExternalApiKeys(
  userId: string,
): Promise<ExternalApiKeyMetadata[]> {
  const result = await db.execute(sql`
    SELECT k.id, k.client_id, k.name, k.key_prefix, k.environment, k.scopes,
           k.created_at, k.last_used_at, k.expires_at, k.revoked_at, k.status
    FROM external_api_keys k
    INNER JOIN external_api_clients c ON c.id = k.client_id
    WHERE c.user_id = ${userId}
    ORDER BY k.created_at DESC
  `);
  return result.rows.map((row) => keyFromRow(row as Record<string, unknown>));
}

export async function revokeExternalApiKey(
  userId: string,
  keyId: string,
): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE external_api_keys k
    SET status = 'REVOKED', revoked_at = COALESCE(k.revoked_at, NOW())
    FROM external_api_clients c
    WHERE k.id = ${keyId}
      AND c.id = k.client_id
      AND c.user_id = ${userId}
      AND k.status = 'ACTIVE'
    RETURNING k.id
  `);
  return result.rows.length > 0;
}

export type StoredApiKey = {
  keyId: string;
  clientId: string;
  keyHash: string;
  keyStatus: string;
  revokedAt: string | Date | null;
  expiresAt: string | Date | null;
  clientStatus: string;
  rateLimitPerMinute: number;
  scopes: string[];
};

export async function findStoredApiKey(key: string): Promise<StoredApiKey | null> {
  const prefix = apiKeyPrefix(key);
  const result = await db.execute(sql`
    SELECT k.id AS key_id, k.client_id, k.key_hash, k.status AS key_status,
           k.revoked_at, k.expires_at, k.scopes,
           c.status AS client_status, c.rate_limit_per_minute
    FROM external_api_keys k
    INNER JOIN external_api_clients c ON c.id = k.client_id
    WHERE k.key_prefix = ${prefix}
    LIMIT 1
  `);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    keyId: String(row.key_id),
    clientId: String(row.client_id),
    keyHash: String(row.key_hash),
    keyStatus: String(row.key_status),
    revokedAt: (row.revoked_at as string | Date | null) ?? null,
    expiresAt: (row.expires_at as string | Date | null) ?? null,
    clientStatus: String(row.client_status),
    rateLimitPerMinute: safeNumber(row.rate_limit_per_minute, DEFAULT_RATE_LIMIT),
    scopes: scopesFromRow(row.scopes),
  };
}

function isPast(value: string | Date | null): boolean {
  return value !== null && new Date(value).getTime() <= Date.now();
}

export function externalApiPrincipal(req: Request): ExternalApiPrincipal | null {
  const principal = (req as Request & {
    externalApiPrincipal?: unknown;
  }).externalApiPrincipal;
  if (!principal || typeof principal !== "object") return null;
  const value = principal as Record<string, unknown>;
  if (
    typeof value.clientId !== "string" ||
    typeof value.apiKeyId !== "string" ||
    !Array.isArray(value.scopes) ||
    !value.scopes.every((scope) => typeof scope === "string")
  ) {
    return null;
  }
  return {
    clientId: value.clientId,
    apiKeyId: value.apiKeyId,
    scopes: value.scopes as string[],
  };
}

export function externalApiRequestId(req: Request): string {
  const assigned = (req as Request & {
    externalApiRequestId?: unknown;
  }).externalApiRequestId;
  if (typeof assigned === "string") return assigned;
  const requestId = req.header("x-request-id");
  return requestId && /^[A-Za-z0-9._:-]{1,128}$/.test(requestId)
    ? requestId
    : crypto.randomUUID();
}

export function sendExternalApiError(
  res: Response,
  error: ExternalApiSecurityError,
  requestId: string,
): void {
  res.setHeader("X-Request-Id", requestId);
  res.setHeader("Cache-Control", "no-store");
  res.status(error.status).json({
    error: {
      code: error.code,
      message: error.message,
      requestId,
    },
  });
}

export async function consumeExternalApiRateLimit(
  clientId: string,
  limit: number,
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const result = await db.execute(sql`
    INSERT INTO external_api_rate_limit_buckets (client_id, window_start, request_count)
    VALUES (${clientId}, date_trunc('minute', NOW()), 1)
    ON CONFLICT (client_id, window_start)
    DO UPDATE SET request_count =
      external_api_rate_limit_buckets.request_count + 1
    RETURNING request_count,
      EXTRACT(EPOCH FROM (window_start + INTERVAL '1 minute'))::bigint AS reset_at
  `);
  const row = result.rows[0] as Record<string, unknown>;
  const count = safeNumber(row.request_count, limit + 1);
  const resetAt = safeNumber(row.reset_at, Math.ceil(Date.now() / 60_000) * 60 + 60);
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    resetAt,
  };
}

export async function recordExternalApiUsage(input: {
  principal: ExternalApiPrincipal | null;
  endpoint: string;
  method: string;
  responseStatus: number;
  durationMs: number;
  requestId: string;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO external_api_usage
      (client_id, api_key_id, endpoint, method, response_status, duration_ms, request_id)
    VALUES
      (${input.principal?.clientId ?? null}, ${input.principal?.apiKeyId ?? null},
       ${input.endpoint.slice(0, 500)}, ${input.method.slice(0, 16)},
       ${input.responseStatus}, ${Math.max(0, Math.floor(input.durationMs))},
       ${input.requestId})
  `);
  if (input.principal) {
    await db.execute(sql`
      UPDATE external_api_keys
      SET last_used_at = NOW()
      WHERE id = ${input.principal.apiKeyId} AND status = 'ACTIVE'
    `);
  }
}

export function createExternalApiUsageMiddleware(
  dependencies: Partial<{
    recordUsage: typeof recordExternalApiUsage;
  }> = {},
): RequestHandler {
  const recordUsage = dependencies.recordUsage ?? recordExternalApiUsage;
  return (req, res, next) => {
    const requestId = externalApiRequestId(req);
    (req as Request & { externalApiRequestId?: string }).externalApiRequestId =
      requestId;
    const startedAt = Date.now();
    res.setHeader("X-Request-Id", requestId);
    res.on("finish", () => {
      void recordUsage({
        principal: externalApiPrincipal(req),
        endpoint: req.originalUrl.split("?")[0],
        method: req.method,
        responseStatus: res.statusCode,
        durationMs: Date.now() - startedAt,
        requestId,
      }).catch((error: unknown) => {
        console.error(JSON.stringify({
          event: "external_api_usage_record_failed",
          code: "USAGE_RECORD_FAILED",
          status: res.statusCode,
          requestId,
          message: String(error instanceof Error ? error.message : error).slice(0, 200),
        }));
      });
    });
    next();
  };
}

export function createExternalApiMiddleware(
  requiredScope: ExternalApiScope,
  dependencies: Partial<{
    findStoredApiKey: typeof findStoredApiKey;
    verifyExternalApiKey: typeof verifyExternalApiKey;
    consumeRateLimit: typeof consumeExternalApiRateLimit;
  }> = {},
): RequestHandler {
  const security = {
    findStoredApiKey,
    verifyExternalApiKey,
    consumeRateLimit: consumeExternalApiRateLimit,
    ...dependencies,
  };
  return async (req, res, next) => {
    const requestId = externalApiRequestId(req);
    try {
      const header = req.header("authorization");
      const key = parseBearerToken(header);
      if (!header) {
        throw new ExternalApiSecurityError(
          401,
          "API_KEY_REQUIRED",
          "A Bearer API key is required.",
        );
      }
      if (!key || !isRecognizedApiKey(key)) {
        throw new ExternalApiSecurityError(
          401,
          "API_KEY_INVALID",
          "The Bearer API key is invalid.",
        );
      }
      const stored = await security.findStoredApiKey(key);
      if (!stored || !(await security.verifyExternalApiKey(key, stored.keyHash))) {
        throw new ExternalApiSecurityError(
          401,
          "API_KEY_INVALID",
          "The Bearer API key is invalid.",
        );
      }
      const principal: ExternalApiPrincipal = {
        clientId: stored.clientId,
        apiKeyId: stored.keyId,
        scopes: stored.scopes,
      };
      (req as Request & { externalApiPrincipal?: ExternalApiPrincipal }).externalApiPrincipal =
        principal;
      if (stored.keyStatus === "REVOKED" || stored.revokedAt !== null) {
        throw new ExternalApiSecurityError(
          401,
          "API_KEY_REVOKED",
          "The Bearer API key has been revoked.",
        );
      }
      if (isPast(stored.expiresAt)) {
        throw new ExternalApiSecurityError(
          401,
          "API_KEY_EXPIRED",
          "The Bearer API key has expired.",
        );
      }
      if (stored.clientStatus !== "ACTIVE") {
        throw new ExternalApiSecurityError(
          403,
          "API_CLIENT_DISABLED",
          "The API client is disabled.",
        );
      }
      if (!stored.scopes.includes(requiredScope)) {
        throw new ExternalApiSecurityError(
          403,
          "INSUFFICIENT_SCOPE",
          `The API key requires the ${requiredScope} scope.`,
        );
      }
      const rate = await security.consumeRateLimit(
        stored.clientId,
        stored.rateLimitPerMinute,
      );
      res.setHeader("X-RateLimit-Limit", String(stored.rateLimitPerMinute));
      res.setHeader("X-RateLimit-Remaining", String(rate.remaining));
      res.setHeader("X-RateLimit-Reset", String(rate.resetAt));
      res.setHeader("Vary", "Authorization, Accept");
      if (!rate.allowed) {
        res.setHeader(
          "Retry-After",
          String(Math.max(1, rate.resetAt - Math.floor(Date.now() / 1000))),
        );
        throw new ExternalApiSecurityError(
          429,
          "RATE_LIMIT_EXCEEDED",
          "API rate limit exceeded. Try again shortly.",
        );
      }

      res.setHeader("X-Request-Id", requestId);
      next();
    } catch (error) {
      const securityError =
        error instanceof ExternalApiSecurityError
          ? error
          : new ExternalApiSecurityError(
              503,
              "EXTERNAL_API_SECURITY_UNAVAILABLE",
              "External API security is temporarily unavailable.",
            );
      sendExternalApiError(res, securityError, requestId);
    }
  };
}