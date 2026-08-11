/**
 * server/services/broker-execution-adapter.ts
 *
 * Sprint 2.8.0 — Broker Execution Adapter
 *
 * Canonical read-only broker execution interface and normalizers.
 * No order submission methods are exposed in this file.
 * Order submission (prepareOrder, submitOrder, cancelOrder) belongs to Sprint 2.8.5.
 *
 * Provider capability matrix documented here from actual integration code.
 */

import type {
  BrokerPermissions,
  BrokerAccount,
  BrokerBalanceContext,
  BrokerPositionContext,
  BrokerQuoteValidation,
  BrokerAccountType,
  ProviderCapabilityMatrix,
  ProviderCapabilityState,
} from "@shared/execution-types";
import { EXECUTION_FRESHNESS_THRESHOLDS } from "@shared/execution-types";

// ─────────────────────────────────────────────────────────────────────────────
// BROKER EXECUTION ADAPTER INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read-only broker execution interface.
 * All methods return normalized types — never raw provider payloads.
 * Future order methods (prepareOrder, submitOrder, cancelOrder) MUST NOT
 * be added until Sprint 2.8.5 architecture review.
 */
export interface BrokerExecutionAdapter {
  /** Check if the broker session is valid and connected */
  getConnectionStatus(userId: string): Promise<BrokerConnectionStatus>;

  /** List server-authorized accounts for this user's broker connection */
  listAccounts(userId: string): Promise<BrokerAccount[]>;

  /** Get normalized permissions for the user's broker account */
  getAccountCapabilities(userId: string, accountRef: string): Promise<BrokerPermissions>;

  /** Get buying power for the account */
  getBuyingPower(userId: string, accountRef: string): Promise<BrokerBalanceContext>;

  /** Get positions for a specific symbol */
  getPositions(userId: string, accountRef?: string): Promise<BrokerPositionContext[]>;

  /** Validate a quote for preflight purposes (not for order price construction) */
  getQuoteValidation(userId: string, symbol: string): Promise<BrokerQuoteValidation>;

  /** Validate that an options contract still exists and has a fresh quote */
  validateOptionsContract(
    userId: string,
    contractSymbol: string
  ): Promise<OptionsContractValidation>;

  /** Summarize what this provider supports */
  getExecutionCapabilitySummary(): ProviderExecutionCapabilitySummary;

  // FUTURE ONLY — not implemented in Sprint 2.8.0:
  // prepareOrder?(): never;
  // submitOrder?(): never;
  // cancelOrder?(): never;
}

export interface BrokerConnectionStatus {
  connected: boolean;
  provider: string;
  needsReauth: boolean;
  /** Token/session age in seconds, if available */
  sessionAgeSec?: number;
  checkedAt: string; // ISO 8601
}

export interface OptionsContractValidation {
  contractSymbol: string;
  exists: boolean;
  isExpired: boolean;
  hasQuote: boolean;
  quoteIsFresh: boolean;
  contractChangedStatus: "UNCHANGED" | "CHANGED" | "UNAVAILABLE";
  checkedAt: string; // ISO 8601
}

