// GET /api/institutional/:symbol — Sprint 2.2.5.
//
// Returns pre-computed 13F institutional intelligence for a symbol.
// No raw SEC payload. No credentials. Holder list bounded.
//
// Authentication: required (isAuthenticated middleware).
// Symbol: normalized to uppercase; invalid symbols return 400.
//
// When INSTITUTIONAL_INTELLIGENCE_ENABLED=false:
//   Returns { status: "unavailable" } — does not expose internal state.

import type { Express, RequestHandler } from "express";
import { getInstitutionalData } from "../services/institutional/institutional-service";

const SYMBOL_RE = /^[A-Z]{1,10}$/;
const MAX_HOLDER_LIMIT = 50;

export function registerInstitutionalRoute(
  app: Express,
  isAuthenticated: RequestHandler,
): void {
  app.get(
    "/api/institutional/:symbol",
    isAuthenticated,
    async (req, res) => {
      try {
        const raw = String(req.params.symbol ?? "").toUpperCase().trim();
        if (!SYMBOL_RE.test(raw)) {
          return res.status(400).json({ error: "Invalid symbol" });
        }

        // Optional holder count limit from query param (bounded)
        const limitParam = parseInt(String(req.query.maxHolders ?? ""), 10);
        const maxHolders =
          Number.isFinite(limitParam) && limitParam >= 1 && limitParam <= MAX_HOLDER_LIMIT
            ? limitParam
            : 20;

        const data = await getInstitutionalData(raw, maxHolders);

        // Log safe event (no credentials, no user data, no raw payload)
        console.log(
          JSON.stringify({
            event:
              data.status === "available" || data.status === "partial"
                ? "institutional_api_served"
                : "institutional_api_unavailable",
            symbol: raw,
            status: data.status,
            managerCount: data.summary?.reportingManagerCount ?? 0,
          }),
        );

        return res.json(data);
      } catch (err: any) {
        // Never expose stack traces, internal state, or raw errors
        console.error("[Institutional] Route error:", err?.message);
        return res.status(500).json({ error: "Unable to retrieve institutional data" });
      }
    },
  );
}
