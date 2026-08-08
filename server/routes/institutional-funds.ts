// Institutional Fund Explorer routes — Sprint 2.3.2
//
// Endpoints:
//   GET /api/institutional/funds                            — fund directory
//   GET /api/institutional/funds/:managerId                 — fund detail
//   GET /api/institutional/funds/:managerId/holdings        — paginated holdings
//   GET /api/institutional/funds/:managerId/history         — quarterly history
//   GET /api/institutional/symbols/:symbol/holders          — symbol → fund cross-link
//
// managerId = filerCik (10-digit zero-padded CIK string).
// All routes require authentication.
// No recommendation or conviction language anywhere in this file.

import type { Express, RequestHandler } from "express";
import {
  getFundDirectory,
  getFundDetail,
  getFundHoldings,
  getFundHistory,
  getSymbolHolders,
  isValidManagerId,
  normalizeManagerId,
  type FundSortOption,
} from "../services/institutional/fund-service";

const SYMBOL_RE   = /^[A-Z]{1,10}$/;
const MANAGER_RE  = /^\d{1,10}$/;

const VALID_SORTS = new Set<FundSortOption>([
  "reportedPortfolioValue",
  "positionCount",
  "newPositions",
  "largestChanges",
  "managerName",
]);

const VALID_HOLDING_SORTS = new Set(["value", "weight", "change", "ticker"]);

function parsePageParam(raw: unknown, defaultVal: number, max: number): number {
  const n = parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) return defaultVal;
  return Math.min(n, max);
}

function safeString(v: unknown, maxLen = 200): string {
  return String(v ?? "").slice(0, maxLen).trim();
}

export function registerInstitutionalFundsRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
): void {

  // ── 1. Fund directory ─────────────────────────────────────────────────────
  app.get("/api/institutional/funds", isAuthenticated, async (req, res) => {
    try {
      const search   = safeString(req.query.search);
      const rawSort  = safeString(req.query.sort);
      const sort: FundSortOption = VALID_SORTS.has(rawSort as FundSortOption)
        ? (rawSort as FundSortOption)
        : "reportedPortfolioValue";
      const page     = parsePageParam(req.query.page, 1, 500);
      const pageSize = parsePageParam(req.query.pageSize, 25, 100);

      const result = await getFundDirectory({ search, sort, page, pageSize });
      return res.json(result);
    } catch (err: any) {
      process.stderr.write(JSON.stringify({
        event: "institutional_funds_directory_error",
        error: String(err?.message ?? err).slice(0, 300),
      }) + "\n");
      return res.status(500).json({ error: "Failed to load fund directory" });
    }
  });

  // ── 2. Fund detail ────────────────────────────────────────────────────────
  app.get("/api/institutional/funds/:managerId", isAuthenticated, async (req, res) => {
    const rawId = safeString(req.params.managerId);
    if (!MANAGER_RE.test(rawId)) {
      return res.status(400).json({ error: "Invalid manager ID" });
    }
    const managerId = normalizeManagerId(rawId);

    try {
      const detail = await getFundDetail(managerId);
      if (!detail) {
        return res.status(404).json({ error: "Manager not found or no effective filings" });
      }
      return res.json(detail);
    } catch (err: any) {
      process.stderr.write(JSON.stringify({
        event: "institutional_fund_detail_error",
        managerId,
        error: String(err?.message ?? err).slice(0, 300),
      }) + "\n");
      return res.status(500).json({ error: "Failed to load fund detail" });
    }
  });

  // ── 3. Fund holdings ──────────────────────────────────────────────────────
  app.get(
    "/api/institutional/funds/:managerId/holdings",
    isAuthenticated,
    async (req, res) => {
      const rawId = safeString(req.params.managerId);
      if (!MANAGER_RE.test(rawId)) {
        return res.status(400).json({ error: "Invalid manager ID" });
      }
      const managerId = normalizeManagerId(rawId);

      const quarter  = safeString(req.query.quarter, 20) || undefined;
      const search   = safeString(req.query.search);
      const rawSort  = safeString(req.query.sort);
      const hSort    = VALID_HOLDING_SORTS.has(rawSort) ? rawSort as "value" | "weight" | "change" | "ticker" : "value";
      const page     = parsePageParam(req.query.page, 1, 500);
      const pageSize = parsePageParam(req.query.pageSize, 25, 100);

      try {
        const result = await getFundHoldings(managerId, { quarter, search, sort: hSort, page, pageSize });
        if (!result) {
          return res.status(404).json({ error: "No holdings found for this manager and quarter" });
        }
        return res.json(result);
      } catch (err: any) {
        process.stderr.write(JSON.stringify({
          event: "institutional_fund_holdings_error",
          managerId,
          error: String(err?.message ?? err).slice(0, 300),
        }) + "\n");
        return res.status(500).json({ error: "Failed to load holdings" });
      }
    },
  );

  // ── 4. Fund history ───────────────────────────────────────────────────────
  app.get(
    "/api/institutional/funds/:managerId/history",
    isAuthenticated,
    async (req, res) => {
      const rawId = safeString(req.params.managerId);
      if (!MANAGER_RE.test(rawId)) {
        return res.status(400).json({ error: "Invalid manager ID" });
      }
      const managerId = normalizeManagerId(rawId);

      try {
        const history = await getFundHistory(managerId);
        return res.json({ managerId, history });
      } catch (err: any) {
        process.stderr.write(JSON.stringify({
          event: "institutional_fund_history_error",
          managerId,
          error: String(err?.message ?? err).slice(0, 300),
        }) + "\n");
        return res.status(500).json({ error: "Failed to load fund history" });
      }
    },
  );

  // ── 5. Symbol → holders ───────────────────────────────────────────────────
  app.get(
    "/api/institutional/symbols/:symbol/holders",
    isAuthenticated,
    async (req, res) => {
      const raw = safeString(req.params.symbol, 10).toUpperCase();
      if (!SYMBOL_RE.test(raw)) {
        return res.status(400).json({ error: "Invalid symbol" });
      }

      try {
        const report = await getSymbolHolders(raw);
        return res.json(report);
      } catch (err: any) {
        process.stderr.write(JSON.stringify({
          event: "institutional_symbol_holders_error",
          symbol: raw,
          error: String(err?.message ?? err).slice(0, 300),
        }) + "\n");
        return res.status(500).json({ error: "Failed to load symbol holder data" });
      }
    },
  );
}
