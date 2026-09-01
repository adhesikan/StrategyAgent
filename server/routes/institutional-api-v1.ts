/**
 * External Institutional Intelligence API v1.
 *
 * This is an adapter only: all institutional calculations remain in the
 * server-side analytics domain. The existing /api/institutional routes are
 * intentionally not reused or changed because they have application-specific
 * response contracts.
 */

import type { Express, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import {
  getFundPortfolioAnalytics,
  getInstitutionalAccumulationRanking,
  getInstitutionalReductionRanking,
  getNewlyReportedRanking,
  getNoLongerReportedRanking,
  getSectorRotation,
  getIndustryRotation,
  getThemeRotation,
  getStockInstitutionalAnalytics,
  getStockInstitutionalTrend,
} from "../services/institutional/analytics";
import type {
  FundPortfolioXRayAnalytics,
  FundPortfolioXRayOptions,
  FundPortfolioXRayQuarterSelector,
  InstitutionalActivityRankingOptions,
  InstitutionalActivityRankingResult,
  InstitutionalRotationOptions,
  InstitutionalRotationResult,
  StockInstitutionalAnalytics,
  StockInstitutionalAnalyticsOptions,
  StockInstitutionalTrendOptions,
  StockInstitutionalTrendResult,
} from "../services/institutional/analytics/types";
import {
  INSTITUTIONAL_MANAGER_COHORTS,
} from "../services/institutional/manager-cohort-types";
import {
  isValidManagerId,
  normalizeManagerId,
} from "../services/institutional/fund-service";
import { externalApiRequestId } from "../services/external-api-security";
import { StockViewRepositoryStageError } from "../services/institutional/analytics/stock-analytics-repository";

const SOURCE_LABEL = "SEC Form 13F reported holdings";
const API_MODEL_VERSION = "institutional-api-v1";
const SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

function safeStockViewErrorMessage(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Unknown stock analytics error";
  return message
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[REDACTED_DATABASE_URL]")
    .slice(0, 500);
}

function logStockViewFailure(error: unknown): void {
  const staged =
    error instanceof StockViewRepositoryStageError ? error : null;
  const postgresCode =
    staged?.postgresCode ??
    (typeof (error as { code?: unknown } | null)?.code === "string"
      ? String((error as { code: string }).code)
      : null);
  console.error(JSON.stringify({
    event: "institutional_stock_view_failure",
    stage: staged?.stage ?? "OTHER",
    errorClass:
      error instanceof Error ? error.name : typeof error,
    postgresCode,
    safeMessage: safeStockViewErrorMessage(error),
    serviceFunction: "getStockInstitutionalAnalytics",
    repositoryFunction: staged?.repositoryFunction ?? null,
  }));
}

const CACHE_HEADERS = {
  health: "public, max-age=30, stale-while-revalidate=60",
  analytics: "private, max-age=300, stale-while-revalidate=600",
} as const;

const COMMON_POSITION_TYPES = ["COMMON_EQUITY", "PUT", "CALL"] as const;

const quarterSchema = z.union([
  z.literal("latest"),
  z.string().regex(/^\d{4}-Q[1-4]$/, "quarter must use YYYY-Q1 through YYYY-Q4"),
]);

function queryString(min = 1, max = 200) {
  return z.preprocess(
    (value) =>
      value === undefined
        ? undefined
        : typeof value === "string"
          ? value.trim()
          : value,
    z.string().min(min).max(max).optional(),
  );
}

function queryNumber(min: number, max: number, defaultValue?: number) {
  const schema = z.preprocess(
    (value) => {
      if (value === undefined) return undefined;
      if (typeof value === "string" && value.trim() !== "") return Number(value);
      return value;
    },
    z.number().finite().int().min(min).max(max),
  );
  return defaultValue === undefined ? schema.optional() : schema.default(defaultValue);
}

const commonQuerySchema = z.object({
  quarter: quarterSchema.default("latest"),
  positionType: z.enum(COMMON_POSITION_TYPES).default("COMMON_EQUITY"),
  cohort: z.enum(INSTITUTIONAL_MANAGER_COHORTS).optional(),
}).strict();

const fundQuerySchema = z.object({
  quarter: quarterSchema.default("latest"),
  positionType: z.enum(COMMON_POSITION_TYPES).default("COMMON_EQUITY"),
  topN: queryNumber(1, 100, 20),
}).strict();

const stockQuerySchema = commonQuerySchema.extend({
  topN: queryNumber(1, 100, 20),
}).strict();

const trendQuerySchema = commonQuerySchema.extend({
  historyQuarters: queryNumber(1, 8, 8),
}).strict();

const rankingQuerySchema = commonQuerySchema.extend({
  sector: queryString(1, 100),
  industry: queryString(1, 100),
  theme: queryString(1, 100),
  marketCapMin: queryNumber(0, Number.MAX_SAFE_INTEGER),
  marketCapMax: queryNumber(0, Number.MAX_SAFE_INTEGER),
  minManagers: queryNumber(1, 10_000),
  minReportedValue: queryNumber(0, Number.MAX_SAFE_INTEGER),
  sortBy: z.enum([
    "netHolderIncrease",
    "newHolderCount",
    "increasedHolderCount",
    "aggregateShareIncreasePct",
    "aggregateShareIncrease",
    "reportedValue",
  ]).default("netHolderIncrease"),
  sortDirection: z.enum(["asc", "desc"]).default("desc"),
  limit: queryNumber(1, 100, 50),
  offset: queryNumber(0, 100_000, 0),
}).strict().superRefine((value, context) => {
  if (
    value.marketCapMin !== undefined &&
    value.marketCapMax !== undefined &&
    value.marketCapMin > value.marketCapMax
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["marketCapMin"],
      message: "marketCapMin cannot exceed marketCapMax",
    });
  }
});

