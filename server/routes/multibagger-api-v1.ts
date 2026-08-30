import type { Express, Request, RequestHandler, Response } from "express";
import { z } from "zod";
import {
  computeMultibaggerDiscovery,
  multibaggerDiscoveryRepository,
} from "../services/multibagger";
import type {
  MultibaggerDiscoveryInput,
  MultibaggerDiscoveryResult,
  MultibaggerProfile,
  OptionalUpsideProfileKey,
} from "../services/multibagger";
import { getOpportunityIntelligence } from "../services/opportunity-intelligence-service";
import { externalApiRequestId } from "../services/external-api-security";

const REQUIRED_SCOPE = "multibagger:read";
const SOURCE_LABEL = "Deterministic Multibagger Discovery screen";
const SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;
const CACHE_HEADER = "private, max-age=300";

const queryNumber = (minimum: number, maximum: number, defaultValue?: number) => {
  const schema = z.preprocess(
    (value) => {
      if (value === undefined) return undefined;
      if (typeof value === "string" && value.trim() !== "") return Number(value);
      return value;
    },
    z.number().finite().min(minimum).max(maximum),
  );
  return defaultValue === undefined ? schema.optional() : schema.default(defaultValue);
};

const queryInteger = (minimum: number, maximum: number, defaultValue: number) =>
  z.preprocess(
    (value) => {
      if (value === undefined) return undefined;
      if (typeof value === "string" && value.trim() !== "") return Number(value);
      return value;
    },
    z.number().finite().int().min(minimum).max(maximum),
  ).default(defaultValue);

const queryText = z.preprocess(
  (value) => typeof value === "string" ? value.trim() : value,
  z.string().min(1).max(100).optional(),
);

const profileSchema = z.enum([
  "fiveX",
  "tenX",
  "twentyFiveX",
  "hundredX",
]);

const institutionalTrendSchema = z.enum([
  "ACCELERATING_ACCUMULATION",
  "ACCUMULATION",
  "STABLE",
  "DISTRIBUTION",
  "ACCELERATING_DISTRIBUTION",
]);

const screenerQuerySchema = z.object({
  minOverallScore: queryNumber(0, 100),
  profile: profileSchema.optional(),
  marketCapMin: queryNumber(0, Number.MAX_SAFE_INTEGER),
  marketCapMax: queryNumber(0, Number.MAX_SAFE_INTEGER),
  sector: queryText,
  industry: queryText,
  theme: queryText,
  institutionalTrend: institutionalTrendSchema.optional(),
  minInstitutionalScore: queryNumber(0, 100),
  minRevenueGrowth: queryNumber(-100, 10_000),
  limit: queryInteger(1, 100, 25),
  offset: queryInteger(0, 100_000, 0),
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

export type MultibaggerApiV1Profile =
  | "fiveX"
  | "tenX"
  | "twentyFiveX"
  | "hundredX";

export interface MultibaggerApiPrincipal {
  clientId: string;
  scopes: string[];
}

export interface MultibaggerScreenerCandidate {
  symbol: string;
  sector: string | null;
  industry: string | null;
  themes: string[];
}

export interface MultibaggerCandidateMetadata
  extends MultibaggerScreenerCandidate {}

export interface MultibaggerApiV1Deps {
  loadDiscoveryInput(symbol: string): Promise<MultibaggerDiscoveryInput>;
  computeDiscovery(input: MultibaggerDiscoveryInput): MultibaggerDiscoveryResult;
  listCandidates(): Promise<MultibaggerScreenerCandidate[] | null>;
  getCandidateMetadata(
    symbol: string,
  ): Promise<MultibaggerCandidateMetadata | null>;
  authorize(req: Request): Promise<MultibaggerApiPrincipal | null>;
}

type ScreenerQuery = z.infer<typeof screenerQuerySchema>;

export class MultibaggerApiV1Error extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "MultibaggerApiV1Error";
  }
}

function trustedRequestPrincipal(req: Request): MultibaggerApiPrincipal | null {
  const principal = (
    req as Request & { externalApiPrincipal?: unknown }
  ).externalApiPrincipal;
  if (!principal || typeof principal !== "object") return null;
  const record = principal as Record<string, unknown>;
  if (
    typeof record.clientId !== "string" ||
    !Array.isArray(record.scopes) ||
    !record.scopes.every((scope) => typeof scope === "string")
  ) {
    return null;
  }
  return {
    clientId: record.clientId,
    scopes: record.scopes as string[],
  };
}

