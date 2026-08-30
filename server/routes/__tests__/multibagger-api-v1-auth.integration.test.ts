import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { computeMultibaggerDiscovery } from "../../services/multibagger";
import {
  createExternalApiMiddleware,
  createExternalApiUsageMiddleware,
  type StoredApiKey,
} from "../../services/external-api-security";
import { registerMultibaggerApiV1Routes } from "../multibagger-api-v1";

const SCOPED_KEY = `sm_test_${"M".repeat(43)}`;
const WRONG_SCOPE_KEY = `sm_test_${"W".repeat(43)}`;
const usage = vi.fn(async () => undefined);
let allowRequests = true;
let server: Server;
let baseUrl = "";

function storedKey(rawKey: string): StoredApiKey {
  return {
    keyId: rawKey === SCOPED_KEY ? "multibagger-key" : "institutional-key",
    clientId: rawKey === SCOPED_KEY ? "multibagger-client" : "institutional-client",
    keyHash: "test-hash",
    keyStatus: "ACTIVE",
    revokedAt: null,
    expiresAt: null,
    clientStatus: "ACTIVE",
    rateLimitPerMinute: 25,
    scopes:
      rawKey === SCOPED_KEY
        ? ["multibagger:read"]
        : ["institutional:read"],
  };
}

async function apiGet(path: string, rawKey: string = SCOPED_KEY) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${rawKey}` },
  });
  const body = await response.json();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { response, body };
}

beforeAll(async () => {
  const app = express();
  app.use(
    "/api/v1",
    createExternalApiUsageMiddleware({ recordUsage: usage }),
  );
  app.use(
    "/api/v1/multibagger",
    createExternalApiMiddleware("multibagger:read", {
      findStoredApiKey: vi.fn(async (rawKey) => storedKey(rawKey)),
      verifyExternalApiKey: vi.fn(async () => true),
      consumeRateLimit: vi.fn(async (_clientId, limit) => ({
        allowed: allowRequests,
        remaining: allowRequests ? limit - 1 : 0,
        resetAt: Math.floor(Date.now() / 1000) + 60,
      })),
    }),
  );
  registerMultibaggerApiV1Routes(app, {
    listCandidates: async () => [{
      symbol: "ALFA",
      sector: "Technology",
      industry: "Software",
      themes: ["AI Infrastructure"],
    }],
    getCandidateMetadata: async (symbol) => ({
      symbol,
      sector: "Technology",
      industry: "Software",
      themes: ["AI Infrastructure"],
    }),
    loadDiscoveryInput: async (symbol) => ({ symbol }),
    computeDiscovery: computeMultibaggerDiscovery,
  });
  server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  usage.mockClear();
  allowRequests = true;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("Multibagger v1 external API authentication", () => {
  it.each([
    "/api/v1/multibagger/ALFA",
    "/api/v1/multibagger/screener?limit=10",
  ])("accepts multibagger:read for %s and meters the request", async (path) => {
    const { response, body } = await apiGet(path);
    expect(response.status).toBe(200);
    expect(body.data).toBeTruthy();
    expect(response.headers.get("x-ratelimit-limit")).toBe("25");
    expect(usage).toHaveBeenCalledWith(expect.objectContaining({
      principal: expect.objectContaining({
        clientId: "multibagger-client",
        apiKeyId: "multibagger-key",
      }),
      responseStatus: 200,
    }));
  });

  it.each([
    "/api/v1/multibagger/ALFA",
    "/api/v1/multibagger/screener",
  ])("rejects institutional-only scope for %s", async (path) => {
    const { response, body } = await apiGet(path, WRONG_SCOPE_KEY);
    expect(response.status).toBe(403);
    expect(body.error.code).toBe("INSUFFICIENT_SCOPE");
    expect(usage).toHaveBeenCalledWith(expect.objectContaining({
      principal: expect.objectContaining({
        clientId: "institutional-client",
      }),
      responseStatus: 403,
    }));
  });

  it("uses the shared client rate limiter and stable 429 envelope", async () => {
    allowRequests = false;
    const { response, body } = await apiGet("/api/v1/multibagger/ALFA");
    expect(response.status).toBe(429);
    expect(body.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(response.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(usage).toHaveBeenCalledWith(expect.objectContaining({
      responseStatus: 429,
    }));
  });
});