import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { registerInstitutionalApiV1Routes } from "../institutional-api-v1";
import { createExternalApiUsageMiddleware } from "../../services/external-api-security";

const quarter = {
  year: 2026,
  quarter: 1,
  label: "2026-Q1",
  periodEndDate: "2026-03-31",
} as const;
const modelVersion = { name: "test-model", version: "1.2.3" };
const dataQuality = {
  status: "complete",
  coveragePercent: 100,
  warnings: ["Reported values can change with security prices."],
};

function result(extra: Record<string, unknown> = {}) {
  return { quarter, modelVersion, dataQuality, ...extra };
}

const services = {
  getFundPortfolioAnalytics: vi.fn(async () =>
    result({ managerId: "0000001234", managerName: "Test Manager" })),
  getStockInstitutionalAnalytics: vi.fn(async () =>
    result({ symbol: "AAPL", dataAsOf: "2026-03-31" })),
  getStockInstitutionalTrend: vi.fn(async () => ({
    symbol: "AAPL",
    quarters: [{ quarter }],
    classification: "ACCUMULATION",
    modelVersion,
    dataQuality,
  })),
  getInstitutionalAccumulationRanking: vi.fn(async () =>
    result({ mode: "ACCUMULATION", items: [], totalCount: 0 })),
  getInstitutionalReductionRanking: vi.fn(async () =>
    result({ mode: "REDUCTION", items: [], totalCount: 0 })),
  getNewlyReportedRanking: vi.fn(async () =>
    result({ mode: "NEWLY_REPORTED", items: [], totalCount: 0 })),
  getNoLongerReportedRanking: vi.fn(async () =>
    result({ mode: "NO_LONGER_REPORTED", items: [], totalCount: 0 })),
  getSectorRotation: vi.fn(async () =>
    result({ kind: "SECTOR", classifications: [] })),
  getIndustryRotation: vi.fn(async () =>
    result({ kind: "INDUSTRY", classifications: [] })),
  getThemeRotation: vi.fn(async () =>
    result({ kind: "THEME", classifications: [] })),
};

let server: Server;
let baseUrl: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
const usageSpy = vi.fn(async () => undefined);

async function apiGet(path: string, requestId?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: requestId ? { "X-Request-Id": requestId } : undefined,
  });
  const body = await response.json();
  return { response, body };
}

