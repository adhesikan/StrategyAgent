import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import {
  apiKeyPrefix,
  createExternalApiMiddleware,
  createExternalApiUsageMiddleware,
  generateExternalApiKey,
  hashExternalApiKey,
  isRecognizedApiKey,
  parseBearerToken,
  verifyExternalApiKey,
  type StoredApiKey,
} from "../../services/external-api-security";
import { sanitizeApiResponseForLog } from "../../services/api-log-sanitizer";

const VALID_KEY = `sm_live_${"A".repeat(43)}`;

function storedKey(overrides: Partial<StoredApiKey> = {}): StoredApiKey {
  return {
    keyId: "key-1",
    clientId: "client-1",
    keyHash: "stored-hash",
    keyStatus: "ACTIVE",
    revokedAt: null,
    expiresAt: null,
    clientStatus: "ACTIVE",
    rateLimitPerMinute: 60,
    scopes: ["institutional:read"],
    ...overrides,
  };
}

async function startApp(
  key: StoredApiKey | null,
  options: {
    verify?: boolean;
    allowed?: boolean;
    scopes?: string[];
  } = {},
) {
  const usage = vi.fn(async () => undefined);
  const app = express();
  app.use(
    "/api/v1",
    createExternalApiUsageMiddleware({ recordUsage: usage }),
  );
  app.use(
    "/api/v1/institutional",
    createExternalApiMiddleware("institutional:read", {
      findStoredApiKey: vi.fn(async () =>
        key ? { ...key, scopes: options.scopes ?? key.scopes } : null),
      verifyExternalApiKey: vi.fn(async () => options.verify ?? true),
      consumeRateLimit: vi.fn(async (_clientId, limit) => ({
        allowed: options.allowed ?? true,
        remaining: options.allowed === false ? 0 : limit - 1,
        resetAt: Math.floor(Date.now() / 1000) + 60,
      })),
    }),
  );
  app.get("/api/v1/institutional/test", (req, res) => {
    res.json({
      ok: true,
      principal: (req as typeof req & {
        externalApiPrincipal?: { clientId: string; apiKeyId: string };
      }).externalApiPrincipal,
    });
  });
  app.get("/api/v1/institutional/fail", (_req, res) => {
    res.status(500).json({ error: { code: "TEST_FAILURE" } });
  });
  app.get("/api/v1/health", (_req, res) => {
    res.json({ data: { status: "ok" } });
  });
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  return {
    usage,
    server,
    url: `http://127.0.0.1:${address.port}/api/v1/institutional/test`,
    failUrl: `http://127.0.0.1:${address.port}/api/v1/institutional/fail`,
    healthUrl: `http://127.0.0.1:${address.port}/api/v1/health`,
  };
}

const servers: Server[] = [];

async function request(
  key: StoredApiKey | null,
  authorization?: string,
  options?: Parameters<typeof startApp>[1],
  extraHeaders: Record<string, string> = {},
) {
  const running = await startApp(key, options);
  servers.push(running.server);
  const response = await fetch(running.url, {
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      ...extraHeaders,
    },
  });
  const body = await response.json();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { ...running, response, body };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

describe("external API key primitives", () => {
  it("generates recognizable live and test keys with non-secret prefixes", () => {
    for (const environment of ["live", "test"] as const) {
      const generated = generateExternalApiKey(environment);
      expect(generated.key).toMatch(
        new RegExp(`^sm_${environment}_[A-Za-z0-9_-]{32,}$`),
      );
      expect(generated.prefix).toBe(apiKeyPrefix(generated.key));
      expect(generated.prefix.length).toBeLessThan(generated.key.length);
      expect(isRecognizedApiKey(generated.key)).toBe(true);
    }
  });

  it("stores/verifies a salted hash rather than the raw key", async () => {
    const generated = generateExternalApiKey("test");
    const hash = await hashExternalApiKey(generated.key);
    expect(hash).not.toBe(generated.key);
    expect(hash).not.toContain(generated.key);
    expect(await verifyExternalApiKey(generated.key, hash)).toBe(true);
    expect(await verifyExternalApiKey(`${generated.key}x`, hash)).toBe(false);
  });

  it("redacts the one-time key from the global API response logger", () => {
    const response = {
      id: "key-1",
      key: VALID_KEY,
      metadata: { keyPrefix: apiKeyPrefix(VALID_KEY) },
    };
    const safe = sanitizeApiResponseForLog(
      "/api/external-api/clients/client-1/keys",
      "POST",
      response,
    );
    expect(safe.key).toBe("[REDACTED]");
    expect(JSON.stringify(safe)).not.toContain(VALID_KEY);
  });

  it("accepts only a well-formed Bearer header", () => {
    expect(parseBearerToken(`Bearer ${VALID_KEY}`)).toBe(VALID_KEY);
    expect(parseBearerToken(`bearer ${VALID_KEY}`)).toBe(VALID_KEY);
    expect(parseBearerToken(`Basic ${VALID_KEY}`)).toBeNull();
    expect(parseBearerToken("Bearer")).toBeNull();
    expect(parseBearerToken(undefined)).toBeNull();
  });
});

