import { describe, expect, it, vi } from "vitest";
import type {
  HistoricalPriceSeries,
  HistoricalSymbolEvaluation,
  HistoricalValidationDataProvider,
  HistoricalValidationRunResult,
  PointInTimeModelInputs,
} from "../validation";
import {
  PointInTimeViolationError,
  assertPointInTimeInputs,
  buildScoreDistribution,
  classifyValidationCohorts,
  groupByInstitutionalDiscoveryStage,
  groupByMarketCap,
  groupBySector,
  runHistoricalMultibaggerValidation,
  selectTopDecileOutcomes,
} from "../validation";

const EVALUATION_DATE = "2020-01-02";
const SCORING_ARTIFACT_HASH = "a".repeat(64);

function available<T>(value: T, asOf = EVALUATION_DATE) {
  return {
    status: "available" as const,
    value,
    asOf,
    source: "fixture",
    sourceVersion: "fixture-v1",
  };
}

function unavailable(reason = "not present") {
  return {
    status: "unavailable" as const,
    value: null,
    asOf: null,
    source: "fixture",
    sourceVersion: "fixture-v1",
    reason,
  };
}

function modelInputs(
  symbol: string,
  date = EVALUATION_DATE,
): PointInTimeModelInputs {
  return {
    symbol,
    institutionalAnalytics: unavailable(),
    institutionalTrend: unavailable(),
    institutionalSignals: unavailable(),
    specialistManagerParticipation: unavailable(),
    growth: available(
      {
        revenueGrowthYoYPercent: 35,
        revenueCagr3yPercent: 28,
        epsGrowthYoYPercent: 30,
        freeCashFlowGrowthYoYPercent: 25,
      },
      date,
    ),
    fundamental: available(
      {
        grossMarginPercent: 70,
        operatingMarginPercent: 24,
        freeCashFlowMarginPercent: 20,
        returnOnInvestedCapitalPercent: 18,
        debtToEquity: 0.2,
        earningsStabilityPercent: 85,
      },
      date,
    ),
    valuation: available(
      {
        marketCapDollars: 2_000_000_000,
        revenueDollars: 500_000_000,
        enterpriseValueDollars: 1_900_000_000,
        forwardPriceToEarnings: 25,
        priceToSales: 4,
        enterpriseValueToRevenue: 3.8,
      },
      date,
    ),
    runway: available(
      {
        currentMarketCap: 2_000_000_000,
        revenue: 500_000_000,
        revenueGrowth: 35,
        operatingMarginPercent: 24,
        freeCashFlowMarginPercent: 20,
        freeCashFlowPositive: true,
        balanceSheetStrength: 80,
      },
      date,
    ),
    risk: available(
      {
        annualizedVolatilityPercent: 35,
        maxDrawdownPercent: 28,
        debtToEquity: 0.2,
        customerConcentrationPercent: 15,
        regulatoryRisk: "low",
      },
      date,
    ),
    metadata: available(
      {
        sector: "Technology",
        industry: "Software",
        marketCapDollars: 2_000_000_000,
        marketCapGroup: "SMALL" as const,
      },
      date,
    ),
  };
}

function prices(
  symbol: string,
  overrides: Partial<HistoricalPriceSeries> = {},
): HistoricalPriceSeries {
  return {
    status: "available",
    symbol,
    observations: [
      {
        symbol,
        date: "2019-12-31",
        close: 99,
        source: "fixture-prices",
        sourceVersion: "prices-v1",
      },
      {
        symbol,
        date: EVALUATION_DATE,
        close: 100,
        source: "fixture-prices",
        sourceVersion: "prices-v1",
      },
      {
        symbol,
        date: "2020-06-01",
        close: 120,
        source: "fixture-prices",
        sourceVersion: "prices-v1",
      },
      {
        symbol,
        date: "2020-09-01",
        close: 90,
        source: "fixture-prices",
        sourceVersion: "prices-v1",
      },
      {
        symbol,
        date: "2021-01-02",
        close: 150,
        source: "fixture-prices",
        sourceVersion: "prices-v1",
      },
      {
        symbol,
        date: "2023-01-02",
        close: 250,
        source: "fixture-prices",
        sourceVersion: "prices-v1",
      },
      {
        symbol,
        date: "2025-01-02",
        close: 500,
        source: "fixture-prices",
        sourceVersion: "prices-v1",
      },
    ],
    availableThrough: "2025-01-09",
    source: "fixture-prices",
    sourceVersion: "prices-v1",
    adjustmentBasis: "split_adjusted_close",
    corporateActionPolicyVersion: "fixture-ca-v1",
    ...overrides,
  } as HistoricalPriceSeries;
}

