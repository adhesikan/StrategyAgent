// Bar validation rules (Phase 11). Every bar must pass before storage or
// publication. Invalid bars are rejected and logged; they never replace a
// previously valid bar or feed analysis snapshots.

import type { NormalizedDailyBar } from "./types";

export type BarValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

export function validateBar(
  bar: NormalizedDailyBar,
  opts: { requestedSymbol: string; previousClose?: number | null; today?: string } = { requestedSymbol: bar.symbol },
): BarValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (bar.symbol.toUpperCase() !== opts.requestedSymbol.toUpperCase()) {
    errors.push(`symbol mismatch: got ${bar.symbol}, requested ${opts.requestedSymbol}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bar.tradeDate) || Number.isNaN(Date.parse(bar.tradeDate))) {
    errors.push(`invalid trade date: ${bar.tradeDate}`);
  } else {
    const today = opts.today ?? new Date().toISOString().slice(0, 10);
    if (bar.tradeDate > today) errors.push(`trade date in the future: ${bar.tradeDate}`);
  }

  const nums: Array<[string, number]> = [
    ["open", bar.open],
    ["high", bar.high],
    ["low", bar.low],
    ["close", bar.close],
  ];
  for (const [name, v] of nums) {
    if (!Number.isFinite(v)) errors.push(`${name} is not finite`);
    else if (v <= 0) errors.push(`${name} must be > 0`);
  }
  if (!Number.isFinite(bar.volume) || bar.volume < 0) errors.push("volume must be >= 0");

  if (errors.length === 0) {
    if (bar.high < bar.open) errors.push("high < open");
    if (bar.high < bar.close) errors.push("high < close");
    if (bar.high < bar.low) errors.push("high < low");
    if (bar.low > bar.open) errors.push("low > open");
    if (bar.low > bar.close) errors.push("low > close");
  }

  // Flag potential split: > 40% overnight gap versus previous close.
  if (errors.length === 0 && opts.previousClose && opts.previousClose > 0) {
    const jump = Math.abs(bar.close - opts.previousClose) / opts.previousClose;
    if (jump > 0.4) warnings.push(`large price jump ${(jump * 100).toFixed(1)}% — possible split/correction`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** Flag missing expected US sessions (weekdays) between consecutive stored dates. */
export function findMissingSessions(sortedDates: string[]): string[] {
  const missing: string[] = [];
  for (let i = 1; i < sortedDates.length; i++) {
    const prev = new Date(sortedDates[i - 1] + "T00:00:00Z");
    const curr = new Date(sortedDates[i] + "T00:00:00Z");
    const d = new Date(prev);
    d.setUTCDate(d.getUTCDate() + 1);
    while (d < curr) {
      const dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6) missing.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }
  }
  return missing;
}
