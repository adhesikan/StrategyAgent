/**
 * server/services/execution-readiness-service.ts — Sprint 2.8.4
 *
 * Deterministic Execution Readiness & Guardrails engine.
 *
 * PERMANENT ARCHITECTURE INVARIANTS:
 *   1. This service is READ-ONLY. It NEVER submits, modifies, or cancels orders.
 *   2. Readiness is DETERMINISTIC — no LLM, no randomness, no AI override.
 *   3. The AI assistant may explain findings; it may NEVER alter the status.
 *   4. Unknown capability must remain unknown — never fabricate broker approvals.
 *   5. Missing positions do NOT become zero holdings.
 *   6. Missing buying power does NOT become $0.
 *   7. brokerSubmissionEnabled is always false in this sprint.
 *
 * AI boundary is enforced at the type level: the output type contains
 * `brokerSubmissionEnabled: false` as a literal type constant that cannot
 * be overridden without a TypeScript error.
 */

import { randomUUID } from "crypto";
import type { OptionsOrderPreview, OptionsPreviewLeg } from "../../shared/options-order-preview-types";
import type {
  ExecutionReadinessInput,
  ExecutionReadinessResult,
  ExecutionReadinessFinding,
  ExecutionReadinessFindingCategory,
  ExecutionReadinessFindingSeverity,
  CapitalEstimate,
  ExecutionGuardrailConfig,
  BrokerReadinessCapabilities,
  ReadinessPositionContext,
  ExecutionReadinessDeps,
} from "../../shared/execution-readiness-types";
import {
  DEFAULT_EXECUTION_GUARDRAIL_CONFIG,
  EXECUTION_READINESS_STATUS_LABELS,
  EXECUTION_READINESS_STATUS_DESCRIPTIONS,
  EXECUTION_READINESS_DISCLAIMER,
  CAPITAL_ESTIMATE_DISCLAIMER,
  COVERAGE_REQUIRED_FAMILIES,
  PROTECTIVE_PUT_FAMILIES,
  DEFINED_RISK_FAMILIES,
  STRATEGY_EXPECTED_LEG_COUNT,
  FR_QUOTE_STALE, FR_ALL_QUOTES_UNAVAILABLE, FR_OPTION_MARKET_INVALID,
  FR_WIDE_BID_ASK_SPREAD, FR_SEVERE_WIDE_SPREAD, FR_ZERO_BID, FR_PARTIAL_GREEKS,
  FR_BROKER_NOT_CONNECTED, FR_ACCOUNT_UNAVAILABLE, FR_OPTIONS_PERMISSION_UNCONFIRMED,
  FR_OPTIONS_NOT_SUPPORTED, FR_MULTILEG_NOT_SUPPORTED,
  FR_INSUFFICIENT_COVERED_SHARES, FR_INSUFFICIENT_OPTION_POSITION,
  FR_POSITION_DATA_UNAVAILABLE, FR_POSITION_NOT_FOUND,
  FR_BUYING_POWER_INSUFFICIENT, FR_BUYING_POWER_UNCONFIRMED,
  FR_BROKER_MARGIN_CALCULATION_REQUIRED,
  FR_INVALID_LEG_STRUCTURE, FR_INVALID_STRIKE_ORDER, FR_INVALID_EXPIRATION_STRUCTURE,
  FR_INVALID_QUANTITY, FR_MIXED_UNDERLYING,
  FR_SHORT_OPTION_ASSIGNMENT_RISK, FR_EARLY_EXERCISE_RISK,
  FR_OPTION_EXPIRED, FR_ZERO_DTE, FR_NEAR_EXPIRATION,
  FR_LOW_OPEN_INTEREST, FR_LOW_VOLUME,
  FR_INVALID_NET_PRICE, FR_PRICING_DIRECTION_MISMATCH, FR_PRICING_UNAVAILABLE,
} from "../../shared/execution-readiness-types";

// ─────────────────────────────────────────────────────────────────────────────
// SHORT INTENT HELPER (mirrors Sprint 2.8.3 — shared by reference)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determines whether a leg intent represents a short (sell-to-open) position.
 * Uses string matching to remain resilient to future intent additions.
 * Matches: OPEN_SHORT_COVERED, OPEN_SHORT_SECURED, OPEN_SHORT_DEFINED_RISK,
 *          CLOSE_SHORT, and any future SHORT-bearing intent.
 */
export function isShortIntent(intent: string): boolean {
  return intent.includes("SHORT");
}

// ─────────────────────────────────────────────────────────────────────────────
// FINDING BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

function blocker(
  code: string,
  category: ExecutionReadinessFindingCategory,
  title: string,
  message: string,
  extras: Partial<Pick<ExecutionReadinessFinding, "source" | "legIndex">> = {}
): ExecutionReadinessFinding {
  return { code, severity: "BLOCKER", category, title, message, ...extras };
}

function warning(
  code: string,
  category: ExecutionReadinessFindingCategory,
  title: string,
  message: string,
  extras: Partial<Pick<ExecutionReadinessFinding, "source" | "legIndex">> = {}
): ExecutionReadinessFinding {
  return { code, severity: "WARNING", category, title, message, ...extras };
}