const rotationQuerySchema = commonQuerySchema.strict();

type ApiV1Query = z.infer<typeof commonQuerySchema>;
type ApiV1Deps = {
  getFundPortfolioAnalytics: typeof getFundPortfolioAnalytics;
  getStockInstitutionalAnalytics: typeof getStockInstitutionalAnalytics;
  getStockInstitutionalTrend: typeof getStockInstitutionalTrend;
  getInstitutionalAccumulationRanking: typeof getInstitutionalAccumulationRanking;
  getInstitutionalReductionRanking: typeof getInstitutionalReductionRanking;
  getNewlyReportedRanking: typeof getNewlyReportedRanking;
  getNoLongerReportedRanking: typeof getNoLongerReportedRanking;
  getSectorRotation: typeof getSectorRotation;
  getIndustryRotation: typeof getIndustryRotation;
  getThemeRotation: typeof getThemeRotation;
};

const defaultDeps: ApiV1Deps = {
  getFundPortfolioAnalytics,
  getStockInstitutionalAnalytics,
  getStockInstitutionalTrend,
  getInstitutionalAccumulationRanking,
  getInstitutionalReductionRanking,
  getNewlyReportedRanking,
  getNoLongerReportedRanking,
  getSectorRotation,
  getIndustryRotation,
  getThemeRotation,
};

export class InstitutionalApiV1Error extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "InstitutionalApiV1Error";
  }
}

function requestId(req: Request): string {
  return externalApiRequestId(req);
}

function parseQuery<T extends z.ZodTypeAny>(
  schema: T,
  query: Request["query"],
): z.infer<T> {
  const parsed = schema.safeParse(query);
  if (!parsed.success) {
    throw new InstitutionalApiV1Error(
      400,
      "INVALID_QUERY",
      "One or more query parameters are invalid.",
    );
  }
  return parsed.data;
}

function requireManagerId(raw: string): string {
  if (!isValidManagerId(raw)) {
    throw new InstitutionalApiV1Error(
      400,
      "INVALID_MANAGER_ID",
      "managerId must contain 1 to 10 digits.",
    );
  }
  return normalizeManagerId(raw);
}

function requireSymbol(raw: string): string {
  const symbol = raw.trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) {
    throw new InstitutionalApiV1Error(
      400,
      "INVALID_SYMBOL",
      "symbol must be 1 to 10 letters, digits, periods, or hyphens.",
    );
  }
  return symbol;
}

function valueRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? value as Record<string, unknown>
    : {};
}

