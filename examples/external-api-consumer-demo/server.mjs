import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const DEFAULT_PORT = 4178;
const REQUEST_TIMEOUT_MS = 10_000;

const ALLOWED_STATUSES = new Set([400, 401, 403, 404, 429, 500]);
const SAFE_QUERY_RULES = {
  institutionalRanking: new Set([
    "quarter", "positionType", "cohort", "sector", "industry", "theme",
    "marketCapMin", "marketCapMax", "minManagers", "minReportedValue",
    "sortBy", "sortDirection", "limit", "offset",
  ]),
  institutionalStock: new Set(["quarter", "positionType", "cohort", "topN"]),
  institutionalTrend: new Set(["quarter", "positionType", "cohort", "historyQuarters"]),
  multibagger: new Set([
    "minOverallScore", "profile", "marketCapMin", "marketCapMax", "sector",
    "industry", "theme", "institutionalTrend", "minInstitutionalScore",
    "minRevenueGrowth", "limit", "offset",
  ]),
  multibaggerDetail: new Set(),
};

const SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;
const QUARTER_RE = /^(latest|\d{4}-Q[1-4])$/;
const POSITION_TYPES = new Set(["COMMON_EQUITY", "PUT", "CALL"]);
const COHORTS = new Set([
  "hedge_fund", "pension", "sovereign", "endowment", "asset_manager",
  "quantitative", "technology_specialist", "healthcare_specialist",
  "concentrated", "broad_diversified",
]);
const RANKING_SORTS = new Set([
  "netHolderIncrease", "newHolderCount", "increasedHolderCount",
  "aggregateShareIncreasePct", "aggregateShareIncrease", "reportedValue",
]);
const PROFILES = new Set(["fiveX", "tenX", "twentyFiveX", "hundredX"]);
const INSTITUTIONAL_TRENDS = new Set([
  "ACCELERATING_ACCUMULATION", "ACCUMULATION", "STABLE", "DISTRIBUTION",
  "ACCELERATING_DISTRIBUTION",
]);

export class ProxyError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

function json(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  res.end(payload);
}

function errorBody(error, requestId) {
  return {
    error: {
      code: error.code ?? "DEMO_PROXY_ERROR",
      message: error.message ?? "The demo could not retrieve this resource.",
      requestId,
    },
  };
}

function requestId(req) {
  const incoming = req.headers["x-request-id"];
  return typeof incoming === "string" && /^[a-zA-Z0-9._:-]{1,100}$/.test(incoming)
    ? incoming
    : cryptoRandomId();
}

function cryptoRandomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function sendProxyError(res, error, id) {
  const safe = error instanceof ProxyError
    ? error
    : new ProxyError(500, "DEMO_PROXY_ERROR", "The demo could not retrieve this resource.");
  json(res, safe.status, errorBody(safe, id), {
    "x-request-id": id,
    ...safe.headers,
  });
}

