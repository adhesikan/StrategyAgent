// POST /api/options/resolve-contracts
// GET  /api/options/broker-capability
//
// Live Contract Resolver — Sprint 2.2.2
//
// Security requirements:
//   - Authenticated session required (isAuthenticated middleware).
//   - Uses the requesting user's own broker connection — never another user's.
//   - No tokens, account IDs, or raw broker payloads in any response.
//   - Validates every request field; rejects unknown enum values.
//   - Rate-limited by default (standard Express request path).

import type { Express, RequestHandler } from "express";
import { z } from "zod";
import {
  resolveLiveContracts,
  checkBrokerOptionsCapability,
} from "../services/live-contract-resolver";

// ---------------------------------------------------------------------------
// Request validation schema
// ---------------------------------------------------------------------------

const SYMBOL_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

const strikeGuidanceValues = [
  "near_atm",
  "one_strike_itm",
  "otm_2_5",
  "near_support",
  "near_resistance",
  "near_breakout",
  "near_technical_objective",
  "near_objective",
  "short_strike_near_objective",
  "below_short_put",
] as const;

export const resolveContractsBodySchema = z.object({
  symbol: z
    .string()
    .trim()
    .min(1)
    .max(10)
    .transform((s) => s.toUpperCase())
    .refine((s) => SYMBOL_RE.test(s), { message: "Invalid symbol format" }),
  structure: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .transform((s) => s.toLowerCase()),
  targetDte: z
    .object({
      min: z.number().int().min(1).max(730),
      max: z.number().int().min(1).max(730),
    })
    .refine((d) => d.min <= d.max, { message: "targetDte.min must be ≤ targetDte.max" }),
  strikeGuidance: z.object({
    longLeg: z.enum(strikeGuidanceValues).optional(),
    shortLeg: z.enum(strikeGuidanceValues).optional(),
    singleLeg: z.enum(strikeGuidanceValues).optional(),
  }),
  referenceLevels: z.object({
    underlyingPrice: z.number().positive().max(100_000),
    support: z.number().positive().max(100_000).nullable().optional(),
    resistance: z.number().positive().max(100_000).nullable().optional(),
    breakout: z.number().positive().max(100_000).nullable().optional(),
    objective: z.number().positive().max(100_000).nullable().optional(),
  }),
});

export type ResolveContractsBody = z.infer<typeof resolveContractsBodySchema>;

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerLiveContractResolverRoutes(
  app: Express,
  isAuthenticated: RequestHandler,
): void {
  // ── GET /api/options/broker-capability ─────────────────────────────────
  // Lightweight capability check — no chain data fetched.
  app.get("/api/options/broker-capability", isAuthenticated, async (req, res) => {
    const userId = (req as any).session?.userId;
    if (!userId) return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Session required" } });

    try {
      const cap = await checkBrokerOptionsCapability(userId);
      return res.json(cap);
    } catch (e) {
      // Safe error — no raw error message to client
      return res.status(502).json({
        error: { code: "BROKER_ERROR", message: "Unable to determine broker capability" },
      });
    }
  });

  // ── POST /api/options/resolve-contracts ────────────────────────────────
  // Full contract resolution against the live options chain.
  app.post("/api/options/resolve-contracts", isAuthenticated, async (req, res) => {
    const userId = (req as any).session?.userId;
    if (!userId) return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Session required" } });

    // Validate and normalize request
    const parsed = resolveContractsBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: "Request validation failed",
          details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      });
    }

    try {
      const result = await resolveLiveContracts(userId, parsed.data);
      return res.json(result);
    } catch (e) {
      // Safe error — never include raw provider errors or tokens
      const safeMsg = "Contract resolution encountered an unexpected error. Please try again.";
      console.error("[LiveContractResolver] Unhandled error (userId redacted):", (e as Error)?.message?.substring(0, 100));
      return res.status(500).json({
        error: { code: "RESOLUTION_ERROR", message: safeMsg },
      });
    }
  });
}
