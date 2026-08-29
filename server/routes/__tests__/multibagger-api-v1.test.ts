import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { computeMultibaggerDiscovery } from "../../services/multibagger";
import type {
  MultibaggerDiscoveryInput,
} from "../../services/multibagger";
import {
  registerMultibaggerApiV1Routes,
  type MultibaggerScreenerCandidate,
} from "../multibagger-api-v1";

const candidates: MultibaggerScreenerCandidate[] = [
  {
    symbol: "ALFA",
    sector: "Technology",
    industry: "Software",
    themes: ["AI Infrastructure"],
  },
  {
    symbol: "BETA",
    sector: "Healthcare",
    industry: "Biotechnology",
    themes: ["Biotechnology"],
  },
];

function institutionalSignals(
  trend:
    | "ACCELERATING_ACCUMULATION"
    | "ACCUMULATION"
    | "STABLE"
    | "DISTRIBUTION"
    | "ACCELERATING_DISTRIBUTION",
) {
  return {
    institutionalAccumulationScore:
      trend.includes("DISTRIBUTION") ? 25 : 88,
    institutionalTrend: trend,
    reportedHolderGrowth: trend.includes("DISTRIBUTION") ? -15 : 40,
    newManagerBreadth: trend.includes("DISTRIBUTION") ? 0 : 30,
    aggregateReportedShareTrend: trend.includes("DISTRIBUTION") ? -20 : 50,
    multiQuarterPersistence: trend.includes("DISTRIBUTION") ? 20 : 90,
    specialistManagerParticipation: null,
    institutionalDiscoveryStage:
      trend.includes("DISTRIBUTION") ? "MATURE_OR_CROWDED" : "EARLY_DISCOVERY",
    reportedHolderCount: 12,
    accumulationModelVersion: "institutional_accumulation_v1",
    context: {
      scope: "TRACKED_REPORTED_13F_MANAGERS",
      delayedReporting: true,
      eligible: true,
      dataQuarter: "2026-Q1",
      dataAsOf: "2026-03-31",
      analyticsStatus: "complete",
      trendStatus: "complete",
      mappingCoveragePercent: 100,
      trendCoveragePercent: 100,
      reportingManagerCount: 12,
      warnings: [
        "Form 13F information is delayed and limited to tracked reported managers.",
      ],
    },
  } as const;
}

function completeInput(
  symbol: string,
  options: {
    marketCap: number;
    revenueGrowth: number;
    institutionalTrend:
      | "ACCELERATING_ACCUMULATION"
      | "ACCUMULATION"
      | "STABLE"
      | "DISTRIBUTION"
      | "ACCELERATING_DISTRIBUTION";
  },
): MultibaggerDiscoveryInput {
  return {
    symbol,
    institutionalSignals: institutionalSignals(options.institutionalTrend),
    growth: {
      revenueGrowthYoYPercent: options.revenueGrowth,
      revenueCagr3yPercent: options.revenueGrowth - 5,
      epsGrowthYoYPercent: options.revenueGrowth - 10,
      freeCashFlowGrowthYoYPercent: options.revenueGrowth - 15,
    },
    fundamental: {
      grossMarginPercent: 72,
      operatingMarginPercent: 24,
      freeCashFlowMarginPercent: 18,
      returnOnInvestedCapitalPercent: 22,
      debtToEquity: 0.2,
      earningsStabilityPercent: 85,
    },
    valuation: {
      marketCapDollars: options.marketCap,
      revenueDollars: 200_000_000,
      enterpriseValueDollars: options.marketCap,
      forwardPriceToEarnings: 25,
      priceToSales: 4,
      enterpriseValueToRevenue: 4,
    },
    runway: {
      currentMarketCap: options.marketCap,
      revenue: 200_000_000,
      revenueGrowth: options.revenueGrowth,
      addressableMarketDollars: 150_000_000_000,
      addressableMarketReliable: true,
      industryGrowthPercent: 20,
      operatingMarginPercent: 24,
      freeCashFlowMarginPercent: 18,
      freeCashFlowGrowthPercent: 30,
      freeCashFlowPositive: true,
      shareDilutionPercent: 2,
      balanceSheetStrength: 90,
      cashAndEquivalentsDollars: 400_000_000,
      annualCashBurnDollars: 30_000_000,
      yearsToProfitability: 1,
    },
    risk: {
      annualizedVolatilityPercent: 25,
      maxDrawdownPercent: 20,
      debtToEquity: 0.2,
      customerConcentrationPercent: 15,
      regulatoryRisk: "low",
    },
  };
}

const inputBySymbol: Record<string, MultibaggerDiscoveryInput> = {
  ALFA: completeInput("ALFA", {
    marketCap: 600_000_000,
    revenueGrowth: 52,
    institutionalTrend: "ACCELERATING_ACCUMULATION",
  }),
  BETA: completeInput("BETA", {
    marketCap: 90_000_000_000,
    revenueGrowth: 12,
    institutionalTrend: "DISTRIBUTION",
  }),
  NONE: { symbol: "NONE" },
};