function responseMeta(
  data: unknown,
  id: string,
  extraLimitations: string[] = [],
) {
  const record = valueRecord(data);
  const quarter = valueRecord(record.quarter);
  const quarters = Array.isArray(record.quarters) ? record.quarters : [];
  const latestTrendQuarter = valueRecord(
    quarters.length > 0 ? quarters[quarters.length - 1] : null,
  );
  const trendQuarter = valueRecord(latestTrendQuarter.quarter);
  const model = valueRecord(record.modelVersion);
  const warningValue = valueRecord(record.dataQuality).warnings;
  const warnings = Array.isArray(warningValue)
    ? warningValue.filter(
        (warning: unknown): warning is string => typeof warning === "string",
      )
    : [];
  const quarterLabel =
    typeof quarter.label === "string"
      ? quarter.label
      : typeof trendQuarter.label === "string"
        ? trendQuarter.label
        : null;
  const dataAsOf =
    typeof record.dataAsOf === "string"
      ? record.dataAsOf
      : typeof quarter.periodEndDate === "string"
        ? quarter.periodEndDate
        : typeof trendQuarter.periodEndDate === "string"
          ? trendQuarter.periodEndDate
          : null;

  return {
    quarter: quarterLabel,
    dataAsOf,
    modelVersion:
      typeof model.version === "string" ? model.version : API_MODEL_VERSION,
    source: SOURCE_LABEL,
    requestId: id,
    limitations: Array.from(new Set([
      ...extraLimitations,
      ...warnings,
      "13F data is delayed and reflects reported holdings, not real-time positions.",
    ])),
  };
}

function setRequestHeaders(res: Response, id: string, cache: string): void {
  res.setHeader("X-Request-Id", id);
  res.setHeader("Cache-Control", cache);
  res.setHeader("Vary", "Authorization, Accept");
}

function sendSuccess(
  res: Response,
  data: unknown,
  id: string,
  cache: string = CACHE_HEADERS.analytics,
): void {
  setRequestHeaders(res, id, cache);
  res.status(200).json({
    data,
    meta: responseMeta(data, id),
  });
}

function sendError(res: Response, error: unknown, id: string): void {
  const apiError =
    error instanceof InstitutionalApiV1Error
      ? error
      : new InstitutionalApiV1Error(
          500,
          "INTERNAL_ERROR",
          "Unable to retrieve institutional intelligence.",
        );
  setRequestHeaders(res, id, "no-store");
  res.status(apiError.status).json({
    error: {
      code: apiError.code,
      message: apiError.message,
      requestId: id,
    },
  });
}

function requireResult<T>(result: T | null, resource: string): T {
  if (result === null) {
    throw new InstitutionalApiV1Error(
      404,
      "DATA_UNAVAILABLE",
      `No ${resource} data is available for the requested parameters.`,
    );
  }
  return result;
}

function withApiLogging(
  routeName: string,
  handler: (req: Request) => Promise<unknown>,
  cache: string = CACHE_HEADERS.analytics,
): RequestHandler {
  return async (req, res) => {
    const id = requestId(req);
    const startedAt = Date.now();
    res.setHeader("X-Request-Id", id);
    try {
      const data = await handler(req);
      sendSuccess(res, data, id, cache);
      console.log(JSON.stringify({
        event: "institutional_api_v1_request",
        route: routeName,
        method: req.method,
        status: 200,
        requestId: id,
        durationMs: Date.now() - startedAt,
      }));
    } catch (error) {
      const apiError =
        error instanceof InstitutionalApiV1Error
          ? error
          : new InstitutionalApiV1Error(
              500,
              "INTERNAL_ERROR",
              "Unable to retrieve institutional intelligence.",
            );
      sendError(res, apiError, id);
      console.error(JSON.stringify({
        event: "institutional_api_v1_error",
        route: routeName,
        method: req.method,
        status: apiError.status,
        code: apiError.code,
        requestId: id,
        durationMs: Date.now() - startedAt,
      }));
    }
  };
}

function commonOptions(query: ApiV1Query) {
  return {
    quarter: query.quarter as FundPortfolioXRayQuarterSelector,
    positionType: query.positionType,
    ...(query.cohort ? { cohort: query.cohort } : {}),
  };
}

