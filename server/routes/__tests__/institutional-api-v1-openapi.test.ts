import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import {
  institutionalApiV1OpenApi,
} from "../../openapi/institutional-api-v1";
import { registerInstitutionalApiV1DocsRoutes } from "../institutional-api-docs-v1";

const dataPaths = [
  "/api/v1/institutional/funds/{managerId}",
  "/api/v1/institutional/funds/{managerId}/analytics",
  "/api/v1/institutional/stocks/{symbol}",
  "/api/v1/institutional/stocks/{symbol}/trend",
  "/api/v1/institutional/trends/accumulation",
  "/api/v1/institutional/trends/reduction",
  "/api/v1/institutional/trends/new-positions",
  "/api/v1/institutional/trends/exits",
  "/api/v1/institutional/rotation/sectors",
  "/api/v1/institutional/rotation/industries",
  "/api/v1/institutional/rotation/themes",
] as const;

const multibaggerPaths = [
  "/api/v1/multibagger/{symbol}",
  "/api/v1/multibagger/screener",
] as const;

describe("institutional v1 OpenAPI contract", () => {
  it("is a complete OpenAPI 3.x document for every current v1 endpoint", () => {
    expect(institutionalApiV1OpenApi.openapi).toMatch(/^3\./);
    expect(institutionalApiV1OpenApi.info.version).toBe("1.0.0");
    expect(institutionalApiV1OpenApi.paths["/api/v1/openapi.json"]).toBeTruthy();
    expect(institutionalApiV1OpenApi.paths["/api/v1/health"]).toBeTruthy();
    for (const path of dataPaths) {
      const operation = institutionalApiV1OpenApi.paths[path]?.get;
      expect(operation, `${path} is undocumented`).toBeTruthy();
      expect(operation?.operationId).toBeTruthy();
      expect(operation?.security).toEqual([{ bearerAuth: ["institutional:read"] }]);
      expect(operation?.responses["200"]).toBeTruthy();
      expect(operation?.responses["400"]).toBeTruthy();
      expect(operation?.responses["401"]).toBeTruthy();
      expect(operation?.responses["403"]).toBeTruthy();
      expect(operation?.responses["429"]).toBeTruthy();
    }
    for (const path of multibaggerPaths) {
      const operation = institutionalApiV1OpenApi.paths[path]?.get;
      expect(operation, `${path} is undocumented`).toBeTruthy();
      expect(operation?.security).toEqual([{ bearerAuth: ["multibagger:read"] }]);
      expect(operation?.responses["200"]).toBeTruthy();
      expect(operation?.responses["400"]).toBeTruthy();
      expect(operation?.responses["401"]).toBeTruthy();
      expect(operation?.responses["403"]).toBeTruthy();
      expect(operation?.responses["429"]).toBeTruthy();
    }
  });

  it("documents authentication scopes, limits, filters, and response contracts", () => {
    const scheme = institutionalApiV1OpenApi.components.securitySchemes.bearerAuth;
    expect(scheme).toMatchObject({
      type: "http",
      scheme: "bearer",
      bearerFormat: "StockMetrics API key",
      "x-scopes": {
        "institutional:read": expect.any(String),
        "multibagger:read": expect.any(String),
        "fundamentals:read": expect.any(String),
        "research:read": expect.any(String),
      },
    });

    const parameters = institutionalApiV1OpenApi.components.parameters;
    expect(parameters.Quarter.schema).toMatchObject({
      pattern: "^(latest|\\d{4}-Q[1-4])$",
      default: "latest",
    });
    expect(parameters.PositionType.schema.enum).toEqual([
      "COMMON_EQUITY",
      "PUT",
      "CALL",
    ]);
    expect(parameters.Cohort.schema.enum).toContain("technology_specialist");
    expect(parameters.SortBy.schema.enum).toContain("netHolderIncrease");
    expect(parameters.SortDirection.schema.enum).toEqual(["asc", "desc"]);
    expect(parameters.Limit.schema).toMatchObject({ minimum: 1, maximum: 100 });
    expect(parameters.Offset.schema).toMatchObject({ minimum: 0 });
    expect(parameters.HistoryQuarters.schema).toMatchObject({ maximum: 8 });
    expect(parameters.MultibaggerProfile.schema.enum).toEqual([
      "fiveX",
      "tenX",
      "twentyFiveX",
      "hundredX",
    ]);
    expect(parameters.MultibaggerMinOverallScore.schema).toMatchObject({
      minimum: 0,
      maximum: 100,
    });
    expect(parameters.MultibaggerMinInstitutionalScore.schema).toMatchObject({
      minimum: 0,
      maximum: 100,
    });
    expect(parameters.MultibaggerLimit.schema).toMatchObject({
      minimum: 1,
      maximum: 100,
      default: 25,
    });

    expect(institutionalApiV1OpenApi.components.headers["X-RateLimit-Limit"]).toBeTruthy();
    expect(institutionalApiV1OpenApi.components.headers["X-RateLimit-Remaining"]).toBeTruthy();
    expect(institutionalApiV1OpenApi.components.headers["X-RateLimit-Reset"]).toBeTruthy();
    expect(institutionalApiV1OpenApi.components.headers["Retry-After"]).toBeTruthy();
    expect(institutionalApiV1OpenApi.components.schemas.ApiMeta).toBeTruthy();
    expect(institutionalApiV1OpenApi.components.schemas.ErrorEnvelope).toBeTruthy();
    expect(institutionalApiV1OpenApi.components.schemas.MultibaggerCandidate).toBeTruthy();
    expect(institutionalApiV1OpenApi.components.schemas.MultibaggerScreener).toBeTruthy();
    expect(institutionalApiV1OpenApi.components.schemas.MultibaggerProfiles).toBeTruthy();
    expect(institutionalApiV1OpenApi.components.responses.RateLimited).toBeTruthy();
  });

  it("documents the Multibagger response shape and cautious language", () => {
    const serialized = JSON.stringify({
      paths: Object.fromEntries(
        multibaggerPaths.map((path) => [
          path,
          institutionalApiV1OpenApi.paths[path],
        ]),
      ),
      schemas: {
        candidate:
          institutionalApiV1OpenApi.components.schemas.MultibaggerCandidate,
        profiles:
          institutionalApiV1OpenApi.components.schemas.MultibaggerProfiles,
      },
    });
    expect(serialized).toContain("overallScore");
    expect(serialized).toContain("componentScores");
    expect(serialized).toContain("supportingFactors");
    expect(serialized).toContain("limitingFactors");
    expect(serialized).toContain("dataQuality");
    expect(serialized).toContain("twentyFiveX");
    expect(serialized).not.toMatch(/\bstrong buy\b/i);
    expect(serialized).not.toMatch(/\bwill 10x\b/i);
    expect(serialized).not.toMatch(/\bguaranteed\b/i);
  });

  it("includes curl, JavaScript fetch, and TypeScript accumulation examples", () => {
    const operation =
      institutionalApiV1OpenApi.paths[
        "/api/v1/institutional/trends/accumulation"
      ].get;
    const examples = operation["x-codeSamples"];
    expect(examples).toEqual(expect.arrayContaining([
      expect.objectContaining({ lang: "curl" }),
      expect.objectContaining({ lang: "JavaScript" }),
      expect.objectContaining({ lang: "TypeScript" }),
    ]));
    expect(JSON.stringify(examples)).toContain(
      "/api/v1/institutional/trends/accumulation",
    );
    expect(JSON.stringify(institutionalApiV1OpenApi.info.description)).toContain(
      "latest",
    );
  });

  it("contains no private database or credential material", () => {
    const serialized = JSON.stringify(institutionalApiV1OpenApi);
    expect(serialized).not.toMatch(/DATABASE_URL|postgres(?:ql)? connection|keyHash|api_clients|api_keys/i);
    expect(serialized).not.toMatch(/sk_(?:live|test)_|Bearer [A-Za-z0-9+/=]{24,}/);
    expect(serialized).toContain("13F information is delayed");
  });
});

describe("GET /api/v1/openapi.json", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    registerInstitutionalApiV1DocsRoutes(app);
    server = await new Promise<Server>((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Unable to resolve OpenAPI test server address");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  it("serves machine-readable JSON without authentication", async () => {
    const response = await fetch(`${baseUrl}/api/v1/openapi.json`);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toContain("max-age=300");
    expect(body.openapi).toBe("3.1.0");
    expect(body.paths["/api/v1/institutional/trends/accumulation"]).toBeTruthy();
    expect(body.paths["/api/v1/multibagger/screener"]).toBeTruthy();
  });
});