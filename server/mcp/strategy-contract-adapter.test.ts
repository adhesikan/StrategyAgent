// Contract adapter tests — registry → MCP scan_strategy translation.
// The live MCP contract (verified 2026-08-04): strategies are its slug
// namespace only, timeframes are 5min|15min|1h|1day. Unknown inputs must
// fail LOCALLY and never reach MCP.

import { describe, it, expect } from "vitest";
import {
  toMcpStrategyId,
  toMcpTimeframe,
  MCP_STRATEGY_IDS,
} from "./strategy-contract-adapter";
import { McpError } from "./errors";

describe("toMcpTimeframe", () => {
  it('maps "1d" to "1day"', () => {
    expect(toMcpTimeframe("1d")).toBe("1day");
  });
  it('is idempotent for "1day"', () => {
    expect(toMcpTimeframe("1day")).toBe("1day");
  });
  it("maps intraday timeframes", () => {
    expect(toMcpTimeframe("5m")).toBe("5min");
    expect(toMcpTimeframe("5min")).toBe("5min");
    expect(toMcpTimeframe("15m")).toBe("15min");
    expect(toMcpTimeframe("15min")).toBe("15min");
    expect(toMcpTimeframe("1h")).toBe("1h");
  });
  it("rejects unsupported values locally with UNSUPPORTED_TIMEFRAME", () => {
    for (const bad of ["1w", "1min", "daily", "", "2h"]) {
      try {
        toMcpTimeframe(bad);
        expect.unreachable(`accepted ${bad}`);
      } catch (e) {
        expect(e).toBeInstanceOf(McpError);
        expect((e as McpError).code).toBe("UNSUPPORTED_TIMEFRAME");
      }
    }
  });
});

describe("toMcpStrategyId", () => {
  it("maps all 10 registry IDs to the correct MCP slugs", () => {
    expect(toMcpStrategyId("VCP")).toBe("vcp");
    expect(toMcpStrategyId("VCP_MULTIDAY")).toBe("power_breakout");
    expect(toMcpStrategyId("ORB5")).toBe("open_drive_5m");
    expect(toMcpStrategyId("ORB15")).toBe("open_drive_15m");
    expect(toMcpStrategyId("HIGH_RVOL")).toBe("volume_surge");
    expect(toMcpStrategyId("GAP_AND_GO")).toBe("gap_force");
    expect(toMcpStrategyId("CLASSIC_PULLBACK")).toBe("precision_pullback");
    expect(toMcpStrategyId("TREND_CONTINUATION")).toBe("trend_pilot");
    expect(toMcpStrategyId("VWAP_RECLAIM")).toBe("institutional_reclaim");
    expect(toMcpStrategyId("VOLATILITY_SQUEEZE")).toBe("pressure_break");
  });
  it("accepts MCP slugs idempotently (any case)", () => {
    for (const slug of MCP_STRATEGY_IDS) {
      expect(toMcpStrategyId(slug)).toBe(slug);
    }
    expect(toMcpStrategyId("Momentum_Breakout")).toBe("momentum_breakout");
  });
  it("accepts lowercase registry ids too", () => {
    expect(toMcpStrategyId("vcp_multiday")).toBe("power_breakout");
  });
  it("rejects unknown IDs locally with UNSUPPORTED_STRATEGY_MAPPING", () => {
    try {
      toMcpStrategyId("SOME_NEW_STRATEGY");
      expect.unreachable("accepted unknown strategy");
    } catch (e) {
      expect(e).toBeInstanceOf(McpError);
      expect((e as McpError).code).toBe("UNSUPPORTED_STRATEGY_MAPPING");
      expect((e as McpError).message).toContain("SOME_NEW_STRATEGY");
    }
  });
});
