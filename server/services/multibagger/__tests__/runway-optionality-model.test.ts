import { describe, expect, it } from "vitest";
import { computeMultibaggerDiscovery } from "../engine";
import {
  computeMarketCapRunway,
  computeOptionalUpsideProfiles,
  computeRunwayScore,
  RUNWAY_OPTIONALITY_MODEL,
} from "../runway-signals";
import {
  MULTIBAGGER_RUNWAY_MODEL_VERSION,
  type RunwaySignalsInput,
} from "../types";

function strongSmallCap(
  overrides: Partial<RunwaySignalsInput> = {},
): RunwaySignalsInput {
  return {
    currentMarketCap: 500_000_000,
    revenue: 3_000_000_000,
    revenueGrowth: 60,
    addressableMarketDollars: 100_000_000_000,
    addressableMarketReliable: true,
    industryGrowthPercent: 20,
    operatingMarginPercent: 20,
    freeCashFlowMarginPercent: 15,
    freeCashFlowGrowthPercent: 40,
    freeCashFlowPositive: true,
    shareDilutionPercent: 2,
    balanceSheetStrength: 90,
    cashAndEquivalentsDollars: 500_000_000,
    annualCashBurnDollars: 20_000_000,
    yearsToProfitability: 1,
    ...overrides,
  };
}

