// User-controlled handoff: "Prepare in Trade Builder" from a qualified
// opportunity card. Produces a PREFILL for the Trade Builder — never an order.
//
// Flow contract (do not weaken):
//   - Only runs when the USER explicitly clicks the card action.
//   - Output only prefills the Trade Builder; the user must review all
//     fields, edit if desired, explicitly continue (Send to InstaTrade®),
//     and explicitly confirm inside the InstaTrade® ticket.
//   - Nothing here submits an order, and nothing opens the Trade Builder
//     automatically — navigation happens client-side on the user's click.
//
// Data policy: the deterministic base ticket is built ONLY from the card the
// user clicked (values the client already displays). When the MCP
// prepare_trade_ticket tool is reachable, its output is scrubbed and may
// refine numeric fields — but we never invent premiums and we never let the
// MCP output add legs that were not on the card.

import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { isMcpEnabled } from "../mcp/config";
import { prepareTradeTicket } from "../mcp/tools";
import { scrubUntrusted } from "./opportunity-search-mcp";

const legSchema = z.object({
  action: z.enum(["buy", "sell"]),
  type: z.enum(["call", "put"]),
  strike: z.number().positive(),
  expiration: z.string().min(4).max(20).optional(),
  optionSymbol: z.string().max(30).optional(),
  mid: z.number().positive().optional(),
});

export const prepareTicketBodySchema = z.object({
  symbol: z.string().trim().min(1).max(10),
  assetType: z.enum(["stock", "option"]),
  strategy: z.string().max(60).optional(),
  entryPrice: z.number().positive().optional(),
  stopPrice: z.number().positive().optional(),
  targetPrice: z.number().positive().optional(),
  quantity: z.number().int().positive().max(10_000).optional(),
  maxRiskDollars: z.number().positive().optional(),
  netKind: z.enum(["debit", "credit"]).optional(),
  estimatedNet: z.number().optional(),
  maxLoss: z.number().nullable().optional(),
  maxProfit: z.number().nullable().optional(),
  breakeven: z.array(z.number()).max(4).nullable().optional(),
  expiration: z.string().min(4).max(20).optional(),
  legs: z.array(legSchema).max(6).optional(),
});

export type PrepareTicketBody = z.infer<typeof prepareTicketBodySchema>;

export interface PreparedTicket {
  symbol: string;
  assetType: "stock" | "option";
  strategy?: string;
  quantity: number;
  entryPrice?: number;
  limitPrice?: number;
  stopPrice?: number;
  targetPrice?: number;
  netKind?: "debit" | "credit";
  estimatedNet?: number;
  maxLoss?: number | null;
  maxProfit?: number | null;
  breakeven?: number[] | null;
  expiration?: string;
  legs?: Array<{
    action: "buy" | "sell";
    type: "call" | "put";
    strike: number;
    expiration?: string;
    optionSymbol?: string;
    mid?: number;
  }>;
}

export interface PrepareTicketResult {
  ticket: PreparedTicket;
  source: "mcp" | "card";
  warnings: string[];
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
}

/** Deterministic base ticket built purely from the card the user clicked. */
export function baseTicketFromCard(body: PrepareTicketBody): PreparedTicket {
  const ticket: PreparedTicket = {
    symbol: body.symbol.toUpperCase(),
    assetType: body.assetType,
    strategy: body.strategy,
    quantity: body.quantity ?? (body.assetType === "stock" ? 100 : 1),
  };
  if (body.assetType === "stock") {
    ticket.entryPrice = body.entryPrice;
    ticket.limitPrice = body.entryPrice;
    ticket.stopPrice = body.stopPrice;
    ticket.targetPrice = body.targetPrice;
  } else {
    ticket.legs = body.legs;
    ticket.netKind = body.netKind;
    ticket.estimatedNet = body.estimatedNet;
    ticket.maxProfit = body.maxProfit ?? undefined;
    ticket.breakeven = body.breakeven ?? undefined;
    ticket.expiration = body.expiration;
    // Limit prefill = displayed net (per share). The user confirms/edits it.
    if (typeof body.estimatedNet === "number" && Number.isFinite(body.estimatedNet)) {
      ticket.limitPrice = Math.abs(body.estimatedNet);
    }
  }
  ticket.maxLoss = body.maxLoss ?? undefined;
  return ticket;
}

/**
 * Overlay scrubbed MCP prepare_trade_ticket output onto the base ticket.
 * Only refines numeric fields already meaningful for the asset type; never
 * adds legs and never invents premiums for legs that lack one.
 */
export function overlayMcpTicket(base: PreparedTicket, raw: unknown, warnings: string[]): PreparedTicket {
  if (!raw || typeof raw !== "object") return base;
  const t = ((raw as any).ticket ?? raw) as Record<string, unknown>;
  const out: PreparedTicket = { ...base };
  const qty = t.quantity ?? t.contracts ?? t.shares;
  if (typeof qty === "number" && Number.isFinite(qty) && qty >= 1 && qty <= 10_000) {
    out.quantity = Math.floor(qty);
  }
  const limit = num(t.limitPrice ?? t.limit_price ?? t.limit);
  if (limit) out.limitPrice = limit;
  if (base.assetType === "stock") {
    const stop = num(t.stopPrice ?? t.stop_price ?? t.stop);
    const target = num(t.targetPrice ?? t.target_price ?? t.target);
    if (stop) out.stopPrice = stop;
    if (target) out.targetPrice = target;
    // Sanity: a stop above the target on a long setup is unusable — keep the
    // card values instead of a nonsensical refinement.
    if (out.stopPrice && out.targetPrice && out.stopPrice >= out.targetPrice) {
      out.stopPrice = base.stopPrice;
      out.targetPrice = base.targetPrice;
      warnings.push("Ticket service returned inconsistent stop/target — using the card's values.");
    }
  }
  const rawWarnings = t.warnings;
  if (Array.isArray(rawWarnings)) {
    for (const w of rawWarnings.slice(0, 5)) {
      if (typeof w === "string" && w.length <= 300) warnings.push(w);
    }
  }
  return out;
}

export function registerPrepareTicketRoutes(app: Express, isAuthenticated: RequestHandler): void {
  app.post("/api/trade/prepare-ticket", isAuthenticated, async (req, res) => {
    const parsed = prepareTicketBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid prepare-ticket request" });
    }
    const body = parsed.data;
    const warnings: string[] = [];
    let ticket = baseTicketFromCard(body);
    let source: "mcp" | "card" = "card";

    if (isMcpEnabled()) {
      try {
        const raw = scrubUntrusted(
          await prepareTradeTicket({
            symbol: body.symbol,
            strategy: body.strategy,
            quantity: ticket.quantity,
            entryPrice: body.entryPrice,
            stopPrice: body.stopPrice,
            targetPrice: body.targetPrice,
            maxRiskDollars: body.maxRiskDollars,
            legs: body.legs?.map((l) => ({
              action: l.action,
              type: l.type,
              strike: l.strike,
              ...(l.expiration ? { expiration: l.expiration } : {}),
              ...(typeof l.mid === "number" ? { premium: l.mid } : {}),
            })),
          }),
        );
        ticket = overlayMcpTicket(ticket, raw, warnings);
        source = "mcp";
      } catch {
        warnings.push("Ticket service unavailable — prefill uses the card's displayed values.");
      }
    }

    const result: PrepareTicketResult = { ticket, source, warnings };
    return res.json(result);
  });
}
