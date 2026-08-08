// GET /api/opportunities/workspace/:symbol — Sprint 2.3.0
//
// Enrichment endpoint for the Opportunity Research Workspace page.
// Bundles per-symbol history + precomputed institutional signal into
// a single response so the client stays within its 2-call budget.
//
// Call 1 (client): GET /api/opportunities/today         → ranking + scored candidate
// Call 2 (client): GET /api/opportunities/workspace/:symbol → this endpoint
//
// Trust rules:
//   - Authenticated; no broker connection required.
//   - Symbol validated before any DB access.
//   - No raw SEC payload; institutional data comes from precomputed signal.
//   - No stack traces in response.
//   - History capped at 100 rows; no pagination needed for the workspace view.

import type { Express, RequestHandler } from "express";
import { getSymbolHistory } from "../services/opportunity-snapshot-store";
import { getInstitutionalSignal } from "../services/institutional/signal-engine";

const SYMBOL_RE = /^[A-Z]{1,10}$/;

// Shared company name lookup — same set as radar-service.ts COMPANY_NAMES.
// This is a deliberate duplicate so the workspace route has zero coupling to
// the radar service, which has its own internal state.
const COMPANY_NAMES: Record<string, string> = {
  AAPL: "Apple Inc.",
  MSFT: "Microsoft Corporation",
  NVDA: "NVIDIA Corporation",
  AMD: "Advanced Micro Devices",
  TSLA: "Tesla, Inc.",
  META: "Meta Platforms, Inc.",
  AMZN: "Amazon.com, Inc.",
  GOOGL: "Alphabet Inc.",
  MU: "Micron Technology",
  PLTR: "Palantir Technologies",
  SPY: "SPDR S&P 500 ETF",
  QQQ: "Invesco QQQ Trust",
  IWM: "iShares Russell 2000 ETF",
  DIA: "SPDR Dow Jones Industrial",
  INTC: "Intel Corporation",
  BAC: "Bank of America",
  F: "Ford Motor Company",
  AVGO: "Broadcom Inc.",
  GOOG: "Alphabet Inc.",
  NFLX: "Netflix, Inc.",
  CRM: "Salesforce, Inc.",
  ORCL: "Oracle Corporation",
  IBM: "IBM Corporation",
  QCOM: "Qualcomm Incorporated",
  TXN: "Texas Instruments",
  SMCI: "Super Micro Computer",
  ARM: "Arm Holdings",
  SNOW: "Snowflake Inc.",
  PANW: "Palo Alto Networks",
  CRWD: "CrowdStrike Holdings",
  ZS: "Zscaler, Inc.",
  NET: "Cloudflare, Inc.",
  DDOG: "Datadog, Inc.",
  COIN: "Coinbase Global",
  MSTR: "MicroStrategy Inc.",
  CELH: "Celsius Holdings",
  MRVL: "Marvell Technology",
  ON: "ON Semiconductor",
  KLAC: "KLA Corporation",
  AMAT: "Applied Materials",
  LRCX: "Lam Research",
  ASML: "ASML Holding",
};

export function registerOpportunityWorkspaceRoute(
  app: Express,
  isAuthenticated: RequestHandler,
): void {
  app.get(
    "/api/opportunities/workspace/:symbol",
    isAuthenticated,
    async (req, res) => {
      const raw = String(req.params.symbol ?? "").toUpperCase().trim();
      if (!SYMBOL_RE.test(raw)) {
        return res.status(400).json({ error: "Invalid symbol" });
      }

      try {
        // Run both queries in parallel — neither depends on the other.
        const [history, institutional] = await Promise.all([
          getSymbolHistory(raw, 100),
          getInstitutionalSignal(raw).catch(() => null), // non-fatal
        ]);

        return res.json({
          symbol: raw,
          companyName: COMPANY_NAMES[raw] ?? null,
          history,
          institutional,
        });
      } catch (err: any) {
        process.stderr.write(
          JSON.stringify({
            event: "opportunity_workspace_route_error",
            symbol: raw,
            error: String(err?.message ?? err).slice(0, 200),
          }) + "\n",
        );
        return res.status(500).json({ error: "Failed to load workspace data" });
      }
    },
  );
}
