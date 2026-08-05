// Analysis Cache Routes — Sprint 5.5B
//
// GET /api/analysis/cached?symbol=NVDA
//   → Single-symbol lookup. Returns the cached Ask AI result for the
//     authenticated user + symbol, or { found: false }.
//   → Used by the AskPage to display an existing result without re-running.
//
// GET /api/analysis/cached?symbols=NVDA,AAPL,AMD
//   → Batch lookup. Returns { hits: string[] } — symbols (uppercase) that
//     have a cached result for this user. Used by dashboard cards to choose
//     "Open Analysis" vs "Run Full Analysis" CTA labels.
//   → Never returns result payloads — safe for dashboard-level use.
//
// DELETE /api/analysis/cached?symbol=NVDA
//   → Evict a cached entry (called when the user explicitly refreshes).
//   → Returns { evicted: true }.
//
// Security:
//   - userId from req.session only; never from query/body.
//   - 404 for any unknown symbol (no side-channel info leakage).
//   - Results are only returned to the userId who produced them.

import type { Express, RequestHandler } from "express";
import {
  lookupAnalysisResult,
  batchLookupSymbols,
  evictAnalysisResult,
} from "../services/analysis-result-cache";

const SAFE_SYMBOL_RE = /^[A-Z]{1,5}$/;

function sanitizeSymbol(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5);
  return SAFE_SYMBOL_RE.test(s) ? s : null;
}

export function registerAnalysisCacheRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
): void {
  // -----------------------------------------------------------------------
  // Single-symbol lookup
  // -----------------------------------------------------------------------
  app.get("/api/analysis/cached", isAuthenticated, (req, res) => {
    const userId = (req.session as any)?.userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    // Batch mode: ?symbols=A,B,C
    const rawSymbols = req.query.symbols as string | undefined;
    if (rawSymbols) {
      const syms = rawSymbols
        .split(",")
        .map((s) => sanitizeSymbol(s.trim()))
        .filter((s): s is string => s !== null)
        .slice(0, 20); // cap at 20 symbols
      const hits = batchLookupSymbols(userId, syms);
      return res.json({ hits });
    }

    // Single mode: ?symbol=NVDA
    const rawSym = req.query.symbol as string | undefined;
    const symbol = sanitizeSymbol(rawSym);
    if (!symbol) {
      return res.status(400).json({ error: "symbol required — use ?symbol=NVDA or ?symbols=A,B" });
    }

    const result = lookupAnalysisResult(userId, symbol);
    if (!result.found) {
      return res.status(404).json({ found: false });
    }
    return res.json(result);
  });

  // -----------------------------------------------------------------------
  // Explicit eviction (called when user clicks "Refresh Analysis")
  // -----------------------------------------------------------------------
  app.delete("/api/analysis/cached", isAuthenticated, (req, res) => {
    const userId = (req.session as any)?.userId as string | undefined;
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    const rawSym = req.query.symbol as string | undefined;
    const symbol = sanitizeSymbol(rawSym);
    if (!symbol) {
      return res.status(400).json({ error: "symbol required" });
    }
    evictAnalysisResult(userId, symbol);
    return res.json({ evicted: true });
  });
}