function validateQuery(url, kind) {
  const allowed = SAFE_QUERY_RULES[kind];
  const normalized = new URLSearchParams();
  for (const key of new Set(url.searchParams.keys())) {
    if (!allowed.has(key)) {
      throw new ProxyError(400, "INVALID_QUERY", "This query parameter is not supported by the demo.");
    }
    const values = url.searchParams.getAll(key);
    if (values.length !== 1) {
      throw new ProxyError(400, "INVALID_QUERY", `The ${key} filter may only be supplied once.`);
    }
    const cleaned = values[0].trim();
    if (cleaned === "") {
      throw new ProxyError(400, "INVALID_QUERY", `The ${key} filter cannot be blank.`);
    }
    normalized.set(key, cleaned);
  }

  const value = (name) => normalized.get(name);
  const number = (name, min, max, integer = false) => {
    const raw = value(name);
    if (raw === null) return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)) || parsed < min || parsed > max) {
      throw new ProxyError(400, "INVALID_QUERY", `The ${name} filter is outside its supported range.`);
    }
    normalized.set(name, String(parsed));
  };

  if (value("quarter") !== null && !QUARTER_RE.test(value("quarter"))) {
    throw new ProxyError(400, "INVALID_QUERY", "quarter must be latest or YYYY-Q1 through YYYY-Q4.");
  }
  if (value("positionType") !== null && !POSITION_TYPES.has(value("positionType"))) {
    throw new ProxyError(400, "INVALID_QUERY", "positionType is not supported.");
  }
  if (value("cohort") !== null && !COHORTS.has(value("cohort"))) {
    throw new ProxyError(400, "INVALID_QUERY", "cohort is not supported.");
  }
  if (kind === "institutionalRanking") {
    for (const name of ["sector", "industry", "theme"]) {
      if (value(name)?.trim().length > 100 || value(name)?.trim().length === 0) {
        throw new ProxyError(400, "INVALID_QUERY", `${name} must be a non-empty value up to 100 characters.`);
      }
    }
    if (value("sortBy") !== null && !RANKING_SORTS.has(value("sortBy"))) {
      throw new ProxyError(400, "INVALID_QUERY", "sortBy is not supported.");
    }
    if (value("sortDirection") !== null && !["asc", "desc"].includes(value("sortDirection"))) {
      throw new ProxyError(400, "INVALID_QUERY", "sortDirection must be asc or desc.");
    }
    number("marketCapMin", 0, Number.MAX_SAFE_INTEGER);
    number("marketCapMax", 0, Number.MAX_SAFE_INTEGER);
    number("minManagers", 1, 10_000, true);
    number("minReportedValue", 0, Number.MAX_SAFE_INTEGER);
    number("limit", 1, 100, true);
    number("offset", 0, 100_000, true);
  }
  if (kind === "institutionalStock") number("topN", 1, 100, true);
  if (kind === "institutionalTrend") number("historyQuarters", 1, 8, true);
  if (kind === "multibagger") {
    for (const name of ["sector", "industry", "theme"]) {
      if (value(name)?.trim().length > 100 || value(name)?.trim().length === 0) {
        throw new ProxyError(400, "INVALID_QUERY", `${name} must be a non-empty value up to 100 characters.`);
      }
    }
    if (value("profile") !== null && !PROFILES.has(value("profile"))) {
      throw new ProxyError(400, "INVALID_QUERY", "profile is not supported.");
    }
    if (value("institutionalTrend") !== null && !INSTITUTIONAL_TRENDS.has(value("institutionalTrend"))) {
      throw new ProxyError(400, "INVALID_QUERY", "institutionalTrend is not supported.");
    }
    number("minOverallScore", 0, 100);
    number("marketCapMin", 0, Number.MAX_SAFE_INTEGER);
    number("marketCapMax", 0, Number.MAX_SAFE_INTEGER);
    number("minInstitutionalScore", 0, 100);
    number("minRevenueGrowth", -100, 10_000);
    number("limit", 1, 100, true);
    number("offset", 0, 100_000, true);
  }
  const min = Number(value("marketCapMin"));
  const max = Number(value("marketCapMax"));
  if (value("marketCapMin") !== null && value("marketCapMax") !== null && min > max) {
    throw new ProxyError(400, "INVALID_QUERY", "marketCapMin cannot exceed marketCapMax.");
  }
  return normalized;
}

function normalizeSymbol(raw) {
  let symbol;
  try {
    symbol = decodeURIComponent(raw).trim().toUpperCase();
  } catch {
    throw new ProxyError(400, "INVALID_SYMBOL", "The symbol is not valid.");
  }
  if (!SYMBOL_RE.test(symbol)) {
    throw new ProxyError(400, "INVALID_SYMBOL", "The symbol must be 1 to 10 letters, digits, periods, or hyphens.");
  }
  return symbol;
}

function routeFor(url) {
  const path = url.pathname;
  if (path === "/api/demo/institutional/accumulation") {
    return { kind: "institutionalRanking", upstream: "/api/v1/institutional/trends/accumulation" };
  }
  const stock = path.match(/^\/api\/demo\/institutional\/stocks\/([^/]+)$/);
  if (stock) {
    return {
      kind: "institutionalStock",
      symbol: normalizeSymbol(stock[1]),
      upstream: `/api/v1/institutional/stocks/${normalizeSymbol(stock[1])}`,
    };
  }
  const trend = path.match(/^\/api\/demo\/institutional\/stocks\/([^/]+)\/trend$/);
  if (trend) {
    return {
      kind: "institutionalTrend",
      symbol: normalizeSymbol(trend[1]),
      upstream: `/api/v1/institutional/stocks/${normalizeSymbol(trend[1])}/trend`,
    };
  }
  if (path === "/api/demo/multibagger/screener") {
    return { kind: "multibagger", upstream: "/api/v1/multibagger/screener" };
  }
  const multibagger = path.match(/^\/api\/demo\/multibagger\/([^/]+)$/);
  if (multibagger) {
    return {
      kind: "multibaggerDetail",
      symbol: normalizeSymbol(multibagger[1]),
      upstream: `/api/v1/multibagger/${normalizeSymbol(multibagger[1])}`,
    };
  }
  return null;
}

