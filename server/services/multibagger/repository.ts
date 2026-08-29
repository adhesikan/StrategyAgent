import {
  getStockInstitutionalAnalytics,
  getStockInstitutionalTrend,
  listManagerCohorts,
} from "../institutional/analytics";
import type {
  InstitutionalManagerCohort,
  ManagerCohortMembership,
} from "../institutional/manager-cohort-types";
import {
  buildInstitutionalDiscoverySignalInputs,
  isInstitutionalAnalyticsEligible,
} from "./institutional-signals";
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
  VerifiedSpecialistManagerParticipation,
} from "./types";

export interface MultibaggerDiscoveryDataLoaders {
  getInstitutionalAnalytics: (
    symbol: string,
  ) => Promise<StockInstitutionalAnalytics | null>;
  getInstitutionalTrend: (
    symbol: string,
  ) => Promise<StockInstitutionalTrendResult | null>;
  getSpecialistManagerParticipation?: (
    symbol: string,
  ) => Promise<VerifiedSpecialistManagerParticipation | null>;
  getGrowthSignals?: (symbol: string) => Promise<GrowthSignalsInput | null>;
  getFundamentalSignals?: (symbol: string) => Promise<FundamentalSignalsInput | null>;
  getValuationSignals?: (symbol: string) => Promise<ValuationSignalsInput | null>;
  getRunwaySignals?: (symbol: string) => Promise<RunwaySignalsInput | null>;
  getRiskSignals?: (symbol: string) => Promise<RiskSignalsInput | null>;
}

const SPECIALIST_COHORTS = [
  "technology_specialist",
  "healthcare_specialist",
] as const satisfies readonly InstitutionalManagerCohort[];

export interface VerifiedSpecialistCohortSnapshot {
  cohort: VerifiedSpecialistManagerParticipation["cohorts"][number];
  memberships: ManagerCohortMembership[];
  analytics: StockInstitutionalAnalytics | null;
}

export function deriveVerifiedSpecialistManagerParticipation(
  snapshots: VerifiedSpecialistCohortSnapshot[],
): VerifiedSpecialistManagerParticipation | null {
  const relevantSnapshots = snapshots
    .map((snapshot) => ({
      ...snapshot,
      verifiedMemberships: snapshot.memberships.filter(
        (membership) =>
          membership.cohort === snapshot.cohort &&
          membership.status === "ACTIVE" &&
          membership.classificationMethod === "VERIFIED",
      ),
    }))
    .filter((snapshot) => snapshot.verifiedMemberships.length > 0);
  if (relevantSnapshots.length === 0) return null;
  if (
    relevantSnapshots.some(
      ({ analytics }) =>
        !isInstitutionalAnalyticsEligible(analytics) ||
        analytics.reportedHolderCount !== analytics.topReportedHolders.length,
    )
  ) {
    return null;
  }
  const verifiedManagerIds = new Set(
    relevantSnapshots.flatMap((snapshot) =>
      snapshot.verifiedMemberships.map((membership) => membership.managerId),
    ),
  );
  const participatingManagerIds = new Set(
    relevantSnapshots.flatMap((snapshot) =>
      (snapshot.analytics?.topReportedHolders ?? [])
        .filter((holder) => verifiedManagerIds.has(holder.managerId))
        .map((holder) => holder.managerId),
    ),
  );
  return {
    verified: true,
    cohorts: relevantSnapshots.map((snapshot) => snapshot.cohort),
    verifiedManagerUniverseCount: verifiedManagerIds.size,
    participatingManagerCount: participatingManagerIds.size,
    participationPercent:
      (participatingManagerIds.size / verifiedManagerIds.size) * 100,
  };
}

async function loadVerifiedSpecialistManagerParticipation(
  symbol: string,
): Promise<VerifiedSpecialistManagerParticipation | null> {
  const membershipsByCohort = await Promise.all(
    SPECIALIST_COHORTS.map((cohort) =>
      listManagerCohorts({ cohort, status: "ACTIVE" }),
    ),
  );
  const cohorts = SPECIALIST_COHORTS.filter((cohort, index) =>
    membershipsByCohort[index].some(
      (membership) =>
        membership.status === "ACTIVE" &&
        membership.classificationMethod === "VERIFIED",
    ),
  );
  if (cohorts.length === 0) return null;
  const cohortAnalytics = await Promise.all(
    cohorts.map((cohort) =>
      getStockInstitutionalAnalytics(symbol, "latest", {
        cohort,
        topN: 100,
      }),
    ),
  );
  return deriveVerifiedSpecialistManagerParticipation(
    cohorts.map((cohort, index) => ({
      cohort,
      memberships:
        membershipsByCohort[SPECIALIST_COHORTS.indexOf(cohort)],
      analytics: cohortAnalytics[index],
    })),
  );
}

export interface MultibaggerDiscoveryRepository {
  load(symbol: string): Promise<MultibaggerDiscoveryInput>;
}

const defaultLoaders: MultibaggerDiscoveryDataLoaders = {
  getInstitutionalAnalytics: (symbol) =>
    getStockInstitutionalAnalytics(symbol, "latest", {}),
  getInstitutionalTrend: (symbol) =>
    getStockInstitutionalTrend(symbol, { quarter: "latest", historyQuarters: 8 }),
  getSpecialistManagerParticipation:
    loadVerifiedSpecialistManagerParticipation,
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
        specialistManagerParticipation,
        growth,
        fundamental,
        valuation,
        runway,
        risk,
      ] = await Promise.all([
        settle(() => resolved.getInstitutionalAnalytics(symbol)),
        settle(() => resolved.getInstitutionalTrend(symbol)),
        settle(
          resolved.getSpecialistManagerParticipation
            ? () => resolved.getSpecialistManagerParticipation!(symbol)
            : undefined,
        ),
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
        institutionalSignals: buildInstitutionalDiscoverySignalInputs({
          institutionalAnalytics,
          institutionalTrend,
          specialistManagerParticipation,
        }),
        specialistManagerParticipation,
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