describe("multibagger runway model", () => {
  it("returns the versioned runway, market-cap, and optional-upside contracts", () => {
    const result = computeRunwayScore(strongSmallCap());
    expect(result.runwayModelVersion).toBe(MULTIBAGGER_RUNWAY_MODEL_VERSION);
    expect(result.score).toBeGreaterThan(80);
    expect(result.marketCapRunway.modelVersion).toBe(
      MULTIBAGGER_RUNWAY_MODEL_VERSION,
    );
    expect(Object.keys(result.optionalUpsideProfiles)).toEqual([
      "5x",
      "10x",
      "25x",
      "100x",
    ]);
    for (const profile of Object.values(result.optionalUpsideProfiles)) {
      expect(profile.modelVersion).toBe(MULTIBAGGER_RUNWAY_MODEL_VERSION);
      expect(profile.supportingFactors.length).toBeGreaterThan(0);
      expect(profile.dataQuality.modelVersion).toBe(
        MULTIBAGGER_RUNWAY_MODEL_VERSION,
      );
    }
  });

  it("classifies a small-cap company with strong growth and runway as a strong profile", () => {
    const profiles = computeOptionalUpsideProfiles(strongSmallCap());
    expect(profiles["5x"].classification).toBe("STRONG_PROFILE");
    expect(profiles["10x"].classification).toBe("STRONG_PROFILE");
    expect(profiles["25x"].classification).toBe("STRONG_PROFILE");
    expect(profiles["100x"].classification).toBe("STRONG_PROFILE");
    expect(profiles["100x"].supportingFactors.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "marketCapConstraint",
        "economicRunway",
        "revenueGrowth",
      ]),
    );
  });

  it("materially constrains an economically implausible mega-cap 100x profile", () => {
    const input = strongSmallCap({
      currentMarketCap: 200_000_000_000,
      revenue: 80_000_000_000,
      addressableMarketDollars: 1_000_000_000_000,
      revenueGrowth: 35,
      operatingMarginPercent: 35,
      balanceSheetStrength: 95,
    });
    const marketCapRunway = computeMarketCapRunway(input);
    const profile = computeOptionalUpsideProfiles(input)["100x"];
    expect(marketCapRunway.targetMarketCaps["100x"]).toBe(
      20_000_000_000_000,
    );
    expect(marketCapRunway.constraints["100x"].status).toBe("CONSTRAINS");
    expect(profile.classification).toBe("WEAK_PROFILE");
    expect(profile.limitingFactors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "marketCapAboveSupportiveRange" }),
        expect.objectContaining({ code: "economicRunway" }),
      ]),
    );
  });

  it("prevents a constrained 100x market cap from receiving a strong label", () => {
    const profile = computeOptionalUpsideProfiles(
      strongSmallCap({
        currentMarketCap: 2_000_000_000,
        revenue: 20_000_000_000,
        addressableMarketDollars: 1_000_000_000_000,
      }),
    )["100x"];
    expect(profile.classification).not.toBe("STRONG_PROFILE");
    expect(profile.limitingFactors).toContainEqual(
      expect.objectContaining({ code: "marketCapAboveSupportiveRange" }),
    );
  });

  it("marks a small cap with a weak balance sheet as a weak profile", () => {
    const profile = computeOptionalUpsideProfiles(
      strongSmallCap({
        balanceSheetStrength: 15,
        freeCashFlowPositive: false,
        freeCashFlowMarginPercent: -20,
        cashAndEquivalentsDollars: 5_000_000,
        annualCashBurnDollars: 50_000_000,
      }),
    )["10x"];
    expect(profile.classification).toBe("WEAK_PROFILE");
    expect(profile.limitingFactors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "weakBalanceSheet" }),
        expect.objectContaining({ code: "balanceSheetStrength" }),
      ]),
    );
  });

  it("does not fabricate TAM and makes TAM-dependent profiles insufficient", () => {
    const input = strongSmallCap({
      addressableMarketDollars: null,
      addressableMarketReliable: false,
    });
    const runway = computeRunwayScore(input);
    expect(runway.marketCapRunway.addressableMarketDollars).toBeNull();
    expect(runway.marketCapRunway.addressableMarketToCurrentCapRatio).toBeNull();
    expect(runway.dataQuality.unavailableInputs).toEqual(
      expect.arrayContaining([
        "addressable-market headroom",
        "addressable-market penetration",
      ]),
    );
    expect(runway.dataQuality.warnings.join(" ")).toContain(
      "no TAM value was inferred",
    );
    expect(runway.optionalUpsideProfiles["5x"].classification).not.toBe(
      "INSUFFICIENT_DATA",
    );
    for (const key of ["25x", "100x"] as const) {
      const profile = runway.optionalUpsideProfiles[key];
      expect(profile.classification).toBe("INSUFFICIENT_DATA");
      expect(profile.dataQuality.status).toBe("INSUFFICIENT_DATA");
      expect(profile.limitingFactors).toContainEqual(
        expect.objectContaining({ code: "missingReliableTAM" }),
      );
    }
  });

  it("ignores a numeric TAM explicitly marked unreliable", () => {
    const marketCapRunway = computeMarketCapRunway(
      strongSmallCap({ addressableMarketReliable: false }),
    );
    expect(marketCapRunway.addressableMarketDollars).toBeNull();
    expect(marketCapRunway.addressableMarketReliable).toBe(false);
  });

  it("requires an explicit reliable-TAM indicator", () => {
    const runway = computeRunwayScore({
      ...strongSmallCap(),
      addressableMarketReliable: undefined,
    });
    expect(runway.marketCapRunway.addressableMarketDollars).toBeNull();
    expect(runway.optionalUpsideProfiles["25x"].classification).toBe(
      "INSUFFICIENT_DATA",
    );
    expect(runway.optionalUpsideProfiles["100x"].classification).toBe(
      "INSUFFICIENT_DATA",
    );
  });

  it.each([null, -1, Number.NaN])(
    "requires valid revenue for profile classification: %s",
    (revenue) => {
      const runway = computeRunwayScore(
        strongSmallCap({ revenue }),
      );
      expect(runway.score).toBeNull();
      expect(runway.dataQuality.status).toBe("INSUFFICIENT_DATA");
      for (const profile of Object.values(runway.optionalUpsideProfiles)) {
        expect(profile.classification).toBe("INSUFFICIENT_DATA");
        expect(profile.dataQuality.unavailableInputs).toContain("revenue");
      }
    },
  );

  it("makes high dilution a limiting factor and a weak profile", () => {
    const profile = computeOptionalUpsideProfiles(
      strongSmallCap({ shareDilutionPercent: 35 }),
    )["5x"];
    expect(profile.classification).toBe("WEAK_PROFILE");
    expect(profile.limitingFactors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "highShareDilution", value: 35 }),
        expect.objectContaining({ code: "shareDilution" }),
      ]),
    );
  });

  it("exposes Task 16 outputs at the top level and reuses available company inputs", () => {
    const result = computeMultibaggerDiscovery({
      symbol: "RUN",
      valuation: {
        marketCapDollars: 500_000_000,
        revenueDollars: 100_000_000,
      },
      growth: {
        revenueGrowthYoYPercent: 60,
        freeCashFlowGrowthYoYPercent: 40,
      },
      fundamental: {
        operatingMarginPercent: 20,
        freeCashFlowMarginPercent: 15,
      },
      runway: {
        addressableMarketDollars: 100_000_000_000,
        addressableMarketReliable: true,
        industryGrowthPercent: 20,
        freeCashFlowPositive: true,
        shareDilutionPercent: 2,
        balanceSheetStrength: 90,
      },
    });
    expect(result.runwayScore).toBe(result.dimensions.runway);
    expect(result.marketCapRunway).toBe(result.runwayScore.marketCapRunway);
    expect(result.optionalUpsideProfiles).toBe(
      result.runwayScore.optionalUpsideProfiles,
    );
    expect(result.marketCapRunway.currentMarketCap).toBe(500_000_000);
    expect(result.optionalUpsideProfiles["100x"].classification).toBeDefined();
    expect(RUNWAY_OPTIONALITY_MODEL.version).toBe(
      MULTIBAGGER_RUNWAY_MODEL_VERSION,
    );
  });
});