describe("Multibagger API v1 contract", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    registerMultibaggerApiV1Routes(app, {
      authorize: async (req) => {
        const authorization = req.header("authorization");
        if (authorization === "Bearer scoped") {
          return { clientId: "client-1", scopes: ["multibagger:read"] };
        }
        if (authorization === "Bearer wrong-scope") {
          return { clientId: "client-2", scopes: ["institutional:read"] };
        }
        return null;
      },
      listCandidates: async () => candidates,
      getCandidateMetadata: async (symbol) =>
        candidates.find((candidate) => candidate.symbol === symbol) ?? null,
      loadDiscoveryInput: async (symbol) =>
        inputBySymbol[symbol] ?? { symbol },
      computeDiscovery: computeMultibaggerDiscovery,
    });
    server = await new Promise<Server>((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Unable to resolve Multibagger API test server address");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  async function get(path: string, authorization?: string) {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: authorization ? { Authorization: authorization } : {},
    });
    return { response, body: await response.json() };
  }

  it("requires authentication and the multibagger:read scope", async () => {
    const missing = await get("/api/v1/multibagger/ALFA");
    expect(missing.response.status).toBe(401);
    expect(missing.body.error.code).toBe("UNAUTHORIZED");

    const wrongScope = await get(
      "/api/v1/multibagger/ALFA",
      "Bearer wrong-scope",
    );
    expect(wrongScope.response.status).toBe(403);
    expect(wrongScope.body.error.code).toBe("INSUFFICIENT_SCOPE");

    const allowed = await get("/api/v1/multibagger/ALFA", "Bearer scoped");
    expect(allowed.response.status).toBe(200);
  });

  it("validates symbols and preserves the static screener route", async () => {
    const invalid = await get(
      "/api/v1/multibagger/not%20valid",
      "Bearer scoped",
    );
    expect(invalid.response.status).toBe(400);
    expect(invalid.body.error.code).toBe("INVALID_SYMBOL");

    const screener = await get(
      "/api/v1/multibagger/screener?limit=1",
      "Bearer scoped",
    );
    expect(screener.response.status).toBe(200);
    expect(screener.body.data.limit).toBe(1);
  });

  it("returns the versioned public response shape without raw internal inputs", async () => {
    const { response, body } = await get(
      "/api/v1/multibagger/ALFA",
      "Bearer scoped",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=300");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(body.data).toMatchObject({
      symbol: "ALFA",
      modelVersion: "multibagger_v1",
      profiles: {
        fiveX: expect.objectContaining({ classification: expect.any(String) }),
        tenX: expect.objectContaining({ classification: expect.any(String) }),
        twentyFiveX: expect.objectContaining({ classification: expect.any(String) }),
        hundredX: expect.objectContaining({ classification: expect.any(String) }),
      },
      componentScores: {
        institutional: expect.any(Number),
        growth: expect.any(Number),
        fundamentals: expect.any(Number),
        valuation: expect.any(Number),
        runway: expect.any(Number),
        optionality: expect.any(Number),
        risk: expect.any(Number),
      },
      dataAsOf: "2026-03-31",
      sector: "Technology",
      industry: "Software",
      themes: ["AI Infrastructure"],
    });
    expect(body.data).toHaveProperty("overallScore");
    expect(body.data).toHaveProperty("supportingFactors");
    expect(body.data).toHaveProperty("limitingFactors");
    expect(body.data).toHaveProperty("dataQuality");
    expect(body.data).not.toHaveProperty("institutionalSignals");
    expect(body.data).not.toHaveProperty("specialistManagerParticipation");
  });

  it("fails closed when data is unavailable", async () => {
    const { response, body } = await get(
      "/api/v1/multibagger/NONE",
      "Bearer scoped",
    );
    expect(response.status).toBe(200);
    expect(body.data.overallScore).toBeNull();
    expect(body.data.dataQuality.status).toBe("unavailable");
    expect(body.data.dataQuality.unavailableComponents).toHaveLength(7);
    expect(Object.values(body.data.componentScores).every(
      (value) => value === null,
    )).toBe(true);
  });

  it("applies metadata, score, trend, market-cap, growth, and pagination filters", async () => {
    const filtered = await get(
      "/api/v1/multibagger/screener" +
        "?sector=Technology" +
        "&theme=AI%20Infrastructure" +
        "&minOverallScore=60" +
        "&marketCapMax=1000000000" +
        "&institutionalTrend=ACCELERATING_ACCUMULATION" +
        "&minInstitutionalScore=60" +
        "&minRevenueGrowth=40" +
        "&limit=10&offset=0",
      "Bearer scoped",
    );
    expect(filtered.response.status).toBe(200);
    expect(filtered.body.data.totalCount).toBe(1);
    expect(filtered.body.data.candidates.map(
      (candidate: { symbol: string }) => candidate.symbol,
    )).toEqual(["ALFA"]);

    const paged = await get(
      "/api/v1/multibagger/screener?limit=1&offset=1",
      "Bearer scoped",
    );
    expect(paged.response.status).toBe(200);
    expect(paged.body.data.totalCount).toBe(2);
    expect(paged.body.data.candidates).toHaveLength(1);
  });

  it("validates screener bounds and rejects unsupported parameters", async () => {
    const inverted = await get(
      "/api/v1/multibagger/screener?marketCapMin=10&marketCapMax=1",
      "Bearer scoped",
    );
    expect(inverted.response.status).toBe(400);
    expect(inverted.body.error.code).toBe("INVALID_QUERY");

    const unsupported = await get(
      "/api/v1/multibagger/screener?certainty=high",
      "Bearer scoped",
    );
    expect(unsupported.response.status).toBe(400);
  });

  it("uses candidate-profile language without recommendation or certainty claims", async () => {
    const { body } = await get(
      "/api/v1/multibagger/ALFA",
      "Bearer scoped",
    );
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/\bstrong buy\b/i);
    expect(serialized).not.toMatch(/\bbuy\b/i);
    expect(serialized).not.toMatch(/\bwill 10x\b/i);
    expect(serialized).not.toMatch(/\bguaranteed\b/i);
    expect(serialized).toContain("candidate profile screen");
  });
});