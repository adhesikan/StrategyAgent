// Pure helpers for Position Protection (user-directed exit rules).
//
// These functions compute absolute trigger prices, maintain the trailing-stop
// high/low water mark, and decide whether a user-defined trigger has been hit.
// They are intentionally side-effect free so they can be unit-reasoned about
// and reused by both the monitoring worker and the API layer.

export type PositionSide = "long" | "short";
export type ValueMode = "price" | "percent" | "dollar";
export type TrailMode = "percent" | "dollar";
export type TriggerReason = "stop" | "target" | "trail";

export interface ProtectionParams {
  positionSide: PositionSide;
  entryPrice?: number | null;

  stopEnabled?: boolean | null;
  stopMode?: string | null;
  stopValue?: number | null;
  stopPrice?: number | null;

  targetEnabled?: boolean | null;
  targetMode?: string | null;
  targetValue?: number | null;
  targetPrice?: number | null;

  trailEnabled?: boolean | null;
  trailMode?: string | null;
  trailValue?: number | null;
  highWaterMark?: number | null;
  trailStopPrice?: number | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Resolve a hard stop-loss to an absolute price.
 * - "price": value is already the absolute stop price.
 * - "percent": value is a percentage below (long) / above (short) the reference.
 * - "dollar": value is a dollar amount below (long) / above (short) the reference.
 */
export function computeStopPrice(
  side: PositionSide,
  mode: ValueMode,
  value: number,
  referencePrice: number,
): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (mode === "price") return round2(value);
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) return null;

  if (side === "long") {
    if (mode === "percent") return round2(referencePrice * (1 - value / 100));
    return round2(referencePrice - value); // dollar
  }
  // short
  if (mode === "percent") return round2(referencePrice * (1 + value / 100));
  return round2(referencePrice + value); // dollar
}

/**
 * Resolve a take-profit target to an absolute price.
 */
export function computeTargetPrice(
  side: PositionSide,
  mode: ValueMode,
  value: number,
  referencePrice: number,
): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (mode === "price") return round2(value);
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) return null;

  if (side === "long") {
    if (mode === "percent") return round2(referencePrice * (1 + value / 100));
    return round2(referencePrice + value); // dollar
  }
  // short
  if (mode === "percent") return round2(referencePrice * (1 - value / 100));
  return round2(referencePrice - value); // dollar
}

/**
 * Trailing stop relative to the favorable water mark.
 * For a long position the water mark is the highest price seen; the trailing
 * stop sits below it. For a short position it is the lowest price seen; the
 * trailing stop sits above it.
 */
export function computeTrailStop(
  side: PositionSide,
  mode: TrailMode,
  value: number,
  waterMark: number,
): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (!Number.isFinite(waterMark) || waterMark <= 0) return null;

  if (side === "long") {
    if (mode === "percent") return round2(waterMark * (1 - value / 100));
    return round2(waterMark - value); // dollar
  }
  // short
  if (mode === "percent") return round2(waterMark * (1 + value / 100));
  return round2(waterMark + value); // dollar
}

export interface TrailUpdate {
  highWaterMark: number;
  trailStopPrice: number | null;
  adjusted: boolean;
}

/**
 * Advance the trailing stop given a new price observation. The trailing stop
 * only ever moves in the favorable direction (up for long, down for short);
 * it never loosens.
 */
export function updateTrail(
  params: ProtectionParams,
  price: number,
): TrailUpdate | null {
  if (!params.trailEnabled || !params.trailValue) return null;
  const mode: TrailMode = params.trailMode === "dollar" ? "dollar" : "percent";
  const side = params.positionSide;

  const prevMark = params.highWaterMark ?? params.entryPrice ?? price;
  let newMark = prevMark;
  let adjusted = false;

  if (side === "long") {
    if (price > prevMark) {
      newMark = price;
      adjusted = true;
    }
  } else {
    if (price < prevMark || prevMark <= 0) {
      newMark = price;
      adjusted = true;
    }
  }

  const newStop = computeTrailStop(side, mode, params.trailValue, newMark);

  // The recorded trail stop should never regress.
  let finalStop = newStop;
  if (params.trailStopPrice != null && newStop != null) {
    if (side === "long") {
      finalStop = Math.max(params.trailStopPrice, newStop);
    } else {
      finalStop = Math.min(params.trailStopPrice, newStop);
    }
  }

  return {
    highWaterMark: newMark,
    trailStopPrice: finalStop,
    adjusted: adjusted || params.trailStopPrice !== finalStop,
  };
}

/**
 * Decide whether any user-defined trigger has been hit at the given price.
 * Stop / trailing protection take precedence over the profit target so that a
 * gap that crosses both is treated conservatively as a stop.
 */
export function evaluateTriggers(
  params: ProtectionParams,
  price: number,
  effectiveTrailStop?: number | null,
): TriggerReason | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  const side = params.positionSide;

  const stopHit =
    params.stopEnabled && params.stopPrice != null &&
    (side === "long" ? price <= params.stopPrice : price >= params.stopPrice);

  const trailStop = effectiveTrailStop ?? params.trailStopPrice;
  const trailHit =
    params.trailEnabled && trailStop != null &&
    (side === "long" ? price <= trailStop : price >= trailStop);

  const targetHit =
    params.targetEnabled && params.targetPrice != null &&
    (side === "long" ? price >= params.targetPrice : price <= params.targetPrice);

  if (stopHit) return "stop";
  if (trailHit) return "trail";
  if (targetHit) return "target";
  return null;
}
