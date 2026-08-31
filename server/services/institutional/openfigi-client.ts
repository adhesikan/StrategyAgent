import {
  normalizeCusip,
  resolveProviderSecurityReference,
  resolveReviewedSecurityReference,
  type SecurityReferenceCandidate,
  type SecurityReferenceResolution,
} from "./security-reference-enrichment";

const OPENFIGI_MAPPING_URL = "https://api.openfigi.com/v3/mapping";
const providerCoordinators = new Map<string, ProviderCoordinator>();

interface ProviderCoordinator {
  activeBatches: number;
  concurrency: number;
  batchQueue: Array<() => void>;
  nextRequestAt: number;
  requestSlotTail: Promise<void>;
  cooldown: Promise<void> | null;
  cooldownUntil: number;
}

function createProviderCoordinator(): ProviderCoordinator {
  return {
    activeBatches: 0,
    concurrency: 1,
    batchQueue: [],
    nextRequestAt: 0,
    requestSlotTail: Promise.resolve(),
    cooldown: null,
    cooldownUntil: 0,
  };
}

/** Test-only isolation hook for the process-wide OpenFIGI quota coordinator. */
export function resetOpenFigiProviderSchedulersForTests(): void {
  providerCoordinators.clear();
}

export interface OpenFigiFetch {
  (input: string, init: RequestInit): Promise<Response>;
}

