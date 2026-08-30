import {
  normalizeCusip,
  resolveProviderSecurityReference,
  resolveReviewedSecurityReference,
  type SecurityReferenceCandidate,
  type SecurityReferenceResolution,
} from "./security-reference-enrichment";

const OPENFIGI_MAPPING_URL = "https://api.openfigi.com/v3/mapping";

export interface OpenFigiFetch {
  (input: string, init: RequestInit): Promise<Response>;
}

export interface OpenFigiClientOptions {
  apiKey?: string;
  fetch?: OpenFigiFetch;
  batchSize?: number;
  timeoutMs?: number;
  maxRetries?: number;
  backoffMs?: number;
  /** Maximum advisory-lock wait accepted from Retry-After or local backoff. */
  maxRetryDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  logger?: Pick<Console, "warn">;
}

interface OpenFigiResponseItem {
  data?: Array<Record<string, unknown>>;
  error?: string;
  warning?: string;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function candidate(record: Record<string, unknown>): SecurityReferenceCandidate {
  return {
    provider: "openfigi",
    figi: asString(record.figi),
    compositeFigi: asString(record.compositeFIGI),
    shareClassFigi: asString(record.shareClassFIGI),
    ticker: asString(record.ticker),
    name: asString(record.name),
    securityType: asString(record.securityType),
    marketSector: asString(record.marketSector),
    securityType2: asString(record.securityType2),
    exchangeCode: asString(record.exchCode),
  };
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function safeErrorCode(value: unknown): string {
  // Never return transport URLs, response bodies, or potentially credentialed messages.
  if (value instanceof DOMException && value.name === "AbortError") return "TIMEOUT";
  return value instanceof Error && value.name ? value.name.slice(0, 64) : "REQUEST_FAILED";
}

function isNoMatchError(error: string): boolean {
  return /no (identifier|match|data|mapping) found/i.test(error);
}

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/**
 * Minimal OpenFIGI v3 mapping client. Requests contain only exact ID_CUSIP
 * jobs, and results are maintained in input order even across batches.
 */
export class OpenFigiClient {
  private readonly apiKey?: string;
  private readonly fetcher: OpenFigiFetch;
  private readonly batchSize: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly backoffMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly logger?: Pick<Console, "warn">;

  constructor(options: OpenFigiClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENFIGI_API_KEY;
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
    const batchLimit = this.apiKey ? 100 : 10;
    this.batchSize = Math.min(batchLimit, Math.max(1, options.batchSize ?? batchLimit));
    this.timeoutMs = Math.max(1, options.timeoutMs ?? 10_000);
    this.maxRetries = Math.max(0, options.maxRetries ?? 2);
    this.backoffMs = Math.max(0, options.backoffMs ?? 250);
    this.maxRetryDelayMs = typeof options.maxRetryDelayMs === "number"
      && Number.isFinite(options.maxRetryDelayMs)
      && options.maxRetryDelayMs >= 0
      ? options.maxRetryDelayMs!
      : 5_000;
    this.sleep = options.sleep ?? defaultSleep;
    this.logger = options.logger;
  }

  async resolveCusips(cusips: readonly (string | null | undefined)[]): Promise<SecurityReferenceResolution[]> {
    const output: SecurityReferenceResolution[] = cusips.map((value) =>
      resolveReviewedSecurityReference(value, []));
    const jobs = cusips.map((value, index) => ({ cusip: normalizeCusip(value), index }))
      .filter((job): job is { cusip: string; index: number } => job.cusip !== null);

    for (let start = 0; start < jobs.length; start += this.batchSize) {
      const batch = jobs.slice(start, start + this.batchSize);
      const results = await this.resolveBatch(batch.map((job) => job.cusip));
      for (let index = 0; index < batch.length; index++) output[batch[index].index] = results[index];
    }
    return output;
  }

  private async resolveBatch(cusips: readonly string[]): Promise<SecurityReferenceResolution[]> {
    let lastError = "REQUEST_FAILED";
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (this.apiKey) headers["X-OPENFIGI-APIKEY"] = this.apiKey;
        const response = await this.fetcher(OPENFIGI_MAPPING_URL, {
          method: "POST",
          headers,
          body: JSON.stringify(cusips.map((idValue) => ({ idType: "ID_CUSIP", idValue }))),
          signal: controller.signal,
        });
        const retryAfter = retryAfterMs(response.headers.get("retry-after"));
        const boundedRetryAfter = retryAfter === undefined
          ? undefined
          : Math.min(retryAfter, this.maxRetryDelayMs);
        if (response.status === 429) {
          // Do not keep an advisory-locked caller waiting for an unbounded
          // server request; surface the rate limit immediately instead.
          if (retryAfter !== undefined && retryAfter > this.maxRetryDelayMs) {
            return cusips.map((cusip) => resolveProviderSecurityReference(cusip, "RATE_LIMITED", [], {
              errorCode: "HTTP_429",
              retryAfterMs: boundedRetryAfter,
            }));
          }
          if (attempt < this.maxRetries) {
            await this.sleep(Math.min(retryAfter ?? this.backoffMs * 2 ** attempt, this.maxRetryDelayMs));
            continue;
          }
          return cusips.map((cusip) => resolveProviderSecurityReference(cusip, "RATE_LIMITED", [], { errorCode: "HTTP_429", retryAfterMs: boundedRetryAfter }));
        }
        if (!response.ok) {
          lastError = `HTTP_${response.status}`;
          if (response.status >= 500 && attempt < this.maxRetries) {
            await this.sleep(Math.min(this.backoffMs * 2 ** attempt, this.maxRetryDelayMs));
            continue;
          }
          return cusips.map((cusip) => resolveProviderSecurityReference(cusip, "PROVIDER_FAILED", [], { errorCode: lastError }));
        }
        const payload: unknown = await response.json();
        if (!Array.isArray(payload)) {
          return cusips.map((cusip) => resolveProviderSecurityReference(cusip, "PARTIAL_RESPONSE", [], { errorCode: "INVALID_RESPONSE" }));
        }
        return cusips.map((cusip, index) => {
          const item = payload[index] as OpenFigiResponseItem | undefined;
          if (!item) return resolveProviderSecurityReference(cusip, "PARTIAL_RESPONSE", [], { errorCode: "MISSING_BATCH_ITEM" });
          const candidates = Array.isArray(item.data) ? item.data.filter((x): x is Record<string, unknown> => !!x && typeof x === "object").map(candidate) : [];
          if (item.error) {
            if (isNoMatchError(item.error)) {
              const resolved = resolveReviewedSecurityReference(cusip, [], candidates);
              return { ...resolved, errorCode: item.warning ? "PROVIDER_WARNING" : undefined };
            }
            return resolveProviderSecurityReference(cusip, "PROVIDER_FAILED", candidates, { errorCode: "PROVIDER_ITEM_ERROR" });
          }
          const resolved = resolveReviewedSecurityReference(cusip, [], candidates);
          return item.warning && !resolved.errorCode ? { ...resolved, errorCode: "PROVIDER_WARNING" } : resolved;
        });
      } catch (error) {
        lastError = safeErrorCode(error);
        if (attempt < this.maxRetries) {
          await this.sleep(Math.min(this.backoffMs * 2 ** attempt, this.maxRetryDelayMs));
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }
    this.logger?.warn("[openfigi] mapping request failed", { errorCode: lastError, jobCount: cusips.length });
    return cusips.map((cusip) => resolveProviderSecurityReference(cusip, "PROVIDER_FAILED", [], { errorCode: lastError }));
  }
}