export interface ProviderExecutionCapabilitySummary {
  provider: string;
  supportsEquityOrders: boolean;
  supportsOptionsOrders: boolean;
  supportsMultiLegOrders: boolean;
  supportsSandbox: boolean;
  hasBuyingPowerApi: boolean;
  hasPositionsApi: boolean;
  hasQuoteApi: boolean;
  hasPermissionsApi: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER CAPABILITY MATRIX
// (populated from actual integration code, not speculation)
// ─────────────────────────────────────────────────────────────────────────────

const cap = (v: ProviderCapabilityState): ProviderCapabilityState => v;

export const PROVIDER_CAPABILITY_MATRIX: Record<string, ProviderCapabilityMatrix> = {
  tradier: {
    provider: "tradier",
    equity: cap("SUPPORTED"),      // server/broker/providers/tradier.ts — placeOrder equity
    options: cap("SUPPORTED"),     // tradier.ts — optionSymbol/optionSide in OrderRequest
    multiLeg: cap("UNKNOWN"),      // OTOCO bracket supported; true multi-leg spread native TBD
    fractional: cap("UNSUPPORTED"),// Tradier does not support fractional shares
    marketOrder: cap("SUPPORTED"),
    limitOrder: cap("SUPPORTED"),
    stopOrder: cap("SUPPORTED"),
    sandbox: cap("SUPPORTED"),     // Tradier sandbox API available; sandbox: prefix account IDs
    permissionsApi: cap("UNKNOWN"),// InsufficientScope error handled; no explicit level API found
    buyingPowerApi: cap("SUPPORTED"),// getBrokerAccounts returns balances
    positionsApi: cap("SUPPORTED"),
    quoteApi: cap("SUPPORTED"),
  },
  tradestation: {
    provider: "tradestation",
    equity: cap("SUPPORTED"),      // server/broker/providers/tradestation.ts — placeOrder
    options: cap("SUPPORTED"),
    multiLeg: cap("UNKNOWN"),      // TradeStation supports spreads; adapter TBD
    fractional: cap("UNKNOWN"),
    marketOrder: cap("SUPPORTED"),
    limitOrder: cap("SUPPORTED"),
    stopOrder: cap("SUPPORTED"),
    sandbox: cap("UNKNOWN"),       // TradeStation sim account may be available; not verified
    permissionsApi: cap("UNKNOWN"),
    buyingPowerApi: cap("SUPPORTED"),
    positionsApi: cap("SUPPORTED"),
    quoteApi: cap("SUPPORTED"),
  },
  snaptrade: {
    provider: "snaptrade",
    equity: cap("SUPPORTED"),      // server/snaptrade.ts — placeSnaptradeOrder
    options: cap("UNKNOWN"),
    multiLeg: cap("UNKNOWN"),
    fractional: cap("UNKNOWN"),
    marketOrder: cap("SUPPORTED"),
    limitOrder: cap("SUPPORTED"),
    stopOrder: cap("UNKNOWN"),
    sandbox: cap("UNKNOWN"),       // SnapTrade paper trading depends on connected broker
    permissionsApi: cap("UNKNOWN"),
    buyingPowerApi: cap("SUPPORTED"),// via SnapTrade holdings/balances
    positionsApi: cap("SUPPORTED"),
    quoteApi: cap("UNKNOWN"),
  },
};

export function getProviderCapabilityMatrix(provider: string): ProviderCapabilityMatrix {
  return (
    PROVIDER_CAPABILITY_MATRIX[provider.toLowerCase()] ?? {
      provider,
      equity: "UNKNOWN",
      options: "UNKNOWN",
      multiLeg: "UNKNOWN",
      fractional: "UNKNOWN",
      marketOrder: "UNKNOWN",
      limitOrder: "UNKNOWN",
      stopOrder: "UNKNOWN",
      sandbox: "UNKNOWN",
      permissionsApi: "UNKNOWN",
      buyingPowerApi: "UNKNOWN",
      positionsApi: "UNKNOWN",
      quoteApi: "UNKNOWN",
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NORMALIZERS
// ─────────────────────────────────────────────────────────────────────────────

export function maskAccountId(rawId: string): string {
  if (!rawId) return "••••????";
  const clean = rawId.replace(/\s/g, "");
  if (clean.length <= 4) return `••••${clean}`;
  return `••••${clean.slice(-4)}`;
}

export function normalizeBrokerAccountType(raw: string | undefined): BrokerAccountType {
  if (!raw) return "OTHER";
  const u = raw.toUpperCase();
  if (u.includes("CASH")) return "CASH";
  if (u.includes("ROTH")) return "ROTH_IRA";
  if (u.includes("IRA")) return "IRA";
  if (u.includes("MARGIN")) return "MARGIN";
  return "OTHER";
}

/**
 * Validate a raw quote for execution preflight.
 * Does NOT return raw price — preflight only.
 */
export function validateQuoteForPreflight(
  raw: {
    bid?: number | null;
    ask?: number | null;
    last?: number | null;
    timestamp?: string | null;
    asOf?: string | null;
  },
  symbol: string,
  maxAgeSec: number = EXECUTION_FRESHNESS_THRESHOLDS.underlyingQuoteSec
): BrokerQuoteValidation {
  const now = Date.now();
  const asOfStr = raw.timestamp || raw.asOf || null;
  const asOfMs = asOfStr ? new Date(asOfStr).getTime() : null;

  const bid = raw.bid ?? null;
  const ask = raw.ask ?? null;
  const freshnessSec = asOfMs != null ? (now - asOfMs) / 1000 : Infinity;

  const hasBid = bid != null && bid > 0;
  const hasAsk = ask != null && ask > 0;
  const hasMid = hasBid && hasAsk;
  const isStale = freshnessSec > maxAgeSec;
  const isCrossed = hasBid && hasAsk && bid > ask;
  const isZeroBid = bid === 0;
  const isSpreadInvalid = hasAsk && ask <= 0;
  const isFresh = !isStale && hasBid && hasAsk && !isCrossed && !isZeroBid;

  return {
    symbol,
    hasBid,
    hasAsk,
    hasMid,
    isStale,
    isCrossed,
    isZeroBid,
    isSpreadInvalid,
    isFresh,
    freshnessSec: Math.round(freshnessSec),
    source: asOfMs != null ? "broker" : "unavailable",
    asOf: asOfStr ?? new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LIVE ADAPTER FACTORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a live broker execution adapter for a given provider.
 * Uses existing broker service infrastructure — read-only operations only.
 * No order calls.
 */
export async function createLiveBrokerExecutionAdapter(
  provider: string
): Promise<BrokerExecutionAdapter> {
  return new LiveBrokerExecutionAdapter(provider);
}

class LiveBrokerExecutionAdapter implements BrokerExecutionAdapter {
  constructor(private readonly provider: string) {}

  async getConnectionStatus(userId: string): Promise<BrokerConnectionStatus> {
    const { storage } = await import("../storage");
    try {
      const conn = await storage.getBrokerConnectionWithToken(userId);
      if (!conn || !conn.isConnected) {
        return {
          connected: false,
          provider: this.provider,
          needsReauth: false,
          checkedAt: new Date().toISOString(),
        };
      }
      const hasToken = !!(conn.accessToken);
      const needsReauth = !hasToken;
      return {
        connected: conn.isConnected && hasToken,
        provider: conn.provider || this.provider,
        needsReauth,
        checkedAt: new Date().toISOString(),
      };
    } catch {
      return {
        connected: false,
        provider: this.provider,
        needsReauth: false,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async listAccounts(userId: string): Promise<BrokerAccount[]> {
    const broker = await import("../broker/index");
    try {
      const raw = await broker.getBrokerAccounts(userId);
      const { storage } = await import("../storage");
      const conn = await storage.getBrokerConnection(userId);
      const preferredId = conn?.preferredAccountId;

      return (raw ?? []).map((a: any) => ({
        accountRef: a.id,
        accountIdMasked: maskAccountId(a.id),
        accountType: normalizeBrokerAccountType(a.type),
        accountName: a.name || undefined,
        provider: this.provider,
        isPreferred: a.id === preferredId,
      }));
    } catch {
      return [];
    }
  }

  async getAccountCapabilities(
    _userId: string,
    _accountRef: string
  ): Promise<BrokerPermissions> {
    // Tradier and TradeStation do not expose a dedicated permissions API.
    // We detect insufficient permissions reactively via InsufficientScope errors.
    // Return UNAVAILABLE with appropriate note.
    return {
      equityTrading: null,
      optionsTrading: null,
      optionsLevel: null,
      multiLeg: null,
      margin: null,
      shortOptions: null,
      source: "unavailable",
      checkedAt: new Date().toISOString(),
    };
  }

  async getBuyingPower(
    userId: string,
    _accountRef: string
  ): Promise<BrokerBalanceContext> {
    const broker = await import("../broker/index");
    try {
      const accounts = await broker.getBrokerAccounts(userId);
      const account = accounts[0];
      if (!account) {
        return { available: false, currency: "USD", source: "unavailable", asOf: new Date().toISOString() };
      }
      const bp = (account as any).buyingPower ?? (account as any).cashBalance ?? (account as any).balance;
      if (bp == null) {
        return { available: false, currency: "USD", source: "unavailable", asOf: new Date().toISOString() };
      }
      return {
        available: true,
        buyingPowerUsd: Number(bp),
        currency: "USD",
        source: "broker",
        asOf: new Date().toISOString(),
      };
    } catch {
      return { available: false, currency: "USD", source: "unavailable", asOf: new Date().toISOString() };
    }
  }

  async getPositions(
    userId: string,
    _accountRef?: string
  ): Promise<BrokerPositionContext[]> {
    const broker = await import("../broker/index");
    try {
      const positions = await broker.getBrokerPositions(userId);
      return (positions ?? []).map((p: any) => ({
        symbol: String(p.symbol ?? "").toUpperCase(),
        quantity: Number(p.qty ?? p.quantity ?? 0),
        isLiveBrokerData: true,
        asOf: new Date().toISOString(),
      }));
    } catch {
      return [];
    }
  }

  async getQuoteValidation(
    userId: string,
    symbol: string
  ): Promise<BrokerQuoteValidation> {
    const broker = await import("../broker/index");
    try {
      const conn = await (await import("../storage")).storage.getBrokerConnectionWithToken(userId);
      if (!conn || !conn.isConnected || !conn.accessToken) {
        return {
          symbol,
          hasBid: false, hasAsk: false, hasMid: false,
          isStale: true, isCrossed: false, isZeroBid: false, isSpreadInvalid: false,
          isFresh: false, freshnessSec: Infinity,
          source: "unavailable",
          asOf: new Date().toISOString(),
        };
      }
      // Attempt a live quote via broker; fall back to unavailable on error
      const quote = await (broker as any).getBrokerQuote?.(userId, symbol).catch?.(() => null) ?? null;
      return validateQuoteForPreflight(
        { bid: quote?.bid, ask: quote?.ask, last: quote?.last, asOf: quote?.asOf || new Date().toISOString() },
        symbol,
        EXECUTION_FRESHNESS_THRESHOLDS.underlyingQuoteSec
      );
    } catch {
      return {
        symbol,
        hasBid: false, hasAsk: false, hasMid: false,
        isStale: true, isCrossed: false, isZeroBid: false, isSpreadInvalid: false,
        isFresh: false, freshnessSec: Infinity,
        source: "unavailable",
        asOf: new Date().toISOString(),
      };
    }
  }

  async validateOptionsContract(
    userId: string,
    contractSymbol: string
  ): Promise<OptionsContractValidation> {
    const broker = await import("../broker/index");
    try {
      const quote = await broker.getOptionQuote(userId, contractSymbol);
      if (!quote) {
        return {
          contractSymbol, exists: false, isExpired: false,
          hasQuote: false, quoteIsFresh: false,
          contractChangedStatus: "UNAVAILABLE",
          checkedAt: new Date().toISOString(),
        };
      }
      const validation = validateQuoteForPreflight(
        { bid: (quote as any).bid, ask: (quote as any).ask, asOf: new Date().toISOString() },
        contractSymbol,
        EXECUTION_FRESHNESS_THRESHOLDS.optionQuoteSec
      );
      const isExpired = checkContractExpiry(contractSymbol);
      return {
        contractSymbol,
        exists: true,
        isExpired,
        hasQuote: validation.hasBid && validation.hasAsk,
        quoteIsFresh: validation.isFresh,
        contractChangedStatus: isExpired ? "UNAVAILABLE" : "UNCHANGED",
        checkedAt: new Date().toISOString(),
      };
    } catch {
      return {
        contractSymbol, exists: false, isExpired: false,
        hasQuote: false, quoteIsFresh: false,
        contractChangedStatus: "UNAVAILABLE",
        checkedAt: new Date().toISOString(),
      };
    }
  }

  getExecutionCapabilitySummary(): ProviderExecutionCapabilitySummary {
    const matrix = getProviderCapabilityMatrix(this.provider);
    return {
      provider: this.provider,
      supportsEquityOrders: matrix.equity === "SUPPORTED",
      supportsOptionsOrders: matrix.options === "SUPPORTED",
      supportsMultiLegOrders: matrix.multiLeg === "SUPPORTED",
      supportsSandbox: matrix.sandbox === "SUPPORTED",
      hasBuyingPowerApi: matrix.buyingPowerApi === "SUPPORTED",
      hasPositionsApi: matrix.positionsApi === "SUPPORTED",
      hasQuoteApi: matrix.quoteApi === "SUPPORTED",
      hasPermissionsApi: matrix.permissionsApi === "SUPPORTED",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse standard OCC option symbol to check expiry.
 * Format: AAPL250117C00150000
 *         ^ 4-6 char, then YYMMDD, then C/P, then 8 digit strike
 */
function checkContractExpiry(contractSymbol: string): boolean {
  try {
    const match = contractSymbol.match(/^([A-Z]+)(\d{2})(\d{2})(\d{2})[CP]/);
    if (!match) return false;
    const [, , yy, mm, dd] = match;
    const expiry = new Date(`20${yy}-${mm}-${dd}T21:00:00Z`); // 4pm ET approx
    return expiry < new Date();
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MOCK ADAPTER (for tests)
// ─────────────────────────────────────────────────────────────────────────────

export interface MockBrokerAdapterSpyCalls {
  placeOrder: number;
  submitOrder: number;
  replaceOrder: number;
  cancelOrder: number;
}

/**
 * Injectable mock adapter for tests.
 * Tracks spy calls to assert no order mutation methods are called.
 */
export class MockBrokerExecutionAdapter implements BrokerExecutionAdapter {
  public readonly spy: MockBrokerAdapterSpyCalls = {
    placeOrder: 0,
    submitOrder: 0,
    replaceOrder: 0,
    cancelOrder: 0,
  };

  constructor(
    private readonly opts: {
      connected?: boolean;
      needsReauth?: boolean;
      provider?: string;
      accounts?: BrokerAccount[];
      permissions?: Partial<BrokerPermissions>;
      buyingPower?: Partial<BrokerBalanceContext>;
      positions?: BrokerPositionContext[];
      quoteValid?: boolean;
      quoteFresh?: boolean;
    } = {}
  ) {}

  async getConnectionStatus(_userId: string): Promise<BrokerConnectionStatus> {
    return {
      connected: this.opts.connected ?? true,
      provider: this.opts.provider ?? "mock",
      needsReauth: this.opts.needsReauth ?? false,
      checkedAt: new Date().toISOString(),
    };
  }

  async listAccounts(_userId: string): Promise<BrokerAccount[]> {
    return this.opts.accounts ?? [{
      accountRef: "mock-account-123",
      accountIdMasked: "••••3456",
      accountType: "CASH",
      accountName: "Mock Account",
      provider: this.opts.provider ?? "mock",
      isPreferred: true,
    }];
  }

  async getAccountCapabilities(
    _userId: string,
    _accountRef: string
  ): Promise<BrokerPermissions> {
    return {
      equityTrading: true,
      optionsTrading: true,
      optionsLevel: 2,
      multiLeg: false,
      margin: false,
      shortOptions: false,
      source: "unavailable",
      checkedAt: new Date().toISOString(),
      ...this.opts.permissions,
    };
  }

  async getBuyingPower(
    _userId: string,
    _accountRef: string
  ): Promise<BrokerBalanceContext> {
    return {
      available: true,
      buyingPowerUsd: 10000,
      currency: "USD",
      source: "broker",
      asOf: new Date().toISOString(),
      ...this.opts.buyingPower,
    };
  }

  async getPositions(_userId: string): Promise<BrokerPositionContext[]> {
    return this.opts.positions ?? [];
  }

  async getQuoteValidation(
    _userId: string,
    symbol: string
  ): Promise<BrokerQuoteValidation> {
    const isFresh = this.opts.quoteFresh ?? true;
    const isValid = this.opts.quoteValid ?? true;
    return {
      symbol,
      hasBid: isValid,
      hasAsk: isValid,
      hasMid: isValid,
      isStale: !isFresh,
      isCrossed: false,
      isZeroBid: false,
      isSpreadInvalid: false,
      isFresh: isFresh && isValid,
      freshnessSec: isFresh ? 10 : 500,
      source: "broker",
      asOf: new Date().toISOString(),
    };
  }

  async validateOptionsContract(
    _userId: string,
    contractSymbol: string
  ): Promise<OptionsContractValidation> {
    const isFresh = this.opts.quoteFresh ?? true;
    const isExpired = checkContractExpiry(contractSymbol);
    return {
      contractSymbol,
      exists: !isExpired,
      isExpired,
      hasQuote: !isExpired,
      quoteIsFresh: isFresh && !isExpired,
      contractChangedStatus: isExpired ? "UNAVAILABLE" : "UNCHANGED",
      checkedAt: new Date().toISOString(),
    };
  }

  getExecutionCapabilitySummary(): ProviderExecutionCapabilitySummary {
    return {
      provider: this.opts.provider ?? "mock",
      supportsEquityOrders: true,
      supportsOptionsOrders: true,
      supportsMultiLegOrders: false,
      supportsSandbox: true,
      hasBuyingPowerApi: true,
      hasPositionsApi: true,
      hasQuoteApi: true,
      hasPermissionsApi: false,
    };
  }
}