export interface OpenFigiClientOptions {
  apiKey?: string;
  fetch?: OpenFigiFetch;
  batchSize?: number;
  /** Maximum mapping batches in flight for this provider client. */
  concurrency?: number;
  timeoutMs?: number;
  maxRetries?: number;
  backoffMs?: number;
  /** Maximum advisory-lock wait accepted from Retry-After or local backoff. */
  maxRetryDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
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

function retryAfterMs(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
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
  /** Safe operational reporting that never exposes key material. */
  public readonly authMode: "KEYED" | "UNAUTHENTICATED";
  /** Safe request limits suitable for operational/CLI reporting. */
  public readonly executionProfile: Readonly<{
    authMode: "KEYED" | "UNAUTHENTICATED";
    batchSize: number;
    concurrency: number;
    requestLimit: number;
    windowMs: number;
    minimumIntervalMs: number;
  }>;
  private readonly apiKey?: string;
  private readonly fetcher: OpenFigiFetch;
  private readonly batchSize: number;
  private readonly concurrency: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly backoffMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private readonly logger?: Pick<Console, "warn">;
  private readonly coordinator: ProviderCoordinator;

  constructor(options: OpenFigiClientOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENFIGI_API_KEY;
    this.authMode = this.apiKey ? "KEYED" : "UNAUTHENTICATED";
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
    const batchLimit = this.apiKey ? 100 : 10;
    this.batchSize = typeof options.batchSize === "number" && Number.isFinite(options.batchSize)
      ? Math.min(batchLimit, Math.max(1, Math.floor(options.batchSize)))
      : batchLimit;
    this.concurrency = typeof options.concurrency === "number" && Number.isFinite(options.concurrency)
      ? Math.min(25, Math.max(1, Math.floor(options.concurrency)))
      : 1;
    this.timeoutMs = Math.max(1, options.timeoutMs ?? 10_000);
    this.maxRetries = Math.max(0, options.maxRetries ?? 2);
    this.backoffMs = Math.max(0, options.backoffMs ?? 250);
    this.maxRetryDelayMs = typeof options.maxRetryDelayMs === "number"
      && Number.isFinite(options.maxRetryDelayMs)
      && options.maxRetryDelayMs >= 0
      ? options.maxRetryDelayMs!
      // The default must be large enough to honor the documented reset window
      // for the active tier. Callers can still choose a smaller explicit cap.
      : this.authMode === "KEYED" ? 6_000 : 60_000;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
    this.logger = options.logger;
    const requestLimit = 25;
    const windowMs = this.authMode === "KEYED" ? 6_000 : 60_000;
    this.executionProfile = Object.freeze({
      authMode: this.authMode,
      batchSize: this.batchSize,
      concurrency: this.concurrency,
      requestLimit,
      windowMs,
      minimumIntervalMs: windowMs / requestLimit,
    });
    // The raw credential is only an in-memory map key: it is never returned,
    // logged, or included in resolutions/operational profiles.
    const coordinatorKey = this.apiKey ? `KEYED:${this.apiKey}` : "UNAUTHENTICATED";
    this.coordinator = providerCoordinators.get(coordinatorKey) ?? createProviderCoordinator();
    this.coordinator.concurrency = Math.max(this.coordinator.concurrency, this.concurrency);
    providerCoordinators.set(coordinatorKey, this.coordinator);
  }

  async resolveCusips(cusips: readonly (string | null | undefined)[]): Promise<SecurityReferenceResolution[]> {
    const output: SecurityReferenceResolution[] = cusips.map((value) =>
      resolveReviewedSecurityReference(value, []));
    const jobs = cusips.map((value, index) => ({ cusip: normalizeCusip(value), index }))
      .filter((job): job is { cusip: string; index: number } => job.cusip !== null);

    await Promise.all(Array.from({ length: Math.ceil(jobs.length / this.batchSize) }, async (_unused, batchIndex) => {
      const batch = jobs.slice(batchIndex * this.batchSize, (batchIndex + 1) * this.batchSize);
      const results = await this.scheduleBatch(() => this.resolveBatch(batch.map((job) => job.cusip)));
      for (let index = 0; index < batch.length; index++) output[batch[index].index] = results[index];
    }));
    return output;
  }

  private async scheduleBatch<T>(work: () => Promise<T>): Promise<T> {
    if (this.coordinator.activeBatches >= this.coordinator.concurrency) {
      await new Promise<void>((resolve) => this.coordinator.batchQueue.push(() => {
        // Reserve the released slot before waking the waiter. Otherwise a new
        // caller can slip in first and briefly exceed the provider semaphore.
        this.coordinator.activeBatches++;
        resolve();
      }));
    } else {
      this.coordinator.activeBatches++;
    }
    try {
      return await work();
    } finally {
      this.coordinator.activeBatches--;
      this.coordinator.batchQueue.shift()?.();
    }
  }

  /**
   * A 429 pauses every queued/retrying batch behind one shared promise.  This
   * is deliberately provider-keyed rather than per batch so retrying a large
   * lookup cannot turn one provider signal into a retry storm.
   */
  private startCooldown(milliseconds: number): Promise<void> {
    this.coordinator.cooldownUntil = Math.max(
      this.coordinator.cooldownUntil,
      this.now() + milliseconds,
    );
    if (!this.coordinator.cooldown) {
      const coordinator = this.coordinator;
      const cooldown = (async () => {
        while (this.now() < coordinator.cooldownUntil) {
          const maximumSleep = this.maxRetryDelayMs > 0
            ? this.maxRetryDelayMs
            : coordinator.cooldownUntil - this.now();
          await this.sleep(Math.min(
            coordinator.cooldownUntil - this.now(),
            maximumSleep,
          ));
        }
      })().finally(() => {
        if (coordinator.cooldown === cooldown) {
          coordinator.cooldown = null;
          coordinator.cooldownUntil = 0;
        }
      });
      coordinator.cooldown = cooldown;
    }
    return this.coordinator.cooldown!;
  }

  private async waitForCooldown(): Promise<void> {
    while (this.coordinator.cooldown) await this.coordinator.cooldown;
  }

  private async waitForRequestTime(timestamp: number): Promise<void> {
    // Split an unusually long wait into bounded sleeps while retaining the
    // provider's required pacing interval.
    const maximumSleep = this.maxRetryDelayMs > 0
      ? Math.min(this.maxRetryDelayMs, this.executionProfile.minimumIntervalMs)
      : this.executionProfile.minimumIntervalMs;
    while (this.now() < timestamp) {
      await this.sleep(Math.min(timestamp - this.now(), maximumSleep));
    }
  }

  /**
   * Allocate request starts serially.  Batches can still parse responses in
   * parallel, but no caller can create a burst that exceeds OpenFIGI's tier.
   */
  private async acquireRequestSlot(): Promise<void> {
    let release!: () => void;
    const previous = this.coordinator.requestSlotTail;
    this.coordinator.requestSlotTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      await this.waitForCooldown();
      await this.waitForRequestTime(this.coordinator.nextRequestAt);
      this.coordinator.nextRequestAt = this.now() + this.executionProfile.minimumIntervalMs;
    } finally {
      release();
    }
  }

  private async resolveBatch(cusips: readonly string[]): Promise<SecurityReferenceResolution[]> {
    let lastError = "REQUEST_FAILED";
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.acquireRequestSlot();
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
        const retryAfter = retryAfterMs(response.headers.get("retry-after"), this.now())
          ?? retryAfterMs(response.headers.get("ratelimit-reset"), this.now());
        const boundedRetryAfter = retryAfter === undefined
          ? undefined
          : Math.min(retryAfter, this.maxRetryDelayMs);
        if (response.status === 429) {
          if (attempt < this.maxRetries) {
            // 429 is provider-wide: one bounded wait is shared by all batches.
            await this.startCooldown(Math.min(retryAfter ?? this.backoffMs * 2 ** attempt, this.maxRetryDelayMs));
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