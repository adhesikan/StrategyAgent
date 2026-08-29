/**
 * Authenticated application adapters for Institutional Intelligence.
 *
 * These routes are intentionally separate from the external v1 API. They use
 * the existing deterministic domain services, but do not require an external
 * API key because they are served to an already authenticated application
 * session.
 */

import type { Express, RequestHandler } from "express";
import { computeMultibaggerDiscovery, multibaggerDiscoveryRepository } from "../services/multibagger";

const SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

export function registerInstitutionalApplicationRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
): void {
  app.get(
    "/api/institutional/multibagger/:symbol",
    isAuthenticated,
    async (req, res) => {
      const symbol = String(req.params.symbol ?? "").trim().toUpperCase();
      if (!SYMBOL_RE.test(symbol)) {
        return res.status(400).json({ error: "Invalid symbol" });
      }

      try {
        const input = await multibaggerDiscoveryRepository.load(symbol);
        const result = computeMultibaggerDiscovery(input);

        // The application workspace needs the deterministic component and
        // profile evidence, but never needs the input loaders themselves.
        return res.json({
          symbol: result.symbol,
          modelVersion: result.modelVersion,
          overall: result.overall,
          dimensions: result.dimensions,
          institutionalDiscovery: result.institutionalDiscovery,
          runwayScore: result.runwayScore,
          marketCapRunway: result.marketCapRunway,
          optionalUpsideProfiles: result.optionalUpsideProfiles,
          profiles: result.profiles,
          availableDimensionCount: result.availableDimensionCount,
          unavailableDimensionCount: result.unavailableDimensionCount,
          limitations: result.limitations,
          disclaimer: result.disclaimer,
        });
      } catch (error: any) {
        console.error("[institutional-application] Multibagger route error:", error?.message);
        return res.status(500).json({ error: "Unable to retrieve deterministic discovery data" });
      }
    },
  );
}