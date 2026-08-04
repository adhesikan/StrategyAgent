// Client-side type contract for the safe portfolio-awareness fields returned
// by the Ask AI route (server/routes/ask.ts §5).
//
// Mirror of server/routes/internal-portfolio.ts SafePortfolioAwareness.
// All fields are optional/additive so older server responses render safely.
// No account IDs, no raw balances, no broker tokens ever appear here.

export interface SafePortfolioAwareness {
  /** ISO timestamp when positions/accounts were fetched. */
  contextFreshness: string;
  /** Non-null only when the user already holds the requested symbol. */
  existingPosition?: {
    shares: number;
    unrealizedPnl: number;
  };
  /** Explicit share count (mirrors existingPosition.shares). */
  verifiedShares?: number;
  /** True when the user already holds the requested symbol. */
  duplicateExposure?: boolean;
  /** Portfolio-concentration of this symbol. */
  concentrationWarning?: {
    pct: number;
    level: "normal" | "elevated" | "high";
  };
  cashSufficiency?: "verified" | "not_verified" | "insufficient" | "unknown";
  buyingPowerSufficiency?: "sufficient" | "insufficient" | "unknown";
  existingOptionExposure?: string | null;
  sizingAdjustment?: string | null;
}