beforeAll(async () => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const app = express();
  app.use(
    "/api/v1",
    createExternalApiUsageMiddleware({ recordUsage: usageSpy }),
  );
  registerInstitutionalApiV1Routes(app, services as any);
  server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to resolve integration test server address");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

describe("External Institutional Intelligence API v1", () => {
  it("serves versioned health with request ID and short cache policy", async () => {
    const { response, body } = await apiGet(
      "/api/v1/health",
      "client-request-123",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("client-request-123");
    expect(response.headers.get("cache-control")).toContain("max-age=30");
    expect(body).toEqual({
      data: { status: "ok", apiVersion: "v1" },
      meta: expect.objectContaining({
        quarter: null,
        dataAsOf: null,
        modelVersion: "institutional-api-v1",
        source: "SEC Form 13F reported holdings",
        requestId: "client-request-123",
        limitations: expect.any(Array),
      }),
    });
  });

  it("uses the same generated request ID in the response and usage record", async () => {
    usageSpy.mockClear();
    const { response, body } = await apiGet(
      "/api/v1/institutional/stocks/aapl",
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const responseId = response.headers.get("x-request-id");
    expect(responseId).toBeTruthy();
    expect(body.meta.requestId).toBe(responseId);
    expect(usageSpy).toHaveBeenCalledWith(expect.objectContaining({
      requestId: responseId,
      responseStatus: 200,
      endpoint: "/api/v1/institutional/stocks/aapl",
    }));
  });

  const endpoints = [
    ["/api/v1/institutional/funds/1234", "getFundPortfolioAnalytics"],
    ["/api/v1/institutional/funds/1234/analytics", "getFundPortfolioAnalytics"],
    ["/api/v1/institutional/stocks/aapl", "getStockInstitutionalAnalytics"],
    ["/api/v1/institutional/stocks/aapl/trend", "getStockInstitutionalTrend"],
    ["/api/v1/institutional/trends/accumulation", "getInstitutionalAccumulationRanking"],
    ["/api/v1/institutional/trends/reduction", "getInstitutionalReductionRanking"],
    ["/api/v1/institutional/trends/new-positions", "getNewlyReportedRanking"],
    ["/api/v1/institutional/trends/exits", "getNoLongerReportedRanking"],
    ["/api/v1/institutional/rotation/sectors", "getSectorRotation"],
    ["/api/v1/institutional/rotation/industries", "getIndustryRotation"],
    ["/api/v1/institutional/rotation/themes", "getThemeRotation"],
  ] as const;

  it.each(endpoints)(
    "serves %s through its analytics domain dependency",
    async (path, dependency) => {
      const callCount = services[dependency].mock.calls.length;
      const { response, body } = await apiGet(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("max-age=300");
      expect(response.headers.get("x-request-id")).toMatch(
        /^[0-9a-f]{8}-[0-9a-f-]{27}$/i,
      );
      expect(body.data).toBeTruthy();
      expect(body.meta).toEqual(expect.objectContaining({
        quarter: "2026-Q1",
        dataAsOf: "2026-03-31",
        modelVersion: "1.2.3",
        source: "SEC Form 13F reported holdings",
        requestId: expect.any(String),
        limitations: expect.arrayContaining([
          "Reported values can change with security prices.",
        ]),
      }));
      expect(services[dependency].mock.calls.length).toBe(callCount + 1);
    },
  );

  it("normalizes manager IDs and passes bounded fund options", async () => {
    await apiGet(
      "/api/v1/institutional/funds/1234/analytics?quarter=2026-Q1&positionType=CALL&topN=25",
    );
    expect(services.getFundPortfolioAnalytics).toHaveBeenLastCalledWith(
      "0000001234",
      "2026-Q1",
      { positionType: "CALL", topN: 25 },
    );
  });

  it("passes validated stock and trend filters to domain services", async () => {
    await apiGet(
      "/api/v1/institutional/stocks/aapl?quarter=2026-Q1&cohort=pension&topN=15",
    );
    expect(services.getStockInstitutionalAnalytics).toHaveBeenLastCalledWith(
      "AAPL",
      "2026-Q1",
      expect.objectContaining({
        cohort: "pension",
        positionType: "COMMON_EQUITY",
        topN: 15,
      }),
    );

    await apiGet(
      "/api/v1/institutional/stocks/msft/trend?quarter=2025-Q4&cohort=asset_manager&historyQuarters=4",
    );
    expect(services.getStockInstitutionalTrend).toHaveBeenLastCalledWith(
      "MSFT",
      expect.objectContaining({
        quarter: "2025-Q4",
        cohort: "asset_manager",
        historyQuarters: 4,
      }),
    );
  });

  it("passes safe ranking filters, pagination, and sorting", async () => {
    await apiGet(
      "/api/v1/institutional/trends/accumulation" +
      "?quarter=2026-Q1&sector=Technology&cohort=hedge_fund" +
      "&marketCapMin=1000000&marketCapMax=9000000000&minManagers=2" +
      "&minReportedValue=500000&sortBy=reportedValue&sortDirection=asc" +
      "&limit=25&offset=50",
    );
    expect(
      services.getInstitutionalAccumulationRanking,
    ).toHaveBeenLastCalledWith(expect.objectContaining({
      quarter: "2026-Q1",
      sector: "Technology",
      cohort: "hedge_fund",
      marketCapMin: 1_000_000,
      marketCapMax: 9_000_000_000,
      minManagers: 2,
      minReportedValue: 500_000,
      sortBy: "reportedValue",
      sortDirection: "asc",
      limit: 25,
      offset: 50,
    }));
  });

  it("passes validated cohort and quarter filters to rotation services", async () => {
    await apiGet(
      "/api/v1/institutional/rotation/themes?quarter=2025-Q4&cohort=technology_specialist&positionType=PUT",
    );
    expect(services.getThemeRotation).toHaveBeenLastCalledWith({
      quarter: "2025-Q4",
      cohort: "technology_specialist",
      positionType: "PUT",
    });
  });

  it.each([
    "/api/v1/institutional/funds/not-a-cik",
    "/api/v1/institutional/stocks/bad!",
    "/api/v1/institutional/stocks/AAPL?quarter=2026-Q5",
    "/api/v1/institutional/stocks/AAPL?topN=101",
    "/api/v1/institutional/trends/accumulation?sortBy=unsafe",
    "/api/v1/institutional/trends/accumulation?limit=101",
    "/api/v1/institutional/trends/accumulation?marketCapMin=10&marketCapMax=1",
    "/api/v1/institutional/rotation/sectors?cohort=unsupported",
    "/api/v1/institutional/rotation/sectors?unknownFilter=true",
  ])("returns a machine-readable validation error for %s", async (path) => {
    const { response, body } = await apiGet(path);
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      error: {
        code: expect.stringMatching(/^INVALID_/),
        message: expect.any(String),
        requestId: expect.any(String),
      },
    });
  });

  it("returns a stable unavailable error when a domain service has no result", async () => {
    services.getSectorRotation.mockResolvedValueOnce(null as any);
    const { response, body } = await apiGet(
      "/api/v1/institutional/rotation/sectors",
    );
    expect(response.status).toBe(404);
    expect(body.error).toEqual({
      code: "DATA_UNAVAILABLE",
      message: expect.any(String),
      requestId: expect.any(String),
    });
  });

  it("does not expose internal errors or stack traces", async () => {
    services.getIndustryRotation.mockRejectedValueOnce(
      new Error("database password leaked in internal stack"),
    );
    const { response, body } = await apiGet(
      "/api/v1/institutional/rotation/industries",
    );
    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Unable to retrieve institutional intelligence.",
        requestId: expect.any(String),
      },
    });
    expect(JSON.stringify(body)).not.toContain("password");
    expect(JSON.stringify(body)).not.toContain("stack");
  });

  it("generates a safe request ID when the incoming one is invalid", async () => {
    const { response, body } = await apiGet(
      "/api/v1/health",
      "invalid request id with spaces",
    );
    expect(response.headers.get("x-request-id")).not.toBe(
      "invalid request id with spaces",
    );
    expect(body.meta.requestId).toBe(response.headers.get("x-request-id"));
  });
});