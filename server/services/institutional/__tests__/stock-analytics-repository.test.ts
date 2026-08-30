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
  loadManagerPortfolioValues,
  selectAlignedStockFilings,
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
});