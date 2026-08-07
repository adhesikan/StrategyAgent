// Institutional Signal Routes — Sprint 2.2.6
//
// GET  /api/institutional/signals/:symbol  — read precomputed signal for a ticker
// POST /api/admin/institutional/signals/rebuild — admin: rebuild signal(s)
//
// Route registration order:
//   These STATIC prefix routes (/signals/*) must be registered BEFORE the
//   dynamic /api/institutional/:symbol route to avoid collision.
//   The caller (server/routes.ts) is responsible for correct ordering.
//
// Security:
//   - isAuthenticated required on read endpoint
//   - isAdmin required on rebuild endpoint
//   - Symbol is validated before any DB access
//   - No raw SEC payload in response
//   - No credentials exposed
//
// 13F Disclaimer:
//   All responses carry freshness.delayed = true and source = "SEC Form 13F"
//   to make clear that holdings data is periodic and delayed by up to 45 days
//   after quarter end.

import type { Express, RequestHandler } from "express";
import { z } from "zod";
import {
  getInstitutionalSignal,
  rebuildInstitutionalSignals,
  rebuildInstitutionalSignalForSymbol,
  signalToEvidence,
  signalToWorkspaceContract,
} from "../services/institutional/signal-engine";

// Reuse the same symbol validation as the existing institutional route
const SYMBOL_RE = /^[A-Z]{1,10}$/;

// Reserved words that must never be treated as ticker symbols
// (mirrors the denylist in routes/institutional.ts)
const RESERVED_SEGMENTS = new Set([
  "signals",
  "mappings",
  "unmapped",
  "mapping-audit",
  "mapping-pipeline",
  "review",
]);

const rebuildBodySchema = z.object({
  symbols: z.array(z.string().min(1).max(10)).optional(),
  limit: z.number().int().min(1).max(10000).optional(),
}).strict();

export function registerInstitutionalSignalRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
  isAdmin: RequestHandler,
): void {
  /**
   * GET /api/institutional/signals/:symbol
   *
   * Returns the precomputed institutional signal for a mapped ticker.
   * Falls back to live computation from quarterly aggregates when the
   * signal has not yet been precomputed.
   *
   * Response shape: InstitutionalSignal
   *   Always includes freshness.delayed = true
   *   Status "unavailable" when no aggregate data exists for the symbol.
   *
   * Also includes convenience contracts:
   *   evidence   — compact InstitutionalEvidence for future consumers
   *   workspace  — compact InstitutionalWorkspaceContract for AI Workspace
   */
  app.get(
    "/api/institutional/signals/:symbol",
    isAuthenticated,
    async (req, res) => {
      try {
        const raw = String(req.params.symbol ?? "").toUpperCase().trim();

        // Belt-and-suspenders: reject reserved path segments
        if (RESERVED_SEGMENTS.has(raw.toLowerCase())) {
          return res.status(400).json({ error: "Invalid symbol" });
        }
        if (!SYMBOL_RE.test(raw)) {
          return res.status(400).json({ error: "Invalid symbol" });
        }

        const signal = await getInstitutionalSignal(raw);
        if (!signal) {
          return res.status(404).json({
            error: "No institutional 13F data available for this symbol.",
            symbol: raw,
            freshness: {
              source: "SEC Form 13F",
              delayed: true,
              periodEndDate: null,
              calculatedAt: null,
            },
          });
        }

        // Attach compact consumer contracts without modifying the canonical signal
        return res.json({
          ...signal,
          evidence: signalToEvidence(signal),
          workspace: signalToWorkspaceContract(signal),
        });
      } catch (err: any) {
        console.error("[institutional-signals] Route error:", err?.message);
        return res.status(500).json({ error: "Unable to retrieve institutional signal" });
      }
    },
  );

  /**
   * POST /api/admin/institutional/signals/rebuild
   *
   * Admin-only. Rebuilds precomputed institutional signals.
   * Idempotent — safe to run multiple times.
   *
   * Body (optional):
   *   { symbols?: string[], limit?: number }
   *
   * When symbols is provided, only those symbols are rebuilt.
   * When limit is provided, at most that many symbols are processed.
   * When neither is provided, all symbols with quarterly aggregate data are rebuilt.
   *
   * Response: { status, rebuilt, failed, durationMs }
   */
  app.post(
    "/api/admin/institutional/signals/rebuild",
    isAuthenticated,
    isAdmin,
    async (req, res) => {
      try {
        const parsed = rebuildBodySchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return res.status(400).json({
            error: "Invalid request body",
            details: parsed.error.flatten().fieldErrors,
          });
        }

        // Validate any explicit symbols
        const rawSymbols = parsed.data.symbols;
        if (rawSymbols) {
          const invalid = rawSymbols.filter((s) => !SYMBOL_RE.test(s.toUpperCase()));
          if (invalid.length > 0) {
            return res.status(400).json({ error: "Invalid symbols", invalid });
          }
        }

        const result = await rebuildInstitutionalSignals({
          symbols: rawSymbols?.map((s) => s.toUpperCase()),
          limit: parsed.data.limit,
        });

        return res.json({ status: "complete", ...result });
      } catch (err: any) {
        console.error("[institutional-signals] Rebuild error:", err?.message);
        return res.status(500).json({
          error: "Internal server error",
          detail: err?.message,
        });
      }
    },
  );

  /**
   * POST /api/admin/institutional/signals/rebuild/:symbol
   *
   * Admin-only. Rebuild signal for a single symbol immediately.
   */
  app.post(
    "/api/admin/institutional/signals/rebuild/:symbol",
    isAuthenticated,
    isAdmin,
    async (req, res) => {
      try {
        const raw = String(req.params.symbol ?? "").toUpperCase().trim();
        if (!SYMBOL_RE.test(raw)) {
          return res.status(400).json({ error: "Invalid symbol" });
        }

        const signal = await rebuildInstitutionalSignalForSymbol(raw);
        return res.json({ status: "complete", symbol: raw, signal });
      } catch (err: any) {
        console.error("[institutional-signals] Single rebuild error:", err?.message);
        return res.status(500).json({ error: "Internal server error", detail: err?.message });
      }
    },
  );
}