function provider(
  priceLoader: (symbol: string) => HistoricalPriceSeries = prices,
): HistoricalValidationDataProvider {
  return {
    provenance: {
      providerId: "fixture-provider",
      providerVersion: "1",
      datasetVersion: "2025-01-09",
    },
    loadModelInputs: async ({ symbol }) => modelInputs(symbol),
    loadPriceSeries: async ({ symbol }) => priceLoader(symbol),
  };
}

function request() {
  return {
    evaluationDate: EVALUATION_DATE,
    symbolUniverse: ["ZZZ", "AAA", "AAA"],
    modelVersion: "multibagger_v1",
    scoringArtifactHash: SCORING_ARTIFACT_HASH,
    horizons: [5, 1, 3] as Array<1 | 3 | 5>,
  };
}

describe("historical Multibagger validation engine", () => {
  it("records deterministic point-in-time scores, components, outcomes, and provenance", async () => {
    const first = await runHistoricalMultibaggerValidation(
      request(),
      provider(),
    );
    const second = await runHistoricalMultibaggerValidation(
      request(),
      provider(),
    );

    expect(first).toEqual(second);
    expect(first.request.symbolUniverse).toEqual(["AAA", "ZZZ"]);
    expect(first.request.horizons).toEqual([1, 3, 5]);
    expect(first.provenance.runKey).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);

    const evaluation = first.evaluations[0];
    expect(evaluation.symbol).toBe("AAA");
    expect(evaluation.overallScore).toEqual(expect.any(Number));
    expect(Object.keys(evaluation.componentScores).sort()).toEqual([
      "fundamental",
      "growth",
      "institutional",
      "optionality",
      "risk",
      "runway",
      "valuation",
    ]);
    expect(evaluation.evaluationPrice).toMatchObject({
      status: "available",
      date: EVALUATION_DATE,
      close: 100,
    });
    expect(evaluation.outcomes).toHaveLength(3);
    expect(evaluation.outcomes[0]).toMatchObject({
      status: "available",
      horizonYears: 1,
      futureReturnPercent: 50,
      maximumFutureReturnPercent: 50,
      maximumDrawdownPercent: -25,
    });
    expect(evaluation.inputSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(evaluation.priceSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uses future prices only for outcomes, never for evaluation-date scoring", async () => {
    const lowFuture = await runHistoricalMultibaggerValidation(
      request(),
      provider((symbol) =>
        prices(symbol, {
          observations: prices(symbol).observations.map((observation) =>
            observation.date > EVALUATION_DATE
              ? { ...observation, close: 50 }
              : observation,
          ),
        }),
      ),
    );
    const highFuture = await runHistoricalMultibaggerValidation(
      request(),
      provider((symbol) =>
        prices(symbol, {
          observations: prices(symbol).observations.map((observation) =>
            observation.date > EVALUATION_DATE
              ? { ...observation, close: 10_000 }
              : observation,
          ),
        }),
      ),
    );

    expect(
      lowFuture.evaluations.map((evaluation) => ({
        score: evaluation.overallScore,
        components: evaluation.componentScores,
        classification: evaluation.classification,
      })),
    ).toEqual(
      highFuture.evaluations.map((evaluation) => ({
        score: evaluation.overallScore,
        components: evaluation.componentScores,
        classification: evaluation.classification,
      })),
    );
    expect(
      lowFuture.evaluations[0].outcomes[0].futureReturnPercent,
    ).not.toBe(
      highFuture.evaluations[0].outcomes[0].futureReturnPercent,
    );
  });

  it("rejects future-dated wrappers across every model-input family", () => {
    const fields: Array<keyof PointInTimeModelInputs> = [
      "institutionalAnalytics",
      "institutionalTrend",
      "institutionalSignals",
      "specialistManagerParticipation",
      "growth",
      "fundamental",
      "valuation",
      "runway",
      "risk",
      "metadata",
    ];
    for (const field of fields) {
      const inputs = modelInputs("AAA");
      (inputs as any)[field] = available({}, "2020-01-03");
      expect(() =>
        assertPointInTimeInputs(inputs, EVALUATION_DATE),
      ).toThrow(PointInTimeViolationError);
    }
  });

  it("rejects missing, empty, and malformed available-wrapper dates across every input family", () => {
    const fields: Array<keyof PointInTimeModelInputs> = [
      "institutionalAnalytics",
      "institutionalTrend",
      "institutionalSignals",
      "specialistManagerParticipation",
      "growth",
      "fundamental",
      "valuation",
      "runway",
      "risk",
      "metadata",
    ];
    for (const field of fields) {
      for (const invalidDate of [null, undefined, "", "not-a-date"]) {
        const inputs = modelInputs("AAA");
        (inputs as any)[field] = {
          status: "available",
          value: {},
          asOf: invalidDate,
          source: "fixture",
          sourceVersion: "v1",
        };
        expect(
          () => assertPointInTimeInputs(inputs, EVALUATION_DATE),
          `${field} accepted invalid asOf ${String(invalidDate)}`,
        ).toThrow();
      }
    }
  });

  it("rejects malformed availability discriminants and unavailable-state payloads", () => {
    const invalidDiscriminant = modelInputs("AAA");
    (invalidDiscriminant as any).growth = {
      status: "maybe",
      value: {},
      asOf: EVALUATION_DATE,
      source: "fixture",
      sourceVersion: "v1",
    };
    expect(() =>
      assertPointInTimeInputs(invalidDiscriminant, EVALUATION_DATE),
    ).toThrow(/growth.status/);

    const malformedUnavailable = modelInputs("AAA");
    (malformedUnavailable as any).growth = {
      status: "unavailable",
      value: { revenueGrowthYoYPercent: 999 },
      asOf: null,
      source: "fixture",
      sourceVersion: "v1",
      reason: "",
    };
    expect(() =>
      assertPointInTimeInputs(malformedUnavailable, EVALUATION_DATE),
    ).toThrow(/null value and asOf/);

    const missingSource = modelInputs("AAA");
    (missingSource as any).growth = {
      status: "available",
      value: {},
      asOf: EVALUATION_DATE,
      source: "",
      sourceVersion: "v1",
    };
    expect(() =>
      assertPointInTimeInputs(missingSource, EVALUATION_DATE),
    ).toThrow(/growth.source/);
  });

  it("rejects future dates nested in institutional analytics, trends, and signals", () => {
    const analytics = modelInputs("AAA");
    analytics.institutionalAnalytics = available({
      dataAsOf: "2020-01-03",
      quarter: { periodEndDate: "2019-12-31" },
    } as any);
    expect(() =>
      assertPointInTimeInputs(analytics, EVALUATION_DATE),
    ).toThrow(/institutionalAnalytics.dataAsOf/);

    const trend = modelInputs("AAA");
    trend.institutionalTrend = available({
      quarters: [{ quarter: { periodEndDate: "2020-01-03" } }],
    } as any);
    expect(() =>
      assertPointInTimeInputs(trend, EVALUATION_DATE),
    ).toThrow(/institutionalTrend.quarters/);

    const signals = modelInputs("AAA");
    signals.institutionalSignals = available({
      context: { dataAsOf: "2020-01-03" },
    } as any);
    expect(() =>
      assertPointInTimeInputs(signals, EVALUATION_DATE),
    ).toThrow(/institutionalSignals.context.dataAsOf/);
  });

  it("represents unsupported model versions without loading or inferring data", async () => {
    const loadModelInputs = vi.fn();
    const result = await runHistoricalMultibaggerValidation(
      { ...request(), modelVersion: "multibagger_v999" },
      {
        ...provider(),
        loadModelInputs,
      },
    );
    expect(loadModelInputs).not.toHaveBeenCalled();
    expect(result.evaluations).toHaveLength(2);
    expect(result.evaluations[0]).toMatchObject({
      status: "unavailable",
      unavailableReason: "UNSUPPORTED_MODEL_VERSION",
      overallScore: null,
      classification: null,
    });
  });

  it("represents missing prices and insufficient future windows explicitly", async () => {
    const missing = await runHistoricalMultibaggerValidation(
      request(),
      provider((symbol) => ({
        status: "unavailable",
        symbol,
        observations: [],
        availableThrough: null,
        source: "fixture",
        sourceVersion: "v1",
        adjustmentBasis: null,
        corporateActionPolicyVersion: null,
        reason: "missing",
      })),
    );
    expect(missing.evaluations[0].outcomes[0]).toMatchObject({
      status: "unavailable",
      unavailableReason: "PRICE_HISTORY_UNAVAILABLE",
    });

    const short = await runHistoricalMultibaggerValidation(
      request(),
      provider((symbol) =>
        prices(symbol, {
          availableThrough: "2021-01-02",
          observations: prices(symbol).observations.filter(
            (observation) => observation.date <= "2021-01-02",
          ),
        }),
      ),
    );
    expect(short.evaluations[0].outcomes[0].status).toBe("available");
    expect(short.evaluations[0].outcomes[1]).toMatchObject({
      status: "unavailable",
      unavailableReason: "INSUFFICIENT_FUTURE_WINDOW",
    });
  });

  it("does not substitute a future price when the evaluation-date price is absent", async () => {
    const result = await runHistoricalMultibaggerValidation(
      request(),
      provider((symbol) =>
        prices(symbol, {
          observations: prices(symbol).observations.filter(
            (observation) => observation.date > EVALUATION_DATE,
          ),
        }),
      ),
    );
    expect(result.evaluations[0].evaluationPrice.status).toBe("unavailable");
    expect(result.evaluations[0].outcomes[0]).toMatchObject({
      status: "unavailable",
      unavailableReason: "EVALUATION_PRICE_UNAVAILABLE",
    });
  });

  it("rejects unadjusted, duplicate, and out-of-window price observations", async () => {
    await expect(
      runHistoricalMultibaggerValidation(
        request(),
        provider((symbol) => ({
          ...prices(symbol),
          adjustmentBasis: "unadjusted_close" as any,
        })),
      ),
    ).rejects.toThrow(/unsupported adjustment basis/);

    await expect(
      runHistoricalMultibaggerValidation(
        request(),
        provider((symbol) => ({
          ...prices(symbol),
          observations: [
            ...prices(symbol).observations,
            prices(symbol).observations[0],
          ],
        })),
      ),
    ).rejects.toThrow(/duplicate observations/);

    await expect(
      runHistoricalMultibaggerValidation(
        request(),
        provider((symbol) => ({
          ...prices(symbol),
          observations: [
            ...prices(symbol).observations,
            {
              ...prices(symbol).observations[0],
              date: "2019-01-01",
            },
          ],
        })),
      ),
    ).rejects.toThrow(/outside the requested validation window/);
  });

  it("marks stale evaluation and horizon-end prices unavailable", async () => {
    const staleEntry = await runHistoricalMultibaggerValidation(
      request(),
      provider((symbol) =>
        prices(symbol, {
          observations: prices(symbol).observations
            .filter((observation) => observation.date !== EVALUATION_DATE)
            .map((observation) =>
              observation.date === "2019-12-31"
                ? { ...observation, date: "2019-12-25" }
                : observation,
            ),
        }),
      ),
    );
    expect(staleEntry.evaluations[0].outcomes[0]).toMatchObject({
      status: "unavailable",
      unavailableReason: "EVALUATION_PRICE_STALE",
    });

    const staleEnd = await runHistoricalMultibaggerValidation(
      request(),
      provider((symbol) =>
        prices(symbol, {
          observations: prices(symbol).observations.filter(
            (observation) => observation.date !== "2021-01-02",
          ),
        }),
      ),
    );
    expect(staleEnd.evaluations[0].outcomes[0]).toMatchObject({
      status: "unavailable",
      unavailableReason: "HORIZON_END_PRICE_STALE",
    });
  });

  it("changes the run key when point-in-time inputs or prices change", async () => {
    const first = await runHistoricalMultibaggerValidation(
      request(),
      provider(),
    );
    const changedProvider = provider((symbol) => {
      const series = prices(symbol);
      return {
        ...series,
        observations: series.observations.map((observation) =>
          observation.date === "2023-01-02"
            ? { ...observation, close: observation.close + 1 }
            : observation,
        ),
      };
    });
    changedProvider.loadModelInputs = async ({ symbol }) => {
      const inputs = modelInputs(symbol);
      if (inputs.growth.status === "available") {
        inputs.growth.value.revenueGrowthYoYPercent = 36;
      }
      return inputs;
    };
    const changed = await runHistoricalMultibaggerValidation(
      request(),
      changedProvider,
    );
    expect(changed.provenance.runKey).not.toBe(first.provenance.runKey);
  });

  it("binds run identity to the immutable scoring artifact and normalized price order", async () => {
    const first = await runHistoricalMultibaggerValidation(
      request(),
      provider(),
    );
    const changedArtifact = await runHistoricalMultibaggerValidation(
      {
        ...request(),
        scoringArtifactHash: "b".repeat(64),
      },
      provider(),
    );
    expect(changedArtifact.provenance.runKey).not.toBe(
      first.provenance.runKey,
    );

    const reversedPrices = await runHistoricalMultibaggerValidation(
      request(),
      provider((symbol) => {
        const series = prices(symbol);
        return {
          ...series,
          observations: [...series.observations].reverse(),
        };
      }),
    );
    expect(reversedPrices).toEqual(first);
  });
});

function analysisFixture(): HistoricalValidationRunResult {
  const symbols = ["AAA", "BBB", "CCC", "DDD", "EEE"];
  const scores = [80, 80, 20, 20, null];
  const returns = [100, 10, 100, 10, null];
  const evaluations = symbols.map((symbol, index) => {
    const base = {
      symbol,
      evaluationDate: EVALUATION_DATE,
      modelVersion: "multibagger_v1",
      status: scores[index] === null ? "unavailable" : "available",
      unavailableReason:
        scores[index] === null ? "MODEL_INPUTS_UNAVAILABLE" : null,
      overallScore: scores[index],
      componentScores: {
        institutional: scores[index],
        growth: scores[index],
        fundamental: scores[index],
        valuation: scores[index],
        runway: scores[index],
        optionality: scores[index],
        risk: scores[index],
      },
      classification: scores[index] === null ? null : "UNCLASSIFIED",
      profileClassifications: null,
      evaluationPrice: {
        status: "available",
        date: EVALUATION_DATE,
        close: 100,
        source: "fixture",
        sourceVersion: "v1",
      },
      outcomes: [
        returns[index] === null
          ? {
              status: "unavailable",
              horizonYears: 1,
              targetDate: "2021-01-02",
              endPriceDate: null,
              endPrice: null,
              futureReturnPercent: null,
              maximumFutureReturnPercent: null,
              maximumDrawdownPercent: null,
              observationCount: 0,
              unavailableReason: "INSUFFICIENT_FUTURE_WINDOW",
            }
          : {
              status: "available",
              horizonYears: 1,
              targetDate: "2021-01-02",
              endPriceDate: "2021-01-02",
              endPrice: 100 + returns[index]!,
              futureReturnPercent: returns[index]!,
              maximumFutureReturnPercent: returns[index]!,
              maximumDrawdownPercent: 0,
              observationCount: 1,
              unavailableReason: null,
            },
      ],
      metadata: {
        sector: index < 3 ? "Technology" : null,
        industry: null,
        marketCapDollars: null,
        marketCapGroup: index < 2 ? "SMALL" : "LARGE",
        institutionalDiscoveryStage:
          index < 3 ? "EARLY_DISCOVERY" : null,
      },
      inputProvenance: {},
      priceProvenance: {
        status: "available",
        source: "fixture",
        sourceVersion: "v1",
        availableThrough: "2021-01-02",
        adjustmentBasis: "split_adjusted_close",
        corporateActionPolicyVersion: "v1",
      },
      inputSnapshotHash: "input-hash",
      priceSnapshotHash: "price-hash",
      limitations: [],
    };
    return base as HistoricalSymbolEvaluation;
  });
  return {
    request: {
      evaluationDate: EVALUATION_DATE,
      symbolUniverse: symbols,
      modelVersion: "multibagger_v1",
      scoringArtifactHash: SCORING_ARTIFACT_HASH,
      horizons: [1],
    },
    provenance: {
      validationVersion: "multibagger_historical_validation_v1",
      modelVersion: "multibagger_v1",
      evaluationDate: EVALUATION_DATE,
      normalizedSymbolUniverse: symbols,
      horizons: [1],
      provider: {
        providerId: "fixture",
        providerVersion: "1",
        datasetVersion: "1",
      },
      modelArtifact: {
        implementation: "computeMultibaggerDiscovery",
        scoringContractVersion: "multibagger_v1",
        scoringArtifactHash: SCORING_ARTIFACT_HASH,
      },
      runKey: "fixture",
    },
    evaluations,
  };
}

describe("historical validation analysis helpers", () => {
  it("builds top-decile and false-positive/false-negative cohorts deterministically", () => {
    const topDecileFixture = analysisFixture();
    topDecileFixture.evaluations[0].overallScore = 70;
    topDecileFixture.evaluations[2].overallScore = 95;
    expect(selectTopDecileOutcomes(topDecileFixture, 1)).toEqual([
      {
        symbol: "CCC",
        overallScore: 95,
        outcomeStatus: "available",
        futureReturnPercent: 100,
        unavailableReason: null,
        horizonYears: 1,
      },
    ]);
    expect(
      classifyValidationCohorts(analysisFixture(), {
        horizonYears: 1,
        scoreThreshold: 50,
        outcomeThresholdPercent: 50,
      }),
    ).toEqual({
      truePositives: ["AAA"],
      falsePositives: ["BBB"],
      falseNegatives: ["CCC"],
      trueNegatives: ["DDD"],
      excludedUnavailable: ["EEE"],
    });
  });

  it("does not replace a high-scoring selected symbol when its outcome is unavailable", () => {
    const fixture = analysisFixture();
    fixture.evaluations[4].overallScore = 99;
    fixture.evaluations[4].status = "available";
    expect(selectTopDecileOutcomes(fixture, 1)).toEqual([
      {
        symbol: "EEE",
        overallScore: 99,
        outcomeStatus: "unavailable",
        futureReturnPercent: null,
        unavailableReason: "INSUFFICIENT_FUTURE_WINDOW",
        horizonYears: 1,
      },
    ]);
  });

  it("builds score distributions and grouped summaries without dropping unavailable rows", () => {
    const fixture = analysisFixture();
    const distribution = buildScoreDistribution(fixture, 20);
    expect(distribution.unavailableSymbols).toEqual(["EEE"]);
    expect(distribution.buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(4);

    expect(groupByMarketCap(fixture, 1).map((group) => group.group)).toEqual([
      "LARGE",
      "SMALL",
    ]);
    expect(groupBySector(fixture, 1).map((group) => group.group)).toEqual([
      "Technology",
      "UNAVAILABLE",
    ]);
    expect(
      groupByInstitutionalDiscoveryStage(fixture, 1).map(
        (group) => group.group,
      ),
    ).toEqual(["EARLY_DISCOVERY", "UNAVAILABLE"]);
  });
});