import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLatestRanking: vi.fn(),
  computeRankingForSnapshot: vi.fn(),
  getLatestValidSnapshot: vi.fn(),
  saveSectorSnapshot: vi.fn(),
  saveThemeSnapshot: vi.fn(),
}));

vi.mock("../../db", () => ({
  db: {
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  },
}));

vi.mock("../opportunity-ranking-engine", () => ({
  getLatestRanking: mocks.getLatestRanking,
  computeRankingForSnapshot: mocks.computeRankingForSnapshot,
}));

vi.mock("../opportunity-snapshot-store", () => ({
  getLatestValidSnapshot: mocks.getLatestValidSnapshot,
}));

vi.mock("../../config/theme-registry", () => ({
  getAllThemes: vi.fn().mockReturnValue([]),
}));

vi.mock("../sector-intelligence-engine", () => ({
  computeSectorSnapshot: vi.fn().mockReturnValue({ sectors: [] }),
}));

vi.mock("../theme-intelligence-engine", () => ({
  computeThemeSnapshot: vi.fn().mockReturnValue({ themes: [] }),
}));

vi.mock("../intelligence-snapshot-store", () => ({
  saveSectorSnapshot: mocks.saveSectorSnapshot,
  saveThemeSnapshot: mocks.saveThemeSnapshot,
  getPreviousSectorScores: vi.fn().mockResolvedValue(new Map()),
  getPreviousThemeScores: vi.fn().mockResolvedValue(new Map()),
}));

import { runIntelligencePrecomputation } from "../intelligence-orchestrator";

describe("repair snapshot precomputation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getLatestRanking.mockReturnValue(null);
    mocks.getLatestValidSnapshot.mockResolvedValue({
      id: "persisted-snapshot",
      completedAt: "2026-08-30T00:00:00.000Z",
      topGrowth: [],
      topIncome: [],
      topWatchlist: [],
      approachingQualification: [],
    });
    mocks.computeRankingForSnapshot.mockResolvedValue({
      topGrowth: [],
      topIncome: [],
      watchlist: [],
      approaching: [],
      changes: [],
      regime: null,
    });
    mocks.saveSectorSnapshot.mockResolvedValue(undefined);
    mocks.saveThemeSnapshot.mockResolvedValue(undefined);
  });

  it("restores a persisted ranking in a fresh process before rebuilding snapshots", async () => {
    const result = await runIntelligencePrecomputation();

    expect(mocks.getLatestValidSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.computeRankingForSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ id: "persisted-snapshot" }),
      null,
    );
    expect(mocks.saveSectorSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.saveThemeSnapshot).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "completed", sectorCount: 0, themeCount: 0 });
  });

  it("reports a truthful blocked result when no persisted ranking exists", async () => {
    mocks.getLatestValidSnapshot.mockResolvedValue(null);

    await expect(runIntelligencePrecomputation()).resolves.toMatchObject({
      status: "blocked",
      reason: "no_ranking_available",
    });
    expect(mocks.saveSectorSnapshot).not.toHaveBeenCalled();
    expect(mocks.saveThemeSnapshot).not.toHaveBeenCalled();
  });
});