import { describe, expect, it } from "vitest";
import {
  INSTITUTIONAL_ANALYTICS_LAYER,
  createCohortInstitutionalAnalytics,
  createFundPortfolioAnalytics,
  createInstitutionalQuarter,
  createInstitutionalTrend,
  createMarketInstitutionalAnalytics,
  createSectorInstitutionalAnalytics,
  createStockInstitutionalAnalytics,
  type CohortInstitutionalSourceSnapshot,
  type FundAnalyticsService,
  type FundPortfolioAnalytics,
  type FundPortfolioSourceSnapshot,
  type InstitutionalAnalyticsRepository,
  type InstitutionalScoreResult,
  type MarketInstitutionalSourceSnapshot,
  type ModelVersion,
  type SectorInstitutionalSourceSnapshot,
  type SecurityPositionType,
  type StockInstitutionalSourceSnapshot,
  type StockAnalyticsService,
  type TrendInstitutionalSourceSnapshot,
} from "../analytics";

describe("institutional analytics domain boundary", () => {
  it("imports from the server domain without a React/UI dependency", () => {
    expect(INSTITUTIONAL_ANALYTICS_LAYER).toBe("institutional-analytics");
    expect(createInstitutionalQuarter("2026-Q2")).toEqual({
      year: 2026,
      quarter: 2,
      label: "2026-Q2",
      periodEndDate: "2026-06-30",
    });
  });

  it("normalizes latest as a selector without inventing a period date", () => {
    expect(createInstitutionalQuarter("latest")).toBeNull();
  });

  it("supports the shared contracts independently of client modules", async () => {
    const modelVersion: ModelVersion = {
      name: "institutional-foundation",
      version: "0.1.0",
    };
    const positionType: SecurityPositionType = "COMMON_EQUITY";
    const analytics: FundPortfolioAnalytics = {
      managerId: "0000000001",
      managerName: "Example Manager",
      quarter: createInstitutionalQuarter("2026-Q1")!,
      reportedPortfolioValueDollars: 1_000_000,
      reportedPositionCount: 1,
      positionsByType: [
        {
          securityPositionType: positionType,
          positionCount: 1,
          reportedValueDollars: 1_000_000,
          reportedShares: 10_000,
        },
      ],
      largestPositions: [],
      dataQuality: {
        status: "complete",
        coveragePercent: 100,
        warnings: [],
      },
      modelVersion,
    };

    const repositoryPort: InstitutionalAnalyticsRepository = {
      async getFundPortfolioSnapshot() {
        return null;
      },
      async getStockInstitutionalSnapshot() {
        return null;
      },
      async getMarketSnapshot() {
        return null;
      },
      async getSectorSnapshot() {
        return null;
      },
      async getTrendSnapshot() {
        return null;
      },
      async getCohortSnapshot() {
        return null;
      },
    };
    const fundService: FundAnalyticsService = {
      async getPortfolioAnalytics() {
        return analytics;
      },
    };
    const stockService: StockAnalyticsService = {
      async getStockAnalytics() {
        return null;
      },
    };
    const score: InstitutionalScoreResult = {
      score: null,
      components: [],
      status: "insufficient_data",
      modelVersion,
      limitations: ["Foundation contract only"],
    };

    expect(repositoryPort).toBeDefined();
    expect(await fundService.getPortfolioAnalytics({ managerId: "0000000001" })).toBe(analytics);
    expect(await stockService.getStockAnalytics({ symbol: "AAPL" })).toBeNull();
    expect(score.modelVersion).toEqual(modelVersion);
  });

  it("maps every repository snapshot without fabricating unavailable data", () => {
    const quarter = createInstitutionalQuarter("2026-Q1")!;
    const comparisonQuarter = createInstitutionalQuarter("2025-Q4")!;
    const modelVersion: ModelVersion = { name: "foundation", version: "0.1.0" };
    const dataQuality = {
      status: "partial" as const,
      coveragePercent: 80,
      warnings: ["One field is unavailable"],
    };
    const managerBreadth = {
      scope: "managers" as const,
      totalEntityCount: 10,
      increasingEntityCount: 4,
      decreasingEntityCount: 3,
      newEntityCount: 2,
      exitedEntityCount: 1,
      breadthRatio: 0.1,
      direction: "broadening" as const,
    };
    const symbolBreadth = {
      ...managerBreadth,
      scope: "symbols" as const,
    };
    const trend: TrendInstitutionalSourceSnapshot = {
      direction: "stable",
      currentQuarter: quarter,
      comparisonQuarter,
      observations: 2,
      confidence: "limited",
    };

    const fundSnapshot: FundPortfolioSourceSnapshot = {
      managerId: "0000000001",
      managerName: "Example Manager",
      quarter,
      reportedPortfolioValueDollars: 1_000_000,
      reportedPositionCount: 1,
      positionsByType: [],
      largestPositions: [{
        symbol: "AAPL",
        issuerName: "Apple Inc.",
        reportedValueDollars: 1_000_000,
        portfolioWeightPercent: 100,
        changeType: null,
      }],
      dataQuality,
    };
    const stockSnapshot: StockInstitutionalSourceSnapshot = {
      symbol: "AAPL",
      quarter,
      reportingManagerCount: 10,
      aggregateReportedShares: 100_000,
      aggregateReportedValueDollars: 1_000_000,
      managerChangeCounts: {
        new: 2,
        increased: 4,
        unchanged: 0,
        reduced: 3,
        exited: 1,
      },
      breadth: managerBreadth,
      trend,
      dataQuality,
    };
    const marketSnapshot: MarketInstitutionalSourceSnapshot = {
      quarter,
      coveredSymbolCount: 100,
      breadth: symbolBreadth,
      dataQuality,
    };
    const sectorSnapshot: SectorInstitutionalSourceSnapshot = {
      quarter,
      sectors: [{
        sector: "Technology",
        reportedValueDollars: 1_000_000,
        portfolioWeightPercent: null,
        positionCount: 1,
        managerCount: 10,
        changeType: null,
      }],
      industries: [],
      themes: [],
      dataQuality,
    };
    const cohortSnapshot: CohortInstitutionalSourceSnapshot = {
      cohortId: "large-cap-tech",
      quarter,
      memberSymbolCount: 5,
      aggregateReportedValueDollars: 5_000_000,
      reportingManagerCount: 10,
      breadth: symbolBreadth,
      trend: null,
      dataQuality,
    };

    expect(createFundPortfolioAnalytics(fundSnapshot, modelVersion).largestPositions[0].changeType)
      .toBeNull();
    expect(createStockInstitutionalAnalytics(stockSnapshot, modelVersion).breadth)
      .toEqual(managerBreadth);
    expect(createMarketInstitutionalAnalytics(marketSnapshot, modelVersion).breadth.scope)
      .toBe("symbols");
    expect(createSectorInstitutionalAnalytics(sectorSnapshot, modelVersion).sectors[0].portfolioWeightPercent)
      .toBeNull();
    expect(createInstitutionalTrend(trend)).toEqual(trend);
    expect(createCohortInstitutionalAnalytics(cohortSnapshot, modelVersion)).toMatchObject({
      cohortId: "large-cap-tech",
      trend: null,
      modelVersion,
    });
  });
});