export function registerInstitutionalApiV1Routes(
  app: Express,
  deps: ApiV1Deps = defaultDeps,
  options: {
    basePath?: string;
    includeHealth?: boolean;
  } = {},
): void {
  const basePath = options.basePath ?? "/api/v1/institutional";
  if (options.includeHealth !== false) {
    app.get("/api/v1/health", withApiLogging(
      "health",
      async () => ({
        status: "ok",
        apiVersion: "v1",
      }),
      CACHE_HEADERS.health,
    ));
  }

  const fundHandler = withApiLogging(
    "fund",
    async (req) => {
      const managerId = requireManagerId(String(req.params.managerId ?? ""));
      const query = parseQuery(fundQuerySchema, req.query);
      const options: FundPortfolioXRayOptions = {
        positionType: query.positionType,
        topN: query.topN,
      };
      return requireResult(
        await deps.getFundPortfolioAnalytics(
          managerId,
          query.quarter as FundPortfolioXRayQuarterSelector,
          options,
        ),
        "fund",
      );
    },
  );
  app.get(`${basePath}/funds/:managerId/analytics`, fundHandler);
  app.get(`${basePath}/funds/:managerId`, fundHandler);

  app.get(`${basePath}/stocks/:symbol`, withApiLogging(
    "stock",
    async (req) => {
      const symbol = requireSymbol(String(req.params.symbol ?? ""));
      const query = parseQuery(stockQuerySchema, req.query);
      const options: StockInstitutionalAnalyticsOptions = {
        ...commonOptions(query),
        topN: query.topN,
      };
      let result: StockInstitutionalAnalytics | null;
      try {
        result = await deps.getStockInstitutionalAnalytics(
          symbol,
          query.quarter as FundPortfolioXRayQuarterSelector,
          options,
        );
      } catch (error) {
        logStockViewFailure(error);
        throw new InstitutionalApiV1Error(
          503,
          "UPSTREAM_ERROR",
          "Institutional source data could not be retrieved.",
        );
      }
      return requireResult(result, "stock");
    },
  ));

  app.get(`${basePath}/stocks/:symbol/trend`, withApiLogging(
    "stock-trend",
    async (req) => {
      const symbol = requireSymbol(String(req.params.symbol ?? ""));
      const query = parseQuery(trendQuerySchema, req.query);
      const options: StockInstitutionalTrendOptions = {
        ...commonOptions(query),
        historyQuarters: query.historyQuarters,
      };
      return requireResult(
        await deps.getStockInstitutionalTrend(symbol, options),
        "stock trend",
      );
    },
  ));

  const rankingRoutes: Array<{
    path: string;
    name: string;
    load: (options: InstitutionalActivityRankingOptions) =>
      Promise<InstitutionalActivityRankingResult | null>;
  }> = [
    {
      path: `${basePath}/trends/accumulation`,
      name: "accumulation",
      load: deps.getInstitutionalAccumulationRanking,
    },
    {
      path: `${basePath}/trends/reduction`,
      name: "reduction",
      load: deps.getInstitutionalReductionRanking,
    },
    {
      path: `${basePath}/trends/new-positions`,
      name: "new-positions",
      load: deps.getNewlyReportedRanking,
    },
    {
      path: `${basePath}/trends/exits`,
      name: "exits",
      load: deps.getNoLongerReportedRanking,
    },
  ];
  for (const route of rankingRoutes) {
    app.get(route.path, withApiLogging(route.name, async (req) => {
      const query = parseQuery(rankingQuerySchema, req.query);
      const options: InstitutionalActivityRankingOptions = {
        ...commonOptions(query),
        sector: query.sector,
        industry: query.industry,
        theme: query.theme,
        marketCapMin: query.marketCapMin,
        marketCapMax: query.marketCapMax,
        minManagers: query.minManagers,
        minReportedValue: query.minReportedValue,
        sortBy: query.sortBy,
        sortDirection: query.sortDirection,
        limit: query.limit,
        offset: query.offset,
      };
      return requireResult(await route.load(options), `${route.name} ranking`);
    }));
  }

  const rotationRoutes: Array<{
    path: string;
    name: string;
    load: (options?: InstitutionalRotationOptions) =>
      Promise<InstitutionalRotationResult | null>;
  }> = [
    {
      path: `${basePath}/rotation/sectors`,
      name: "sector-rotation",
      load: deps.getSectorRotation,
    },
    {
      path: `${basePath}/rotation/industries`,
      name: "industry-rotation",
      load: deps.getIndustryRotation,
    },
    {
      path: `${basePath}/rotation/themes`,
      name: "theme-rotation",
      load: deps.getThemeRotation,
    },
  ];
  for (const route of rotationRoutes) {
    app.get(route.path, withApiLogging(route.name, async (req) => {
      const query = parseQuery(rotationQuerySchema, req.query);
      const options: InstitutionalRotationOptions = commonOptions(query);
      return requireResult(await route.load(options), `${route.name} data`);
    }));
  }
}

export const institutionalApiV1Defaults = {
  source: SOURCE_LABEL,
  modelVersion: API_MODEL_VERSION,
  cacheHeaders: CACHE_HEADERS,
} as const;