function info(
  code: string,
  category: ExecutionReadinessFindingCategory,
  title: string,
  message: string,
  extras: Partial<Pick<ExecutionReadinessFinding, "source" | "legIndex">> = {}
): ExecutionReadinessFinding {
  return { code, severity: "INFO", category, title, message, ...extras };
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY A: MARKET DATA
// ─────────────────────────────────────────────────────────────────────────────

function evaluateMarketData(
  preview: OptionsOrderPreview,
  config: ExecutionGuardrailConfig
): ExecutionReadinessFinding[] {
  const findings: ExecutionReadinessFinding[] = [];
  const legs = preview.legs;

  // Aggregate freshness check first
  const { aggregateFreshnessCategory, anyStale } = preview.quoteFreshness;
  if (aggregateFreshnessCategory === "UNAVAILABLE") {
    findings.push(blocker(
      FR_ALL_QUOTES_UNAVAILABLE, "MARKET_DATA",
      "All Quotes Unavailable",
      "No current quotes could be obtained for any option leg. Refresh preview or check broker connectivity."
    ));
    // If all quotes are unavailable, individual leg checks are redundant
    return findings;
  }

  if (anyStale) {
    findings.push(blocker(
      FR_QUOTE_STALE, "MARKET_DATA",
      "Stale Quote",
      `One or more option contract quotes are stale. Quotes must be current before proceeding to review.`
    ));
  }

  // Per-leg checks
  for (const leg of legs) {
    const q = leg.currentQuote;
    if (!q) {
      // Individual leg quote missing
      findings.push(blocker(
        FR_QUOTE_STALE, "MARKET_DATA",
        `Quote Unavailable — Leg ${leg.legIndex + 1}`,
        `No current quote for ${leg.contractSymbol}. Cannot assess execution readiness for this leg.`,
        { legIndex: leg.legIndex }
      ));
      continue;
    }

    // Crossed market
    if (q.isCrossed) {
      findings.push(blocker(
        FR_OPTION_MARKET_INVALID, "MARKET_DATA",
        `Crossed Market — Leg ${leg.legIndex + 1}`,
        `Bid exceeds ask for ${leg.contractSymbol} (bid/ask spread is crossed). Market data may be invalid.`,
        { legIndex: leg.legIndex }
      ));
    }

    // Zero bid on short leg (short premium)
    if (q.bid === 0 && isShortIntent(leg.canonicalIntent)) {
      findings.push(warning(
        FR_ZERO_BID, "MARKET_DATA",
        `Zero Bid — Short Leg ${leg.legIndex + 1}`,
        `${leg.contractSymbol} has a zero bid. Credit received may be minimal or quote data is stale.`,
        { legIndex: leg.legIndex }
      ));
    }
  }

  // Greeks completeness check (INFO)
  const legsWithPartialGreeks = legs.filter(l =>
    l.greeks && (
      l.greeks.delta === null || l.greeks.gamma === null ||
      l.greeks.theta === null || l.greeks.vega === null
    )
  );
  if (legsWithPartialGreeks.length > 0) {
    findings.push(warning(
      FR_PARTIAL_GREEKS, "MARKET_DATA",
      "Partial Greeks",
      `Greeks are incomplete for ${legsWithPartialGreeks.length} leg(s). Risk profile may be partially displayed.`
    ));
  }

  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY B: ACCOUNT
// ─────────────────────────────────────────────────────────────────────────────

function evaluateAccount(
  preview: OptionsOrderPreview,
  brokerCap: BrokerReadinessCapabilities | null
): ExecutionReadinessFinding[] {
  const findings: ExecutionReadinessFinding[] = [];

  if (!brokerCap || !brokerCap.connected) {
    findings.push(blocker(
      FR_BROKER_NOT_CONNECTED, "ACCOUNT",
      "Broker Not Connected",
      "No active broker connection found. Connect your broker account before proceeding."
    ));
    return findings; // no point checking permissions if not connected
  }

  // Options support
  if (brokerCap.supportsOptions === false) {
    findings.push(blocker(
      FR_OPTIONS_NOT_SUPPORTED, "ACCOUNT",
      "Options Not Supported",
      `This broker account does not support options orders. Check your account type or broker.`
    ));
  } else if (brokerCap.supportsOptions === null) {
    // Unknown — cannot confirm
    findings.push(warning(
      FR_OPTIONS_PERMISSION_UNCONFIRMED, "ACCOUNT",
      "Options Permissions Unconfirmed",
      "This broker does not expose a permissions API. Options trading capability cannot be confirmed. " +
      "Ensure your account has options approval before proceeding."
    ));
  }

  // Multi-leg support
  if (preview.instrumentType === "MULTI_LEG_OPTION") {
    if (brokerCap.supportsMultileg === false) {
      findings.push(blocker(
        FR_MULTILEG_NOT_SUPPORTED, "ACCOUNT",
        "Multi-Leg Orders Not Supported",
        `This broker or account does not support native multi-leg order submission. ` +
        `No leg decomposition is performed. Contact your broker or use a different provider.`
      ));
    } else if (brokerCap.supportsMultileg === null) {
      findings.push(warning(
        FR_MULTILEG_NOT_SUPPORTED, "ACCOUNT",
        "Multi-Leg Support Unconfirmed",
        `Multi-leg order capability is not confirmed for this broker. ` +
        `Verify that your account supports spread and multi-leg orders before proceeding.`
      ));
    }
  }

  // Account status check
  if (brokerCap.accountStatus && brokerCap.accountStatus !== "active" && brokerCap.accountStatus !== "ACTIVE") {
    findings.push(warning(
      FR_ACCOUNT_UNAVAILABLE, "ACCOUNT",
      "Account Status",
      `Broker account status is "${brokerCap.accountStatus}". Verify your account is active before proceeding.`
    ));
  }

  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY C: POSITION
// ─────────────────────────────────────────────────────────────────────────────

function evaluatePosition(
  preview: OptionsOrderPreview,
  positions: ReadinessPositionContext[] | null,
  strategyFamily: string
): ExecutionReadinessFinding[] {
  const findings: ExecutionReadinessFinding[] = [];
  const qty = preview.quantityContext.confirmedQuantity;
  const symbol = preview.symbol;

  // Coverage check for covered_call and collar
  if (COVERAGE_REQUIRED_FAMILIES.has(strategyFamily)) {
    if (positions === null) {
      findings.push(warning(
        FR_POSITION_DATA_UNAVAILABLE, "POSITION",
        "Position Data Unavailable",
        `${strategyFamily === "covered_call" ? "Covered call" : "Collar"} requires ${qty * 100} shares of ${symbol}. ` +
        `Position data is unavailable — coverage cannot be confirmed. Connect your broker account.`
      ));
    } else {
      const equityPos = positions.find(p => !p.isOption && p.symbol.toUpperCase() === symbol.toUpperCase());
      const sharesAvailable = equityPos?.quantity ?? 0;
      const sharesRequired = qty * 100;
      if (sharesAvailable < sharesRequired) {
        findings.push(blocker(
          FR_INSUFFICIENT_COVERED_SHARES, "POSITION",
          "Insufficient Shares for Coverage",
          `${strategyFamily === "covered_call" ? "Covered call" : "Collar"} requires ${sharesRequired} shares of ${symbol}. ` +
          `${sharesAvailable > 0 ? `Only ${sharesAvailable} shares found.` : "No shares found in account."}`
        ));
      } else {
        findings.push(info(
          "COVERAGE_CONFIRMED", "POSITION",
          "Share Coverage Confirmed",
          `${sharesAvailable} shares of ${symbol} available — ${sharesRequired} required for ${qty} contract(s).`
        ));
      }
    }
  }

  // Protective put — coverage depends on riskContext.coverageValidated
  if (PROTECTIVE_PUT_FAMILIES.has(strategyFamily)) {
    const coverageRequired = preview.assignmentExerciseContext.coverageRequired;
    if (coverageRequired) {
      if (positions === null) {
        findings.push(warning(
          FR_POSITION_DATA_UNAVAILABLE, "POSITION",
          "Position Data Unavailable",
          `Protective put requires existing share position in ${symbol}. Position data unavailable.`
        ));
      } else {
        const equityPos = positions.find(p => !p.isOption && p.symbol.toUpperCase() === symbol.toUpperCase());
        if (!equityPos || equityPos.quantity < qty * 100) {
          findings.push(blocker(
            FR_INSUFFICIENT_COVERED_SHARES, "POSITION",
            "Insufficient Shares for Protective Put",
            `Protective put requires ${qty * 100} shares of ${symbol} to protect. ` +
            `${equityPos ? `Only ${equityPos.quantity} found.` : "No shares found."}`
          ));
        }
      }
    }
  }

  // Close intents — verify existing option positions
  const closeLegs = preview.legs.filter(l =>
    l.canonicalIntent === "CLOSE_LONG" || l.canonicalIntent === "CLOSE_SHORT"
  );
  for (const leg of closeLegs) {
    if (positions === null) {
      findings.push(warning(
        FR_POSITION_DATA_UNAVAILABLE, "POSITION",
        `Position Data Unavailable — Leg ${leg.legIndex + 1}`,
        `Close intent for ${leg.contractSymbol} cannot be validated without position data.`,
        { legIndex: leg.legIndex }
      ));
    } else {
      const optPos = positions.find(p =>
        p.isOption && p.contractSymbol?.toUpperCase() === leg.contractSymbol.toUpperCase()
      );
      if (!optPos) {
        findings.push(blocker(
          FR_POSITION_NOT_FOUND, "POSITION",
          `Position Not Found — Leg ${leg.legIndex + 1}`,
          `Close order requires an existing position in ${leg.contractSymbol}, but none was found in the account.`,
          { legIndex: leg.legIndex }
        ));
      } else if (optPos.quantity < leg.quantity) {
        findings.push(blocker(
          FR_INSUFFICIENT_OPTION_POSITION, "POSITION",
          `Insufficient Option Position — Leg ${leg.legIndex + 1}`,
          `Close order requires ${leg.quantity} contracts of ${leg.contractSymbol}. ` +
          `Only ${optPos.quantity} found.`,
          { legIndex: leg.legIndex }
        ));
      }
    }
  }

  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY D: CAPITAL
// ─────────────────────────────────────────────────────────────────────────────

function estimateCapital(
  preview: OptionsOrderPreview,
  strategyFamily: string
): CapitalEstimate {
  const pricing = preview.netStructurePricing;
  const legs = preview.legs;
  const qty = preview.quantityContext.confirmedQuantity;
  const multiplier = pricing.multiplier;
  const symbol = preview.symbol;

  // Covered call: shares already owned; new capital = 0 (net credit received)
  if (strategyFamily === "covered_call") {
    const credit = pricing.pricingType === "CREDIT" ? (pricing.totalAmount ?? 0) : 0;
    return {
      estimatedRequirementUsd: 0,
      estimatedRequirementLabel: credit > 0 ? `Net credit: $${credit.toFixed(2)}` : "Shares already in account",
      estimationType: "SHARES_ONLY",
      breakdown: `Covered call: shares of ${symbol} must already be in the account. ` +
        `Net credit received (estimated): $${credit.toFixed(2)}.`,
      isEstimate: true,
      disclaimer: CAPITAL_ESTIMATE_DISCLAIMER,
    };
  }

  // Cash-secured put: (strike × 100 × qty) - credit received
  if (strategyFamily === "cash_secured_put") {
    const shortLeg = legs.find(l => isShortIntent(l.canonicalIntent) && l.optionType === "put");
    if (shortLeg) {
      const credit = pricing.pricingType === "CREDIT" ? (pricing.amountPerUnit ?? 0) : 0;
      const cashRequired = Math.max(0, (shortLeg.strike * multiplier * qty) - (credit * multiplier * qty));
      return {
        estimatedRequirementUsd: cashRequired,
        estimatedRequirementLabel: `Est. $${cashRequired.toFixed(2)}`,
        estimationType: "DEFINED_RISK",
        breakdown: `Cash-secured put: Strike $${shortLeg.strike} × ${multiplier} × ${qty} contract(s) = ` +
          `$${(shortLeg.strike * multiplier * qty).toFixed(2)} less estimated credit $${(credit * multiplier * qty).toFixed(2)}.`,
        isEstimate: true,
        disclaimer: CAPITAL_ESTIMATE_DISCLAIMER,
      };
    }
  }

  // Debit strategies: max loss = net debit paid = totalAmount
  const DEBIT_FAMILIES = [
    "long_call", "long_put", "protective_put",
    "bull_call_spread", "bear_put_spread",
    "long_straddle", "long_strangle",
    "calendar_spread", "diagonal_spread",
    "collar",
  ];
  if (DEBIT_FAMILIES.includes(strategyFamily)) {
    if (pricing.pricingType === "DEBIT" && pricing.totalAmount !== null) {
      return {
        estimatedRequirementUsd: pricing.totalAmount,
        estimatedRequirementLabel: `Est. $${pricing.totalAmount.toFixed(2)}`,
        estimationType: "DEFINED_RISK",
        breakdown: `${strategyFamily}: max loss = net debit paid = $${pricing.totalAmount.toFixed(2)} ` +
          `(${qty} contract(s) × $${(pricing.amountPerContract ?? 0).toFixed(2)}).`,
        isEstimate: true,
        disclaimer: CAPITAL_ESTIMATE_DISCLAIMER,
      };
    }
    // If debit strategy returns a credit (unusual) — still use totalAmount as margin reference
    if (pricing.totalAmount !== null) {
      return {
        estimatedRequirementUsd: pricing.totalAmount,
        estimatedRequirementLabel: `Est. $${pricing.totalAmount.toFixed(2)}`,
        estimationType: "DEFINED_RISK",
        breakdown: `${strategyFamily}: estimated capital = $${pricing.totalAmount.toFixed(2)}.`,
        isEstimate: true,
        disclaimer: CAPITAL_ESTIMATE_DISCLAIMER,
      };
    }
  }

  // Credit spreads: max loss = spread_width - credit_received (per unit) × multiplier × qty
  if (strategyFamily === "bull_put_spread" || strategyFamily === "bear_call_spread") {
    const strikes = legs.map(l => l.strike).filter(s => s > 0).sort((a, b) => a - b);
    if (strikes.length >= 2) {
      const spreadWidth = strikes[strikes.length - 1] - strikes[0];
      const creditPerUnit = pricing.pricingType === "CREDIT" ? (pricing.amountPerUnit ?? 0) : 0;
      const maxLossPerUnit = Math.max(0, spreadWidth - creditPerUnit);
      const totalCapital = maxLossPerUnit * multiplier * qty;
      return {
        estimatedRequirementUsd: totalCapital,
        estimatedRequirementLabel: `Est. $${totalCapital.toFixed(2)}`,
        estimationType: "DEFINED_RISK",
        breakdown: `${strategyFamily}: spread width $${spreadWidth.toFixed(2)} − net credit $${creditPerUnit.toFixed(2)} ` +
          `= max loss $${maxLossPerUnit.toFixed(2)}/share × ${multiplier} × ${qty} contract(s).`,
        isEstimate: true,
        disclaimer: CAPITAL_ESTIMATE_DISCLAIMER,
      };
    }
  }

  // Iron condor / iron butterfly: max wing risk - net credit
  if (strategyFamily === "iron_condor" || strategyFamily === "iron_butterfly") {
    const putLegs = legs.filter(l => l.optionType === "put").sort((a, b) => a.strike - b.strike);
    const callLegs = legs.filter(l => l.optionType === "call").sort((a, b) => a.strike - b.strike);
    const putWidth = putLegs.length >= 2 ? putLegs[putLegs.length - 1].strike - putLegs[0].strike : 0;
    const callWidth = callLegs.length >= 2 ? callLegs[callLegs.length - 1].strike - callLegs[0].strike : 0;
    const maxWingWidth = Math.max(putWidth, callWidth);
    if (maxWingWidth > 0) {
      const creditPerUnit = pricing.pricingType === "CREDIT" ? (pricing.amountPerUnit ?? 0) : 0;
      const maxLossPerUnit = Math.max(0, maxWingWidth - creditPerUnit);
      const totalCapital = maxLossPerUnit * multiplier * qty;
      return {
        estimatedRequirementUsd: totalCapital,
        estimatedRequirementLabel: `Est. $${totalCapital.toFixed(2)}`,
        estimationType: "DEFINED_RISK",
        breakdown: `${strategyFamily}: max wing width $${maxWingWidth.toFixed(2)} − net credit $${creditPerUnit.toFixed(2)} ` +
          `= max loss $${maxLossPerUnit.toFixed(2)}/share × ${multiplier} × ${qty} contract(s).`,
        isEstimate: true,
        disclaimer: CAPITAL_ESTIMATE_DISCLAIMER,
      };
    }
  }

  // Undefined-risk or calculation not possible
  return {
    estimatedRequirementUsd: null,
    estimatedRequirementLabel: "Broker margin calculation required",
    estimationType: "BROKER_MARGIN_REQUIRED",
    breakdown: `${strategyFamily}: margin requirement must be calculated by the broker. ` +
      `Cannot estimate maximum risk without broker margin API.`,
    isEstimate: true,
    disclaimer: CAPITAL_ESTIMATE_DISCLAIMER,
  };
}

function evaluateCapital(
  preview: OptionsOrderPreview,
  brokerCap: BrokerReadinessCapabilities | null,
  strategyFamily: string
): { findings: ExecutionReadinessFinding[]; capitalEstimate: CapitalEstimate } {
  const findings: ExecutionReadinessFinding[] = [];
  const capitalEstimate = estimateCapital(preview, strategyFamily);

  if (capitalEstimate.estimationType === "BROKER_MARGIN_REQUIRED") {
    findings.push(warning(
      FR_BROKER_MARGIN_CALCULATION_REQUIRED, "CAPITAL",
      "Broker Margin Calculation Required",
      "This strategy involves undefined or complex risk. " +
      "Actual margin requirement must be calculated by your broker. " +
      "Do not assume capital availability without broker confirmation."
    ));
  }

  // If buying power is available, compare
  if (brokerCap?.buyingPowerUsd != null && capitalEstimate.estimatedRequirementUsd != null) {
    if (brokerCap.buyingPowerUsd < capitalEstimate.estimatedRequirementUsd) {
      findings.push(blocker(
        FR_BUYING_POWER_INSUFFICIENT, "CAPITAL",
        "Buying Power May Be Insufficient",
        `Estimated capital requirement ($${capitalEstimate.estimatedRequirementUsd.toFixed(2)}) ` +
        `exceeds available buying power ($${brokerCap.buyingPowerUsd.toFixed(2)}). ` +
        `This is an estimate only — verify with your broker.`
      ));
    }
  } else if (!brokerCap || brokerCap.buyingPowerSource === "unavailable") {
    findings.push(warning(
      FR_BUYING_POWER_UNCONFIRMED, "CAPITAL",
      "Buying Power Unconfirmed",
      "Broker buying power could not be retrieved. " +
      "Ensure sufficient capital is available before proceeding."
    ));
  }

  return { findings, capitalEstimate };
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY E: STRUCTURE VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

function evaluateStructure(
  preview: OptionsOrderPreview,
  strategyFamily: string
): ExecutionReadinessFinding[] {
  const findings: ExecutionReadinessFinding[] = [];
  const legs = preview.legs;

  // Quantity check
  if (preview.quantityContext.confirmedQuantity <= 0) {
    findings.push(blocker(
      FR_INVALID_QUANTITY, "STRUCTURE",
      "Invalid Quantity",
      "Order quantity must be greater than zero."
    ));
  }

  // Expected leg count
  const expectedLegs = STRATEGY_EXPECTED_LEG_COUNT[strategyFamily];
  if (expectedLegs !== undefined && legs.length !== expectedLegs) {
    findings.push(blocker(
      FR_INVALID_LEG_STRUCTURE, "STRUCTURE",
      "Unexpected Leg Count",
      `${strategyFamily} expects ${expectedLegs} leg(s) but order has ${legs.length} leg(s). ` +
      `Return to Order Preparation to reconstruct the structure.`
    ));
  }

  // All legs same underlying
  const symbols = new Set(legs.map(l => {
    // Extract underlying from OCC symbol (first 1-6 alpha chars)
    const m = l.contractSymbol.match(/^([A-Z]{1,6})\d/);
    return m ? m[1] : l.contractSymbol.slice(0, 4);
  }));
  if (symbols.size > 1) {
    findings.push(blocker(
      FR_MIXED_UNDERLYING, "STRUCTURE",
      "Mixed Underlying",
      `All legs must share the same underlying. Found: ${Array.from(symbols).join(", ")}.`
    ));
  }

  // Per-leg quantity
  for (const leg of legs) {
    if (leg.quantity <= 0) {
      findings.push(blocker(
        FR_INVALID_QUANTITY, "STRUCTURE",
        `Invalid Quantity — Leg ${leg.legIndex + 1}`,
        `Leg ${leg.legIndex + 1} has invalid quantity ${leg.quantity}.`,
        { legIndex: leg.legIndex }
      ));
    }
  }

  // Strike ordering for spreads
  if (strategyFamily === "bull_call_spread") {
    // long lower strike call + short higher strike call
    const longLegs = legs.filter(l => !isShortIntent(l.canonicalIntent) && l.optionType === "call");
    const shortLegs = legs.filter(l => isShortIntent(l.canonicalIntent) && l.optionType === "call");
    if (longLegs.length && shortLegs.length) {
      const longStrike = longLegs[0].strike;
      const shortStrike = shortLegs[0].strike;
      if (longStrike >= shortStrike) {
        findings.push(blocker(
          FR_INVALID_STRIKE_ORDER, "STRUCTURE",
          "Invalid Strike Order",
          `Bull call spread: long strike ($${longStrike}) must be below short strike ($${shortStrike}).`
        ));
      }
    }
  }

  if (strategyFamily === "bear_put_spread") {
    // long higher strike put + short lower strike put
    const longLegs = legs.filter(l => !isShortIntent(l.canonicalIntent) && l.optionType === "put");
    const shortLegs = legs.filter(l => isShortIntent(l.canonicalIntent) && l.optionType === "put");
    if (longLegs.length && shortLegs.length) {
      const longStrike = longLegs[0].strike;
      const shortStrike = shortLegs[0].strike;
      if (longStrike <= shortStrike) {
        findings.push(blocker(
          FR_INVALID_STRIKE_ORDER, "STRUCTURE",
          "Invalid Strike Order",
          `Bear put spread: long strike ($${longStrike}) must be above short strike ($${shortStrike}).`
        ));
      }
    }
  }

  if (strategyFamily === "bull_put_spread") {
    // short higher strike put + long lower strike put
    const longLegs = legs.filter(l => !isShortIntent(l.canonicalIntent) && l.optionType === "put");
    const shortLegs = legs.filter(l => isShortIntent(l.canonicalIntent) && l.optionType === "put");
    if (longLegs.length && shortLegs.length) {
      const longStrike = longLegs[0].strike;
      const shortStrike = shortLegs[0].strike;
      if (shortStrike <= longStrike) {
        findings.push(blocker(
          FR_INVALID_STRIKE_ORDER, "STRUCTURE",
          "Invalid Strike Order",
          `Bull put spread: short strike ($${shortStrike}) must be above long strike ($${longStrike}).`
        ));
      }
    }
  }

  if (strategyFamily === "bear_call_spread") {
    // short lower strike call + long higher strike call
    const longLegs = legs.filter(l => !isShortIntent(l.canonicalIntent) && l.optionType === "call");
    const shortLegs = legs.filter(l => isShortIntent(l.canonicalIntent) && l.optionType === "call");
    if (longLegs.length && shortLegs.length) {
      const longStrike = longLegs[0].strike;
      const shortStrike = shortLegs[0].strike;
      if (shortStrike >= longStrike) {
        findings.push(blocker(
          FR_INVALID_STRIKE_ORDER, "STRUCTURE",
          "Invalid Strike Order",
          `Bear call spread: short strike ($${shortStrike}) must be below long strike ($${longStrike}).`
        ));
      }
    }
  }

  // Calendar spread: same strike, different expirations
  if (strategyFamily === "calendar_spread") {
    const expirations = Array.from(new Set(legs.map(l => l.expiration)));
    if (expirations.length < 2) {
      findings.push(blocker(
        FR_INVALID_EXPIRATION_STRUCTURE, "STRUCTURE",
        "Calendar Spread Expiration",
        "Calendar spread requires legs with different expiration dates."
      ));
    }
  }

  // Diagonal spread: different strikes and different expirations
  if (strategyFamily === "diagonal_spread") {
    const expirations = Array.from(new Set(legs.map(l => l.expiration)));
    if (expirations.length < 2) {
      findings.push(blocker(
        FR_INVALID_EXPIRATION_STRUCTURE, "STRUCTURE",
        "Diagonal Spread Expiration",
        "Diagonal spread requires legs with different expiration dates."
      ));
    }
  }

  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY F: ASSIGNMENT / EXERCISE RISK
// ─────────────────────────────────────────────────────────────────────────────

function evaluateAssignmentRisk(preview: OptionsOrderPreview): ExecutionReadinessFinding[] {
  const findings: ExecutionReadinessFinding[] = [];

  for (const leg of preview.legs) {
    if (isShortIntent(leg.canonicalIntent)) {
      findings.push(warning(
        FR_SHORT_OPTION_ASSIGNMENT_RISK, "RISK",
        `Assignment Risk — Leg ${leg.legIndex + 1}`,
        `Short ${leg.optionType} position (${leg.contractSymbol}) can be assigned at any time ` +
        `before expiration (American-style). Assignment requires fulfilling the contract obligation.`,
        { legIndex: leg.legIndex }
      ));

      // Early exercise note for short calls (especially if near dividend)
      if (leg.optionType === "call") {
        findings.push(warning(
          FR_EARLY_EXERCISE_RISK, "RISK",
          `Early Exercise Risk — Leg ${leg.legIndex + 1}`,
          `Short call contracts may be subject to early exercise, particularly before ex-dividend dates.`,
          { legIndex: leg.legIndex }
        ));
      }
    }
  }

  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY G: EXPIRATION
// ─────────────────────────────────────────────────────────────────────────────

function evaluateExpiration(
  preview: OptionsOrderPreview,
  config: ExecutionGuardrailConfig
): ExecutionReadinessFinding[] {
  const findings: ExecutionReadinessFinding[] = [];

  for (const leg of preview.legs) {
    // Already expired
    if (leg.isExpired || leg.dte < 0) {
      findings.push(blocker(
        FR_OPTION_EXPIRED, "EXPIRATION",
        `Contract Expired — Leg ${leg.legIndex + 1}`,
        `${leg.contractSymbol} expired on ${leg.expiration}. ` +
        `This contract cannot be traded. Return to Contract Research.`,
        { legIndex: leg.legIndex }
      ));
      continue;
    }

    // 0 DTE
    if (leg.dte === 0 && config.zeroDteWarning) {
      findings.push(warning(
        FR_ZERO_DTE, "EXPIRATION",
        `Same-Day Expiration (0 DTE) — Leg ${leg.legIndex + 1}`,
        `${leg.contractSymbol} expires today. ` +
        `0-DTE options carry extreme time-decay and gamma risk.`,
        { legIndex: leg.legIndex }
      ));
    } else if (leg.dte > 0 && leg.dte <= config.nearExpirationDays) {
      findings.push(warning(
        FR_NEAR_EXPIRATION, "EXPIRATION",
        `Near Expiration — Leg ${leg.legIndex + 1}`,
        `${leg.contractSymbol} expires in ${leg.dte} day(s) (${leg.expiration}). ` +
        `Near-expiration options have elevated gamma and time-decay risk.`,
        { legIndex: leg.legIndex }
      ));
    }
  }

  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY H: LIQUIDITY
// ─────────────────────────────────────────────────────────────────────────────

function evaluateLiquidity(
  preview: OptionsOrderPreview,
  config: ExecutionGuardrailConfig
): ExecutionReadinessFinding[] {
  const findings: ExecutionReadinessFinding[] = [];

  for (const leg of preview.legs) {
    const q = leg.currentQuote;
    if (!q) continue;

    const spreadPct = q.spreadPct;
    if (spreadPct !== null) {
      if (spreadPct > config.wideBidAskSevereWarningPct) {
        findings.push(warning(
          FR_SEVERE_WIDE_SPREAD, "LIQUIDITY",
          `Very Wide Bid/Ask — Leg ${leg.legIndex + 1}`,
          `${leg.contractSymbol} bid/ask spread is ${spreadPct.toFixed(1)}% of midpoint ` +
          `(threshold: ${config.wideBidAskSevereWarningPct}%). ` +
          `Execution cost may be significant.`,
          { legIndex: leg.legIndex }
        ));
      } else if (spreadPct > config.wideBidAskWarningPct) {
        findings.push(warning(
          FR_WIDE_BID_ASK_SPREAD, "LIQUIDITY",
          `Wide Bid/Ask — Leg ${leg.legIndex + 1}`,
          `${leg.contractSymbol} bid/ask spread is ${spreadPct.toFixed(1)}% of midpoint ` +
          `(threshold: ${config.wideBidAskWarningPct}%). ` +
          `Execution near midpoint may be difficult.`,
          { legIndex: leg.legIndex }
        ));
      }
    }

    // Open interest
    const oi = leg.liquidity?.openInterest;
    if (oi !== null && oi !== undefined && oi < config.lowOpenInterestThreshold) {
      findings.push(warning(
        FR_LOW_OPEN_INTEREST, "LIQUIDITY",
        `Low Open Interest — Leg ${leg.legIndex + 1}`,
        `${leg.contractSymbol} has ${oi} open interest contracts. ` +
        `Low open interest may indicate thin liquidity and wide fills.`,
        { legIndex: leg.legIndex }
      ));
    }

    // Volume
    const vol = leg.liquidity?.volume;
    if (vol !== null && vol !== undefined && vol < config.lowVolumeThreshold) {
      findings.push(warning(
        FR_LOW_VOLUME, "LIQUIDITY",
        `Low Volume — Leg ${leg.legIndex + 1}`,
        `${leg.contractSymbol} has ${vol} contracts traded today. ` +
        `Low volume may indicate difficulty filling at expected prices.`,
        { legIndex: leg.legIndex }
      ));
    }
  }

  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY I: PRICING SANITY
// ─────────────────────────────────────────────────────────────────────────────

function evaluatePricing(preview: OptionsOrderPreview): ExecutionReadinessFinding[] {
  const findings: ExecutionReadinessFinding[] = [];
  const pricing = preview.netStructurePricing;

  if (!pricing.allQuotesAvailable || pricing.amountPerUnit === null) {
    findings.push(warning(
      FR_PRICING_UNAVAILABLE, "PRICING",
      "Net Pricing Unavailable",
      "Net debit/credit cannot be calculated because not all leg quotes are available. " +
      "Refresh preview to obtain current quotes."
    ));
    return findings;
  }

  // amount must be non-negative (amount is always positive per sign convention)
  if (pricing.amountPerUnit < 0) {
    findings.push(blocker(
      FR_INVALID_NET_PRICE, "PRICING",
      "Invalid Net Price",
      `Net structure price is negative ($${pricing.amountPerUnit.toFixed(4)}). ` +
      `This indicates a data or order-construction error. Return to Order Preparation.`
    ));
  }

  // Direction consistency: DEBIT strategies should be priced as debit
  const DEBIT_FAMILIES = [
    "long_call", "long_put", "protective_put",
    "bull_call_spread", "bear_put_spread",
    "long_straddle", "long_strangle",
    "calendar_spread", "diagonal_spread",
  ];
  const CREDIT_FAMILIES = [
    "covered_call", "cash_secured_put",
    "bull_put_spread", "bear_call_spread",
    "iron_condor", "iron_butterfly",
  ];

  const family = preview.strategyFamily as string;
  if (DEBIT_FAMILIES.includes(family) && pricing.pricingType === "CREDIT" && pricing.amountPerUnit > 0.01) {
    findings.push(warning(
      FR_PRICING_DIRECTION_MISMATCH, "PRICING",
      "Pricing Direction Mismatch",
      `${family} is a debit strategy but structure shows a net credit of $${pricing.amountPerUnit.toFixed(4)}. ` +
      `Verify leg quotes are current and order construction is correct.`
    ));
  }

  if (CREDIT_FAMILIES.includes(family) && pricing.pricingType === "DEBIT" && pricing.amountPerUnit > 0.01) {
    findings.push(warning(
      FR_PRICING_DIRECTION_MISMATCH, "PRICING",
      "Pricing Direction Mismatch",
      `${family} is typically a credit strategy but structure shows a net debit of $${pricing.amountPerUnit.toFixed(4)}. ` +
      `Verify leg quotes are current and order construction is correct.`
    ));
  }

  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS AGGREGATION
// ─────────────────────────────────────────────────────────────────────────────

function aggregateStatus(findings: ExecutionReadinessFinding[]): import("../../shared/execution-readiness-types").ExecutionReadinessStatus {
  if (findings.some(f => f.severity === "BLOCKER")) return "BLOCKED";
  if (findings.some(f => f.severity === "WARNING")) return "READY_WITH_WARNINGS";
  return "READY";
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EVALUATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluates execution readiness for an options order.
 *
 * DETERMINISTIC — no LLM, no randomness.
 * The AI assistant may explain findings but may NEVER change the status.
 * brokerSubmissionEnabled is always false.
 */
export function evaluateExecutionReadiness(
  input: ExecutionReadinessInput
): ExecutionReadinessResult {
  const now = input.now ?? new Date();
  const config: ExecutionGuardrailConfig = {
    ...DEFAULT_EXECUTION_GUARDRAIL_CONFIG,
    ...(input.config ?? {}),
  };
  const { preview, positions, brokerCapabilities } = input;
  const strategyFamily = preview.strategyFamily as string;

  const allFindings: ExecutionReadinessFinding[] = [];

  // A. Market Data
  allFindings.push(...evaluateMarketData(preview, config));

  // B. Account
  allFindings.push(...evaluateAccount(preview, brokerCapabilities));

  // C. Position
  allFindings.push(...evaluatePosition(preview, positions, strategyFamily));

  // D. Capital
  const { findings: capitalFindings, capitalEstimate } = evaluateCapital(preview, brokerCapabilities, strategyFamily);
  allFindings.push(...capitalFindings);

  // E. Structure
  allFindings.push(...evaluateStructure(preview, strategyFamily));

  // F. Assignment / Exercise Risk
  allFindings.push(...evaluateAssignmentRisk(preview));

  // G. Expiration
  allFindings.push(...evaluateExpiration(preview, config));

  // H. Liquidity
  allFindings.push(...evaluateLiquidity(preview, config));

  // I. Pricing
  allFindings.push(...evaluatePricing(preview));

  const status = aggregateStatus(allFindings);
  const blockerCount = allFindings.filter(f => f.severity === "BLOCKER").length;
  const warningCount = allFindings.filter(f => f.severity === "WARNING").length;
  const infoCount = allFindings.filter(f => f.severity === "INFO").length;

  return {
    engineVersion: "2.8.4",
    ruleEngineVersion: "2.8.4",
    id: randomUUID(),
    status,
    statusLabel: EXECUTION_READINESS_STATUS_LABELS[status],
    statusDescription: EXECUTION_READINESS_STATUS_DESCRIPTIONS[status],
    findings: allFindings,
    blockerCount,
    warningCount,
    infoCount,
    capitalEstimate,
    evaluatedAt: now.toISOString(),
    tradePlanId: input.tradePlanId,
    orderDraftId: input.orderDraftId,
    orderPreviewId: input.orderPreviewId,
    brokerSubmissionEnabled: false,
    disclaimer: EXECUTION_READINESS_DISCLAIMER,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY HEALTH METRICS
// ─────────────────────────────────────────────────────────────────────────────

interface ReadinessHealthMetrics {
  evaluations: number;
  readyCount: number;
  readyWithWarningsCount: number;
  blockedCount: number;
  lastEvaluationAt: string | null;
  averageLatencyMs: number;
  totalLatencyMs: number;
}

const _metrics: ReadinessHealthMetrics = {
  evaluations: 0,
  readyCount: 0,
  readyWithWarningsCount: 0,
  blockedCount: 0,
  lastEvaluationAt: null,
  averageLatencyMs: 0,
  totalLatencyMs: 0,
};

export function recordReadinessMetric(status: string, latencyMs: number): void {
  _metrics.evaluations++;
  if (status === "READY") _metrics.readyCount++;
  else if (status === "READY_WITH_WARNINGS") _metrics.readyWithWarningsCount++;
  else if (status === "BLOCKED") _metrics.blockedCount++;
  _metrics.totalLatencyMs += latencyMs;
  _metrics.averageLatencyMs = _metrics.totalLatencyMs / _metrics.evaluations;
  _metrics.lastEvaluationAt = new Date().toISOString();
}

export function getReadinessHealthMetrics(): ReadinessHealthMetrics & { brokerSubmissionEnabled: false } {
  return { ..._metrics, brokerSubmissionEnabled: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// DB TABLE SETUP (no new table — reuses executionAuditEvents for audit)
// Persists to execution_readiness_results table.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ensures the execution_readiness_results table exists.
 * Uses raw SQL for minimal schema change.
 */
export async function ensureExecutionReadinessTables(): Promise<void> {
  try {
    const { pool } = await import("../db");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS execution_readiness_results (
        id VARCHAR PRIMARY KEY,
        user_id VARCHAR NOT NULL,
        trade_plan_id VARCHAR NOT NULL,
        order_draft_id VARCHAR,
        order_preview_id VARCHAR,
        provider VARCHAR,
        account_ref_masked VARCHAR,
        status VARCHAR NOT NULL,
        findings JSONB NOT NULL DEFAULT '[]',
        capital_estimate JSONB,
        blocker_count INTEGER NOT NULL DEFAULT 0,
        warning_count INTEGER NOT NULL DEFAULT 0,
        evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        pricing_snapshot JSONB NOT NULL DEFAULT '{}',
        rule_engine_version VARCHAR NOT NULL DEFAULT '2.8.4',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_err_trade_plan_id ON execution_readiness_results(trade_plan_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_err_user_id ON execution_readiness_results(user_id, created_at DESC);
    `);
  } catch (e: any) {
    console.error("[execution-readiness] table init failed:", e?.message);
  }
}

/**
 * Persist a readiness result to the DB.
 * Does NOT persist: raw account balances, full position lists, broker tokens.
 */
export async function persistReadinessResult(
  result: ExecutionReadinessResult,
  userId: string,
  provider?: string,
  accountRefMasked?: string
): Promise<void> {
  try {
    const { pool } = await import("../db");
    await pool.query(
      `INSERT INTO execution_readiness_results
         (id, user_id, trade_plan_id, order_draft_id, order_preview_id,
          provider, account_ref_masked, status, findings, capital_estimate,
          blocker_count, warning_count, evaluated_at, pricing_snapshot, rule_engine_version, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
       ON CONFLICT (id) DO NOTHING`,
      [
        result.id,
        userId,
        result.tradePlanId,
        result.orderDraftId,
        result.orderPreviewId,
        provider ?? null,
        accountRefMasked ?? null,
        result.status,
        JSON.stringify(result.findings),
        result.capitalEstimate ? JSON.stringify(result.capitalEstimate) : null,
        result.blockerCount,
        result.warningCount,
        result.evaluatedAt,
        JSON.stringify({ pricingType: "midpoint_estimate", methodologyVersion: "2.8.4" }),
        "2.8.4",
      ]
    );
  } catch (e: any) {
    console.error("[execution-readiness] persist failed:", e?.message);
  }
}

/**
 * Load the latest readiness result for a trade plan.
 */
export async function getLatestReadinessResult(
  tradePlanId: string,
  userId: string
): Promise<ExecutionReadinessResult | null> {
  try {
    const { pool } = await import("../db");
    const res = await pool.query(
      `SELECT * FROM execution_readiness_results
       WHERE trade_plan_id = $1 AND user_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [tradePlanId, userId]
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      engineVersion: "2.8.4",
      ruleEngineVersion: "2.8.4",
      id: row.id,
      status: row.status,
      statusLabel: EXECUTION_READINESS_STATUS_LABELS[row.status as import("../../shared/execution-readiness-types").ExecutionReadinessStatus] ?? row.status,
      statusDescription: EXECUTION_READINESS_STATUS_DESCRIPTIONS[row.status as import("../../shared/execution-readiness-types").ExecutionReadinessStatus] ?? "",
      findings: row.findings ?? [],
      blockerCount: row.blocker_count ?? 0,
      warningCount: row.warning_count ?? 0,
      infoCount: (row.findings ?? []).filter((f: any) => f.severity === "INFO").length,
      capitalEstimate: row.capital_estimate ?? null,
      evaluatedAt: row.evaluated_at instanceof Date ? row.evaluated_at.toISOString() : String(row.evaluated_at),
      tradePlanId: row.trade_plan_id,
      orderDraftId: row.order_draft_id ?? null,
      orderPreviewId: row.order_preview_id ?? null,
      brokerSubmissionEnabled: false,
      disclaimer: EXECUTION_READINESS_DISCLAIMER,
    };
  } catch {
    return null;
  }
}
