import { readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { institutionalManagerCohorts } from "@shared/schema";
import type { Express, RequestHandler } from "express";
import {
  INSTITUTIONAL_MANAGER_COHORTS,
  REGISTERED_MANAGER_COHORT_RULES,
  filterByCohortManagerIds,
  getActiveManagerIdsForCohort,
  seedManagerCohorts,
  validateManagerCohortSeedInput,
  type ManagerCohortMembership,
  type ManagerCohortStore,
} from "../analytics";
import {
  getInstitutionalAccumulationRanking,
} from "../analytics/cross-fund-analytics";
import { getSectorRotation } from "../analytics/rotation-analytics";
import { getStockInstitutionalAnalytics } from "../analytics/stock-analytics";
import { getStockInstitutionalTrend } from "../analytics/stock-trend";
import type {
  CrossFundInstitutionalRepository,
  StockInstitutionalRepository,
  StockInstitutionalTrendRepository,
} from "../analytics/repository";
import { registerInstitutionalAdminRoutes } from "../../../routes/institutional-admin";

const REVIEWED_AT = "2026-08-29T12:00:00.000Z";

function fakeStore(
  overrides: Partial<ManagerCohortStore> = {},
): ManagerCohortStore {
  return {
    upsertMany: vi.fn(async (records) => records),
    list: vi.fn(async () => []),
    activeManagerIds: vi.fn(async () => []),
    ...overrides,
  };
}

describe("institutional manager cohorts", () => {
  it("defines the curated extensible cohort vocabulary", () => {
    expect(INSTITUTIONAL_MANAGER_COHORTS).toEqual([
      "hedge_fund",
      "pension",
      "sovereign",
      "endowment",
      "asset_manager",
      "quantitative",
      "technology_specialist",
      "healthcare_specialist",
      "concentrated",
      "broad_diversified",
    ]);
  });

  it("normalizes manual memberships and retains review metadata", () => {
    expect(
      validateManagerCohortSeedInput({
        managerId: "1234",
        cohort: "hedge_fund",
        classificationMethod: "MANUAL",
        confidence: 80,
        notes: "  Curated from filing review.  ",
        lastReviewedAt: REVIEWED_AT,
      }),
    ).toEqual({
      managerId: "0000001234",
      cohort: "hedge_fund",
      classificationMethod: "MANUAL",
      confidence: 80,
      status: "ACTIVE",
      source: null,
      notes: "Curated from filing review.",
      ruleId: null,
      lastReviewedAt: REVIEWED_AT,
    });
  });

  it("requires provenance for verified classifications", () => {
    expect(() =>
      validateManagerCohortSeedInput({
        managerId: "1234",
        cohort: "pension",
        classificationMethod: "VERIFIED",
        lastReviewedAt: REVIEWED_AT,
      }),
    ).toThrow(/source/i);

    expect(
      validateManagerCohortSeedInput({
        managerId: "1234",
        cohort: "pension",
        classificationMethod: "VERIFIED",
        source: "Manager public filing",
        lastReviewedAt: REVIEWED_AT,
      }).source,
    ).toBe("Manager public filing");
  });

  it("rejects unsupported automatic classifications", () => {
    expect(REGISTERED_MANAGER_COHORT_RULES).toEqual({});
    expect(() =>
      validateManagerCohortSeedInput({
        managerId: "1234",
        cohort: "quantitative",
        classificationMethod: "RULE_BASED",
        ruleId: "name_contains_quant",
        lastReviewedAt: REVIEWED_AT,
      }),
    ).toThrow(/registered deterministic rule/i);
  });

  it("supports several cohorts for one manager", async () => {
    const upsertMany = vi.fn(async (records: ManagerCohortMembership[]) => records);
    const store = fakeStore({ upsertMany });
    const records = await seedManagerCohorts(
      [
        {
          managerId: "1234",
          cohort: "asset_manager",
          classificationMethod: "MANUAL",
          lastReviewedAt: REVIEWED_AT,
        },
        {
          managerId: "1234",
          cohort: "broad_diversified",
          classificationMethod: "VERIFIED",
          source: "Manager mandate",
          lastReviewedAt: REVIEWED_AT,
        },
      ],
      store,
    );

    expect(records).toHaveLength(2);
    expect(new Set(records.map((record) => record.cohort))).toEqual(
      new Set(["asset_manager", "broad_diversified"]),
    );
    expect(upsertMany).toHaveBeenCalledOnce();
  });

  it("rejects duplicate manager/cohort entries in one seed batch", async () => {
    await expect(
      seedManagerCohorts(
        [
          {
            managerId: "1234",
            cohort: "asset_manager",
            classificationMethod: "MANUAL",
          },
          {
            managerId: "0000001234",
            cohort: "asset_manager",
            classificationMethod: "MANUAL",
          },
        ],
        fakeStore(),
        new Date(REVIEWED_AT),
      ),
    ).rejects.toThrow(/duplicate manager\/cohort/i);
  });

  it("loads active cohort manager IDs and filters before aggregation", async () => {
    const store = fakeStore({
      activeManagerIds: vi.fn(async () => ["0000000001", "0000000003"]),
    });
    const managerIds = await getActiveManagerIdsForCohort("sovereign", store);
    const rows = filterByCohortManagerIds(
      [
        { managerId: "0000000001", value: 10 },
        { managerId: "0000000002", value: 20 },
        { managerId: "0000000003", value: 30 },
      ],
      managerIds,
    );
    expect(rows.map((row) => row.value)).toEqual([10, 30]);
  });

  it("does not query cohort storage when no cohort filter is requested", async () => {
    const activeManagerIds = vi.fn(async () => ["0000000001"]);
    const store = fakeStore({ activeManagerIds });
    expect(await getActiveManagerIdsForCohort(undefined, store)).toBeNull();
    expect(activeManagerIds).not.toHaveBeenCalled();
  });

  it("represents the many-to-many metadata in the shared schema", () => {
    expect(getTableName(institutionalManagerCohorts)).toBe(
      "institutional_manager_cohorts",
    );
    expect(Object.keys(getTableColumns(institutionalManagerCohorts))).toEqual(
      expect.arrayContaining([
        "managerId",
        "cohort",
        "classificationMethod",
        "confidence",
        "status",
        "source",
        "notes",
        "ruleId",
        "lastReviewedAt",
      ]),
    );
  });

  it("passes cohort options through all supported analytics services", async () => {
    const crossFundQuery = vi.fn();
    const stockQuery = vi.fn();
    const trendQuery = vi.fn();
    const crossFundRepository: CrossFundInstitutionalRepository = {
      getCrossFundInstitutionalSource: async (query) => {
        crossFundQuery(query);
        return null;
      },
    };
    const stockRepository: StockInstitutionalRepository = {
      getStockInstitutionalSource: async (query) => {
        stockQuery(query);
        return null;
      },
    };
    const trendRepository: StockInstitutionalTrendRepository = {
      getStockInstitutionalTrendSource: async (query) => {
        trendQuery(query);
        return null;
      },
    };

    await getInstitutionalAccumulationRanking(
      { cohort: "pension" },
      crossFundRepository,
    );
    await getSectorRotation({ cohort: "sovereign" }, crossFundRepository);
    await getStockInstitutionalAnalytics(
      "AAPL",
      "latest",
      { cohort: "technology_specialist" },
      stockRepository,
    );
    await getStockInstitutionalTrend(
      "AAPL",
      { cohort: "concentrated" },
      trendRepository,
    );

    expect(crossFundQuery).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        options: expect.objectContaining({ cohort: "pension" }),
      }),
    );
    expect(crossFundQuery).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        options: expect.objectContaining({ cohort: "sovereign" }),
      }),
    );
    expect(stockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ cohort: "technology_specialist" }),
      }),
    );
    expect(trendQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ cohort: "concentrated" }),
      }),
    );
  });

  it("registers seed and list routes behind both auth middlewares", () => {
    const routes: Array<{
      method: string;
      path: string;
      handlers: RequestHandler[];
    }> = [];
    const app = {
      post: (path: string, ...handlers: RequestHandler[]) => {
        routes.push({ method: "post", path, handlers });
      },
      get: (path: string, ...handlers: RequestHandler[]) => {
        routes.push({ method: "get", path, handlers });
      },
    } as unknown as Express;
    const authenticated = vi.fn() as unknown as RequestHandler;
    const admin = vi.fn() as unknown as RequestHandler;

    registerInstitutionalAdminRoutes(app, authenticated, admin);

    for (const path of [
      "/api/admin/institutional/manager-cohorts/seed",
      "/api/admin/institutional/manager-cohorts",
    ]) {
      const route = routes.find((candidate) => candidate.path === path);
      expect(route?.handlers[0]).toBe(authenticated);
      expect(route?.handlers[1]).toBe(admin);
    }
  });

  it("initializes the cohort schema at startup with required constraints", () => {
    const startup = readFileSync("server/index.ts", "utf8");
    const migration = readFileSync(
      "server/services/institutional/manager-cohort-migration.ts",
      "utf8",
    );
    expect(startup).toContain("ensureInstitutionalManagerCohortSchema()");
    expect(migration).toContain("UNIQUE (manager_id, cohort)");
    expect(migration).toContain("classification_method IN");
    expect(migration).toContain("confidence >= 0");
    expect(migration).toContain("classification_method <> 'RULE_BASED'");
  });
});