async function defaultListCandidates(): Promise<
  MultibaggerScreenerCandidate[] | null
> {
  const intelligence = await getOpportunityIntelligence();
  if (!intelligence) return null;
  return intelligence.opportunities.map((candidate) => ({
    symbol: candidate.symbol,
    sector: candidate.sector,
    industry: candidate.industry,
    themes: [...candidate.themes],
  }));
}

async function defaultGetCandidateMetadata(
  symbol: string,
): Promise<MultibaggerCandidateMetadata | null> {
  const candidates = await defaultListCandidates();
  return candidates?.find(
    (candidate) => candidate.symbol.toUpperCase() === symbol.toUpperCase(),
  ) ?? null;
}

const defaultDeps: MultibaggerApiV1Deps = {
  loadDiscoveryInput: (symbol) => multibaggerDiscoveryRepository.load(symbol),
  computeDiscovery: computeMultibaggerDiscovery,
  listCandidates: defaultListCandidates,
  getCandidateMetadata: defaultGetCandidateMetadata,
  authorize: async (req) => trustedRequestPrincipal(req),
};

function requireSymbol(raw: string): string {
  const symbol = raw.trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) {
    throw new MultibaggerApiV1Error(
      400,
      "INVALID_SYMBOL",
      "symbol must be 1 to 10 letters, digits, periods, or hyphens.",
    );
  }
  return symbol;
}

function parseScreenerQuery(query: Request["query"]): ScreenerQuery {
  const parsed = screenerQuerySchema.safeParse(query);
  if (!parsed.success) {
    throw new MultibaggerApiV1Error(
      400,
      "INVALID_QUERY",
      "One or more screener query parameters are invalid.",
    );
  }
  return parsed.data;
}

function requestId(req: Request): string {
  return externalApiRequestId(req);
}

