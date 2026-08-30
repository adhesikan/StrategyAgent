import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
}));

vi.mock("../../../db", () => ({
  db: {
    select: selectMock,
  },
}));

import {
  loadAllStockInstitutionalHoldings,
  loadManagerPortfolioValues,
  loadStockCandidateIdentity,
  loadStockCandidateCusips,
  selectAlignedStockFilings,
  stockInstitutionalRepository,
} from "../analytics/stock-analytics-repository";

function totalsQuery(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        groupBy: async () => rows,
      }),
    }),
  };
}

function candidateCusipsQuery(rows: unknown[]) {
  return {
    from: () => ({
      leftJoin: () => ({
        leftJoin: () => ({
          where: async () => rows,
        }),
      }),
    }),
  };
}

function canonicalCusipsQuery(rows: unknown[]) {
  return {
    from: () => ({
      where: async () => rows,
    }),
  };
}

function orderedLimitedQuery(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        orderBy: () => ({
          limit: async () => rows,
        }),
      }),
    }),
  };
}

function orderedQuery(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        orderBy: async () => rows,
      }),
    }),
  };
}

describe("stock analytics portfolio denominators", () => {
  beforeEach(() => {
    selectMock.mockReset();
  });

  it("uses the full filing value for common equity, PUT, and CALL requests", async () => {
    // The full filing contains a common-equity row, an option row, and a PRN
    // row. The repository aggregate must retain all three values as the
    // portfolio denominator, regardless of the selected stock position type.
    const fullFilingTotals = [
      { accessionNumber: "accession-1", reportedValue: 150 },
    ];
    selectMock.mockImplementation(() => totalsQuery(fullFilingTotals));
    const filing = {
      accessionNumber: "accession-1",
      managerId: "manager-1",
      managerName: "Example Manager",
      periodOfReport: "2026-06-30",
      filingDate: "2026-08-01",
      isEffective: true,
    };

    const [common, put, call] = await Promise.all([
      loadManagerPortfolioValues([filing]),
      loadManagerPortfolioValues([filing]),
      loadManagerPortfolioValues([filing]),
    ]);

    expect(common).toEqual({ "manager-1": 150 });
    expect(put).toEqual({ "manager-1": 150 });
    expect(call).toEqual({ "manager-1": 150 });
    expect(selectMock).toHaveBeenCalledTimes(3);
  });

  it("loads an isolated unmapped row from the symbol's canonical security-master CUSIP", async () => {
    selectMock
      .mockReturnValueOnce(
        canonicalCusipsQuery([{ cusip: "111111111" }]),
      )
      .mockReturnValueOnce(candidateCusipsQuery([]));
    await expect(
      loadStockCandidateCusips(["accession-1"], "xyz"),
    ).resolves.toEqual(["111111111"]);

    const loadPage = vi.fn().mockResolvedValue([]);
    await loadAllStockInstitutionalHoldings(
      ["accession-1"],
      "XYZ",
      loadPage,
      5_000,
      ["111111111"],
    );
    expect(loadPage).toHaveBeenCalledWith({
      accessionNumbers: ["accession-1"],
      cusips: ["111111111"],
      limit: 5_000,
      offset: 0,
    });
  });

  it("supplements canonical identity with selected-filing symbol evidence", async () => {
    selectMock
      .mockReturnValueOnce(canonicalCusipsQuery([]))
      .mockReturnValueOnce(candidateCusipsQuery([
        { cusip: "111111111" },
        { cusip: "111111111" },
      ]));
    await expect(
      loadStockCandidateCusips(["accession-1"], "xyz"),
    ).resolves.toEqual(["111111111"]);
  });

  it("does not let a trusted status for another symbol validate target evidence", async () => {
    selectMock
      .mockReturnValueOnce(
        canonicalCusipsQuery([
          { cusip: "111111111", reviewStatus: "needs_review" },
        ]),
      )
      .mockReturnValueOnce(
        candidateCusipsQuery([
          {
            cusip: "111111111",
            masterTicker: "JPM",
            masterReviewStatus: "needs_review",
            mappingSymbol: "OTHER",
            mappingStatus: "exact",
            holdingMappedSymbol: null,
            holdingMappingStatus: null,
          },
        ]),
      );

    await expect(
      loadStockCandidateIdentity(["accession-1"], "JPM"),
    ).resolves.toEqual({
      candidateCusips: ["111111111"],
      hasReliableSecurityIdentity: false,
      hasDisqualifyingCandidateEvidence: true,
      hasTargetSpecificCandidateEvidence: true,
    });
  });

  it("keeps diagnostic CUSIPs but marks mixed trusted/conflicting evidence as disqualifying", async () => {
    selectMock
      .mockReturnValueOnce(canonicalCusipsQuery([]))
      .mockReturnValueOnce(candidateCusipsQuery([
        {
          cusip: "111111111",
          masterTicker: null,
          masterReviewStatus: null,
          mappingSymbol: "NVDA",
          mappingStatus: "reviewed",
          holdingMappedSymbol: "NVDA",
          holdingMappingStatus: "exact",
        },
        {
          cusip: "222222222",
          masterTicker: null,
          masterReviewStatus: null,
          mappingSymbol: "AMD",
          mappingStatus: "reviewed",
          holdingMappedSymbol: "NVDA",
          holdingMappingStatus: "exact",
        },
      ]));
    await expect(loadStockCandidateIdentity(["accession-1"], "NVDA")).resolves.toEqual({
      candidateCusips: ["111111111", "222222222"],
      hasReliableSecurityIdentity: true,
      hasDisqualifyingCandidateEvidence: true,
      hasTargetSpecificCandidateEvidence: true,
    });
  });

  it("keeps latest holder details pinned to a lagging canonical aggregate quarter", () => {
    const rows = [
      {
        accessionNumber: "newer-filing",
        managerId: "manager-1",
        managerName: "Example Manager",
        periodOfReport: "2026-09-30",
        filingDate: "2026-11-01",
        isEffective: true,
      },
      {
        accessionNumber: "canonical-quarter-filing",
        managerId: "manager-1",
        managerName: "Example Manager",
        periodOfReport: "2026-06-30",
        filingDate: "2026-08-01",
        isEffective: true,
      },
    ];

    const selected = selectAlignedStockFilings(rows, "latest", {
      quarter: {
        year: 2026,
        quarter: 2,
        label: "2026-Q2",
        periodEndDate: "2026-06-30",
      },
      previousQuarter: null,
      previousReportingManagerCount: null,
      reportingManagerCount: 1,
      aggregateReportedShares: 100,
      aggregateReportedValue: 1_000,
      previousQuarterShares: null,
      previousQuarterValue: null,
      reportedSharesChange: null,
      reportedSharesChangePercent: null,
      newPositionCount: 1,
      increasedPositionCount: 0,
      reducedPositionCount: 0,
      exitedPositionCount: 0,
      unchangedCount: 0,
      eligibleHoldingCount: 1,
      excludedHoldingCount: 0,
      coverageStatus: "complete",
    });

    expect(selected?.currentQuarter.periodEndDate).toBe("2026-06-30");
    expect(selected?.currentFilings.map((filing) => filing.accessionNumber)).toEqual([
      "canonical-quarter-filing",
    ]);
  });

  it("does not expose a cached aggregate without aligned effective filings", async () => {
    selectMock
      .mockReturnValueOnce(orderedLimitedQuery([{
        symbol: "NVDA",
        periodOfReport: "2026-06-30",
        prevPeriodOfReport: null,
        reportingManagerCount: 25,
        aggregateReportedShares: 1_000_000,
        aggregateReportedValue: 50_000_000,
        coverageStatus: "complete",
      }]))
      .mockReturnValueOnce(orderedQuery([]));

    await expect(stockInstitutionalRepository.getStockInstitutionalSource({
      symbol: "NVDA",
      quarter: "2026-Q2",
      options: {},
    })).resolves.toBeNull();
  });
});