describe("external API authentication middleware", () => {
  it("accepts a valid scoped API key and attaches only a safe principal", async () => {
    const { response, body, usage } = await request(
      storedKey(),
      `Bearer ${VALID_KEY}`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-ratelimit-limit")).toBe("60");
    expect(response.headers.get("vary")).toContain("Authorization");
    expect(body.principal).toEqual({
      clientId: "client-1",
      apiKeyId: "key-1",
      scopes: ["institutional:read"],
    });
    expect(JSON.stringify(body)).not.toContain(VALID_KEY);
    expect(JSON.stringify(body)).not.toContain("stored-hash");
    expect(usage).toHaveBeenCalledWith(expect.objectContaining({
      principal: expect.objectContaining({
        clientId: "client-1",
        apiKeyId: "key-1",
      }),
      responseStatus: 200,
      endpoint: "/api/v1/institutional/test",
    }));
  });

  it("does not accept an application session without a Bearer key", async () => {
    const { response, body, usage } = await request(
      storedKey(),
      undefined,
      undefined,
      { Cookie: "connect.sid=application-session" },
    );
    expect(response.status).toBe(401);
    expect(body.error.code).toBe("API_KEY_REQUIRED");
    expect(usage).toHaveBeenCalledWith(expect.objectContaining({
      principal: null,
      responseStatus: 401,
    }));
  });

  it.each([
    ["malformed", `Basic ${VALID_KEY}`, storedKey(), {}, "API_KEY_INVALID"],
    ["invalid format", "Bearer not-a-stockmetrics-key", storedKey(), {}, "API_KEY_INVALID"],
    ["unknown", `Bearer ${VALID_KEY}`, null, {}, "API_KEY_INVALID"],
    ["hash mismatch", `Bearer ${VALID_KEY}`, storedKey(), { verify: false }, "API_KEY_INVALID"],
  ])("rejects a %s API credential", async (
    _label,
    authorization,
    key,
    options,
    code,
  ) => {
    const { response, body } = await request(
      key as StoredApiKey | null,
      authorization,
      options,
    );
    expect(response.status).toBe(401);
    expect(body.error.code).toBe(code);
    expect(JSON.stringify(body)).not.toContain(VALID_KEY);
  });

  it.each([
    ["revoked", storedKey({ keyStatus: "REVOKED", revokedAt: new Date() }), "API_KEY_REVOKED"],
    ["expired", storedKey({ expiresAt: new Date(Date.now() - 1_000) }), "API_KEY_EXPIRED"],
  ])("rejects a %s credential", async (_label, key, code) => {
    const { response, body, usage } = await request(key, `Bearer ${VALID_KEY}`);
    expect(response.status).toBe(401);
    expect(body.error.code).toBe(code);
    expect(usage).toHaveBeenCalledWith(expect.objectContaining({
      principal: expect.objectContaining({
        clientId: "client-1",
        apiKeyId: "key-1",
      }),
      responseStatus: 401,
    }));
  });

  it("returns 403 for a disabled API client", async () => {
    const { response, body, usage } = await request(
      storedKey({ clientStatus: "DISABLED" }),
      `Bearer ${VALID_KEY}`,
    );
    expect(response.status).toBe(403);
    expect(body.error.code).toBe("API_CLIENT_DISABLED");
    expect(usage).toHaveBeenCalledWith(expect.objectContaining({
      principal: expect.objectContaining({ clientId: "client-1" }),
      responseStatus: 403,
    }));
  });

  it("returns 403 for a valid key without institutional scope", async () => {
    const { response, body, usage } = await request(
      storedKey({ scopes: ["research:read"] }),
      `Bearer ${VALID_KEY}`,
    );
    expect(response.status).toBe(403);
    expect(body.error.code).toBe("INSUFFICIENT_SCOPE");
    expect(usage).toHaveBeenCalledWith(expect.objectContaining({
      responseStatus: 403,
    }));
  });

  it("returns stable 429 metadata above the client limit", async () => {
    const { response, body, usage } = await request(
      storedKey({ rateLimitPerMinute: 2 }),
      `Bearer ${VALID_KEY}`,
      { allowed: false },
    );
    expect(response.status).toBe(429);
    expect(body.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(response.headers.get("x-ratelimit-limit")).toBe("2");
    expect(response.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(usage).toHaveBeenCalledWith(expect.objectContaining({
      responseStatus: 429,
    }));
  });

  it("preserves a safe caller request ID in error envelopes", async () => {
    const { response, body, usage } = await request(
      null,
      `Bearer ${VALID_KEY}`,
      undefined,
      { "X-Request-Id": "consumer-request-123" },
    );
    expect(response.headers.get("x-request-id")).toBe("consumer-request-123");
    expect(body.error.requestId).toBe("consumer-request-123");
    expect(usage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "consumer-request-123",
    }));
  });

  it("uses one generated request ID across response and usage", async () => {
    const { response, body, usage } = await request(null, `Bearer ${VALID_KEY}`);
    const responseId = response.headers.get("x-request-id");
    expect(responseId).toBeTruthy();
    expect(body.error.requestId).toBe(responseId);
    expect(usage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: responseId,
    }));
  });

  it("records a protected route-handler failure with client identity", async () => {
    const running = await startApp(storedKey());
    servers.push(running.server);
    const response = await fetch(running.failUrl, {
      headers: { Authorization: `Bearer ${VALID_KEY}` },
    });
    await response.json();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(response.status).toBe(500);
    expect(running.usage).toHaveBeenCalledWith(expect.objectContaining({
      principal: expect.objectContaining({ clientId: "client-1" }),
      responseStatus: 500,
      endpoint: "/api/v1/institutional/fail",
    }));
  });

  it("records public health without requiring or inventing a principal", async () => {
    const running = await startApp(storedKey());
    servers.push(running.server);
    const response = await fetch(running.healthUrl);
    await response.json();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(response.status).toBe(200);
    expect(running.usage).toHaveBeenCalledWith(expect.objectContaining({
      principal: null,
      responseStatus: 200,
      endpoint: "/api/v1/health",
    }));
  });
});