async function requireScope(
  req: Request,
  deps: MultibaggerApiV1Deps,
): Promise<MultibaggerApiPrincipal> {
  const principal = await deps.authorize(req);
  if (!principal) {
    throw new MultibaggerApiV1Error(
      401,
      "UNAUTHORIZED",
      "A valid Bearer API key is required.",
    );
  }
  if (!principal.scopes.includes(REQUIRED_SCOPE)) {
    throw new MultibaggerApiV1Error(
      403,
      "INSUFFICIENT_SCOPE",
      `The API key requires the ${REQUIRED_SCOPE} scope.`,
    );
  }
  return principal;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function profileKey(profile: MultibaggerApiV1Profile): OptionalUpsideProfileKey {
  return {
    fiveX: "5x",
    tenX: "10x",
    twentyFiveX: "25x",
    hundredX: "100x",
  }[profile] as OptionalUpsideProfileKey;
}

const PROFILE_SCORE_KEYS: Record<
  MultibaggerApiV1Profile,
  MultibaggerProfile
> = {
  fiveX: "FIVE_X_POTENTIAL",
  tenX: "TEN_X_POTENTIAL",
  twentyFiveX: "TWENTY_FIVE_X_OPTIONALITY",
  hundredX: "HUNDRED_X_OPTIONALITY",
};

function publicProfile(
  result: MultibaggerDiscoveryResult,
  profile: MultibaggerApiV1Profile,
) {
  const composite = result.profiles[PROFILE_SCORE_KEYS[profile]];
  const runway = result.optionalUpsideProfiles[profileKey(profile)];
  return {
    score: composite.score,
    classification: runway.classification,
    availability: composite.availability,
    runwayScore: runway.score,
    supportingFactors: runway.supportingFactors,
    limitingFactors: runway.limitingFactors,
    dataQuality: runway.dataQuality,
  };
}

function publicResult(
  result: MultibaggerDiscoveryResult,
  input: MultibaggerDiscoveryInput,
  metadata: MultibaggerCandidateMetadata | null,
) {
  const components = {
    institutional: result.dimensions.institutional.score,
    growth: result.dimensions.growth.score,
    fundamentals: result.dimensions.fundamental.score,
    valuation: result.dimensions.valuation.score,
    runway: result.dimensions.runway.score,
    optionality: result.dimensions.optionality.score,
    risk: result.dimensions.risk.score,
  };
  const supportingFactors = Object.entries(components)
    .filter((entry): entry is [string, number] =>
      typeof entry[1] === "number" && entry[1] >= 70)
    .map(([component, score]) => ({
      component,
      score,
      explanation: `${component} evidence supports this candidate profile screen.`,
    }));
  const limitingFactors = Object.entries(components)
    .filter(([, score]) => score === null || score < 50)
    .map(([component, score]) => ({
      component,
      score,
      explanation:
        score === null
          ? `${component} evidence is unavailable.`
          : `${component} evidence limits this candidate profile screen.`,
    }));
  const availableComponents = Object.entries(components)
    .filter(([, score]) => score !== null)
    .map(([component]) => component);
  const unavailableComponents = Object.entries(components)
    .filter(([, score]) => score === null)
    .map(([component]) => component);
  const dataAsOf =
    result.institutionalDiscovery.signals.context.dataAsOf ?? null;
  const marketCap = result.marketCapRunway.currentMarketCap;
  const revenueGrowth =
    input.runway?.revenueGrowth ??
    input.runway?.revenueGrowthPercent ??
    input.growth?.revenueGrowthYoYPercent ??
    null;
  return {
    symbol: result.symbol,
    overallScore: result.overall.score,
    modelVersion: result.modelVersion,
    profiles: {
      fiveX: publicProfile(result, "fiveX"),
      tenX: publicProfile(result, "tenX"),
      twentyFiveX: publicProfile(result, "twentyFiveX"),
      hundredX: publicProfile(result, "hundredX"),
    },
    componentScores: components,
    supportingFactors,
    limitingFactors,
    dataQuality: {
      status: result.overall.availability,
      confidence: result.overall.confidence,
      availableComponents,
      unavailableComponents,
      warnings: unique([
        ...result.limitations,
        ...result.institutionalDiscovery.signals.context.warnings,
        ...result.runwayScore.dataQuality.warnings,
        "Candidate profile screen only; outcomes are uncertain.",
      ]),
    },
    dataAsOf,
    marketCap,
    revenueGrowth,
    sector: metadata?.sector ?? null,
    industry: metadata?.industry ?? null,
    themes: metadata?.themes ?? [],
  };
}

function equalsFilter(actual: string | null, expected?: string): boolean {
  return expected === undefined ||
    actual?.localeCompare(expected, undefined, { sensitivity: "accent" }) === 0;
}

function includesFilter(actual: string[], expected?: string): boolean {
  return expected === undefined ||
    actual.some(
      (value) =>
        value.localeCompare(expected, undefined, { sensitivity: "accent" }) === 0,
    );
}

function metadataMatches(
  candidate: MultibaggerScreenerCandidate,
  query: ScreenerQuery,
): boolean {
  return (
    equalsFilter(candidate.sector, query.sector) &&
    equalsFilter(candidate.industry, query.industry) &&
    includesFilter(candidate.themes, query.theme)
  );
}

function resultMatches(
  item: ReturnType<typeof publicResult>,
  result: MultibaggerDiscoveryResult,
  query: ScreenerQuery,
): boolean {
  const selectedProfile = query.profile
    ? result.optionalUpsideProfiles[profileKey(query.profile)]
    : null;
  return (
    (query.minOverallScore === undefined ||
      (item.overallScore !== null &&
        item.overallScore >= query.minOverallScore)) &&
    (selectedProfile === null ||
      selectedProfile.classification === "STRONG_PROFILE" ||
      selectedProfile.classification === "MODERATE_PROFILE") &&
    (query.marketCapMin === undefined ||
      (item.marketCap !== null && item.marketCap >= query.marketCapMin)) &&
    (query.marketCapMax === undefined ||
      (item.marketCap !== null && item.marketCap <= query.marketCapMax)) &&
    (query.institutionalTrend === undefined ||
      result.institutionalDiscovery.signals.institutionalTrend ===
        query.institutionalTrend) &&
    (query.minInstitutionalScore === undefined ||
      (item.componentScores.institutional !== null &&
        item.componentScores.institutional >= query.minInstitutionalScore)) &&
    (query.minRevenueGrowth === undefined ||
      (item.revenueGrowth !== null &&
        item.revenueGrowth >= query.minRevenueGrowth))
  );
}

function setHeaders(res: Response, id: string, cache = CACHE_HEADER): void {
  res.setHeader("X-Request-Id", id);
  res.setHeader("Cache-Control", cache);
  res.setHeader("Vary", "Authorization, Accept");
}

function sendError(res: Response, error: unknown, id: string): void {
  const apiError =
    error instanceof MultibaggerApiV1Error
      ? error
      : new MultibaggerApiV1Error(
          500,
          "INTERNAL_ERROR",
          "Unable to retrieve multibagger candidate data.",
        );
  setHeaders(res, id, "no-store");
  res.status(apiError.status).json({
    error: {
      code: apiError.code,
      message: apiError.message,
      requestId: id,
    },
  });
}

function withApiBoundary(
  routeName: string,
  deps: MultibaggerApiV1Deps,
  handler: (
    req: Request,
    principal: MultibaggerApiPrincipal,
  ) => Promise<unknown>,
): RequestHandler {
  return async (req, res) => {
    const id = requestId(req);
    const startedAt = Date.now();
    try {
      const principal = await requireScope(req, deps);
      const data = await handler(req, principal);
      setHeaders(res, id);
      res.status(200).json({
        data,
        meta: {
          dataAsOf:
            typeof (data as { dataAsOf?: unknown }).dataAsOf === "string"
              ? (data as { dataAsOf: string }).dataAsOf
              : null,
          modelVersion: "multibagger_v1",
          source: SOURCE_LABEL,
          requestId: id,
          limitations: [
            "This API screens research candidates and does not provide investment advice.",
          ],
        },
      });
      console.log(JSON.stringify({
        event: "multibagger_api_v1_request",
        route: routeName,
        clientId: principal.clientId,
        status: 200,
        requestId: id,
        durationMs: Date.now() - startedAt,
      }));
    } catch (error) {
      sendError(res, error, id);
      const apiError =
        error instanceof MultibaggerApiV1Error
          ? error
          : { status: 500, code: "INTERNAL_ERROR" };
      console.error(JSON.stringify({
        event: "multibagger_api_v1_error",
        route: routeName,
        status: apiError.status,
        code: apiError.code,
        requestId: id,
        durationMs: Date.now() - startedAt,
      }));
    }
  };
}

export function registerMultibaggerApiV1Routes(
  app: Express,
  dependencies: Partial<MultibaggerApiV1Deps> = {},
): void {
  const deps = { ...defaultDeps, ...dependencies };

  // Static route must precede /:symbol.
  app.get("/api/v1/multibagger/screener", withApiBoundary(
    "multibagger-screener",
    deps,
    async (req) => {
      const query = parseScreenerQuery(req.query);
      const candidates = await deps.listCandidates();
      if (candidates === null) {
        throw new MultibaggerApiV1Error(
          404,
          "DATA_UNAVAILABLE",
          "No current candidate universe is available.",
        );
      }
      const uniqueCandidates = Array.from(
        new Map(
          candidates
            .filter((candidate) => metadataMatches(candidate, query))
            .map((candidate) => [candidate.symbol.toUpperCase(), candidate]),
        ).values(),
      );
      const computed = await Promise.all(
        uniqueCandidates.map(async (candidate) => {
          const symbol = requireSymbol(candidate.symbol);
          const input = await deps.loadDiscoveryInput(symbol);
          const result = deps.computeDiscovery(input);
          const item = publicResult(result, input, candidate);
          return { item, result };
        }),
      );
      const matches = computed
        .filter(({ item, result }) => resultMatches(item, result, query))
        .sort(
          (left, right) =>
            (right.item.overallScore ?? -1) -
              (left.item.overallScore ?? -1) ||
            left.item.symbol.localeCompare(right.item.symbol),
        );
      return {
        candidates: matches
          .slice(query.offset, query.offset + query.limit)
          .map(({ item }) => item),
        totalCount: matches.length,
        limit: query.limit,
        offset: query.offset,
        dataAsOf: matches
          .map(({ item }) => item.dataAsOf)
          .filter((value): value is string => value !== null)
          .sort()
          .at(-1) ?? null,
        modelVersion: "multibagger_v1",
      };
    },
  ));

  app.get("/api/v1/multibagger/:symbol", withApiBoundary(
    "multibagger-symbol",
    deps,
    async (req) => {
      const symbol = requireSymbol(String(req.params.symbol ?? ""));
      const [input, metadata] = await Promise.all([
        deps.loadDiscoveryInput(symbol),
        deps.getCandidateMetadata(symbol),
      ]);
      return publicResult(deps.computeDiscovery(input), input, metadata);
    },
  ));
}

export const multibaggerApiV1Defaults = {
  requiredScope: REQUIRED_SCOPE,
  source: SOURCE_LABEL,
  cacheHeader: CACHE_HEADER,
} as const;