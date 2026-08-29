import {
  getStockInstitutionalAnalytics,
  getStockInstitutionalTrend,
} from "../institutional/analytics";
import type {
  StockInstitutionalAnalytics,
  StockInstitutionalTrendResult,
} from "../institutional/analytics/types";
import type {
  FundamentalSignalsInput,
  GrowthSignalsInput,
  MultibaggerDiscoveryInput,
  RiskSignalsInput,
  RunwaySignalsInput,
  ValuationSignalsInput,
} from "./types";

export interface MultibaggerDiscoveryDataLoaders {
  getInstitutionalAnalytics: (
    symbol: string,
  ) => Promise<StockInstitutionalAnalytics | null>;
  getInstitutionalTrend: (
    symbol: string,
  ) => Promise<StockInstitutionalTrendResult | null>;
  getGrowthSignals?: (symbol: string) => Promise<GrowthSignalsInput | null>;
  getFundamentalSignals?: (symbol: string) => Promise<FundamentalSignalsInput | null>;
  getValuationSignals?: (symbol: string) => Promise<ValuationSignalsInput | null>;
  getRunwaySignals?: (symbol: string) => Promise<RunwaySignalsInput | null>;
  getRiskSignals?: (symbol: string) => Promise<RiskSignalsInput | null>;
}

export interface MultibaggerDiscoveryRepository {
  load(symbol: string): Promise<MultibaggerDiscoveryInput>;
}

const defaultLoaders: MultibaggerDiscoveryDataLoaders = {
  getInstitutionalAnalytics: (symbol) =>
    getStockInstitutionalAnalytics(symbol, "latest", {}),
  getInstitutionalTrend: (symbol) =>
    getStockInstitutionalTrend(symbol, { quarter: "latest", historyQuarters: 8 }),
};

async function settle<T>(
  loader: (() => Promise<T | null>) | undefined,
): Promise<T | null> {
  if (!loader) return null;
  const result = await Promise.allSettled([loader()]);
  return result[0].status === "fulfilled" ? result[0].value : null;
}

export function createMultibaggerDiscoveryRepository(
  loaders: Partial<MultibaggerDiscoveryDataLoaders> = {},
): MultibaggerDiscoveryRepository {
  const resolved = { ...defaultLoaders, ...loaders };
  return {
    async load(symbol: string): Promise<MultibaggerDiscoveryInput> {
      const [
        institutionalAnalytics,
        institutionalTrend,
        growth,
        fundamental,
        valuation,
        runway,
        risk,
      ] = await Promise.all([
        settle(() => resolved.getInstitutionalAnalytics(symbol)),
        settle(() => resolved.getInstitutionalTrend(symbol)),
        settle(resolved.getGrowthSignals ? () => resolved.getGrowthSignals!(symbol) : undefined),
        settle(resolved.getFundamentalSignals ? () => resolved.getFundamentalSignals!(symbol) : undefined),
        settle(resolved.getValuationSignals ? () => resolved.getValuationSignals!(symbol) : undefined),
        settle(resolved.getRunwaySignals ? () => resolved.getRunwaySignals!(symbol) : undefined),
        settle(resolved.getRiskSignals ? () => resolved.getRiskSignals!(symbol) : undefined),
      ]);
      return {
        symbol,
        institutionalAnalytics,
        institutionalTrend,
        growth,
        fundamental,
        valuation,
        runway,
        risk,
      };
    },
  };
}

export const multibaggerDiscoveryRepository =
  createMultibaggerDiscoveryRepository();