function safeUpstreamMessage(status) {
  if (status === 400) return "The StockMetrics API rejected this request.";
  if (status === 401) return "The demo API key was not accepted by StockMetrics.";
  if (status === 403) return "The demo API key does not have the required scope.";
  if (status === 404) return "StockMetrics has no data available for this request.";
  if (status === 429) return "The StockMetrics API rate limit was reached. Please retry shortly.";
  return "StockMetrics could not complete this request.";
}

async function fetchUpstream(route, query, config, fetchImpl, timeoutMs = REQUEST_TIMEOUT_MS) {
  if (!config.baseUrl || !config.apiKey) {
    throw new ProxyError(503, "DEMO_NOT_CONFIGURED", "The demo backend is missing its StockMetrics API configuration.");
  }
  const upstream = new URL(route.upstream, config.baseUrl);
  for (const [key, value] of query) upstream.searchParams.set(key, value);
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ProxyError(504, "UPSTREAM_TIMEOUT", "The StockMetrics API did not respond before the demo timeout."));
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([fetchImpl(upstream, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      signal: controller.signal,
    }), deadline]);
    const responseRequestId = response.headers.get("x-request-id");
    if (!response.ok) {
      let upstreamCode = null;
      try {
        const body = await Promise.race([response.json(), deadline]);
        const candidate = body?.error?.code;
        if (typeof candidate === "string" && /^[A-Z0-9_]{1,64}$/.test(candidate)) upstreamCode = candidate;
      } catch (error) {
        if (error instanceof ProxyError) throw error;
        // Error bodies are optional; the status still maps to a safe message.
      }
      const status = ALLOWED_STATUSES.has(response.status) ? response.status : 502;
      throw new ProxyError(
        status,
        upstreamCode ?? (status === 502 ? "UPSTREAM_ERROR" : `UPSTREAM_${status}`),
        safeUpstreamMessage(response.status),
        responseRequestId ? { "x-upstream-request-id": responseRequestId } : {},
      );
    }
    try {
      return await Promise.race([response.json(), deadline]);
    } catch (error) {
      if (error instanceof ProxyError) throw error;
      throw new ProxyError(502, "UPSTREAM_INVALID_JSON", "The StockMetrics API returned an invalid response.");
    }
  } catch (error) {
    if (error instanceof ProxyError) throw error;
    if (error?.name === "AbortError" || controller.signal.aborted) {
      throw new ProxyError(504, "UPSTREAM_TIMEOUT", "The StockMetrics API did not respond before the demo timeout.");
    }
    throw new ProxyError(503, "UPSTREAM_NETWORK_ERROR", "The demo could not reach the StockMetrics API.");
  } finally {
    clearTimeout(timer);
  }
}

function contentType(path) {
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
  }[extname(path)] ?? "application/octet-stream";
}

async function serveStatic(req, res) {
  const pathname = new URL(req.url, "http://demo.local").pathname;
  const requested = pathname === "/" ? "/index.html" : pathname;
  const file = normalize(join(PUBLIC_DIR, requested));
  if (!file.startsWith(PUBLIC_DIR + sep)) {
    json(res, 404, { error: { code: "NOT_FOUND", message: "Not found." } });
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    res.writeHead(200, {
      "content-type": contentType(file),
      "cache-control": "no-cache",
    });
    createReadStream(file).pipe(res);
  } catch {
    json(res, 404, { error: { code: "NOT_FOUND", message: "Not found." } });
  }
}

export function createDemoServer({
  baseUrl = process.env.STOCKMETRICS_API_BASE_URL,
  apiKey = process.env.STOCKMETRICS_API_KEY,
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  const config = {
    baseUrl: typeof baseUrl === "string" ? baseUrl.replace(/\/+$/, "") : "",
    apiKey: typeof apiKey === "string" ? apiKey : "",
  };
  return createServer(async (req, res) => {
    const id = requestId(req);
    res.setHeader("x-request-id", id);
    if (req.method !== "GET") {
      sendProxyError(res, new ProxyError(405, "METHOD_NOT_ALLOWED", "Only GET requests are supported."), id);
      return;
    }
    let url;
    try {
      url = new URL(req.url, "http://demo.local");
      const route = routeFor(url);
      if (route) {
        const query = validateQuery(url, route.kind);
        const body = await fetchUpstream(route, query, config, fetchImpl, timeoutMs);
        json(res, 200, body, {
          "x-request-id": id,
          "cache-control": "no-store",
        });
        return;
      }
    } catch (error) {
      sendProxyError(res, error, id);
      return;
    }
    await serveStatic(req, res);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  createDemoServer().listen(port, "0.0.0.0", () => {
    console.log(`External API consumer demo listening on port ${port}`);
  });
}