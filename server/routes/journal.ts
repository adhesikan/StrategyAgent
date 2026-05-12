import type { Express, RequestHandler } from "express";
import { db } from "../db";
import { tradeOutcomes, tradeSetupHistory } from "@shared/schema";
import { desc, eq, sql } from "drizzle-orm";
import { getBrokerPositions } from "../broker";

type View = "open" | "closed" | "all";

interface JournalPosition {
  id: string;
  ticker: string;
  name: string;
  strategy: string;
  status: "Open" | "Win" | "Loss";
  pl: number;
  pctOfMax: number | null;
  daysLeft: number | null;
  entryDate?: string;
  exitDate?: string;
}

function isView(v: unknown): v is View {
  return v === "open" || v === "closed" || v === "all";
}

function monthKey(d: Date): string {
  return d.toLocaleString("en-US", { month: "short" });
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

async function loadOpenPositions(userId: string): Promise<JournalPosition[]> {
  const broker = await getBrokerPositions(userId).catch(() => []);
  if (broker.length === 0) return [];

  const symbols = Array.from(new Set(broker.map((p) => p.symbol.toUpperCase())));
  const setups = symbols.length
    ? await db
        .select({
          symbol: tradeSetupHistory.symbol,
          strategyName: tradeSetupHistory.strategyName,
          createdAt: tradeSetupHistory.createdAt,
        })
        .from(tradeSetupHistory)
        .where(
          sql`${tradeSetupHistory.userId} = ${userId} AND upper(${tradeSetupHistory.symbol}) IN (${sql.join(
            symbols.map((s) => sql`${s}`),
            sql`, `,
          )})`,
        )
        .orderBy(desc(tradeSetupHistory.createdAt))
    : [];

  const strategyBySymbol = new Map<string, string>();
  for (const s of setups) {
    const sym = s.symbol.toUpperCase();
    if (!strategyBySymbol.has(sym)) strategyBySymbol.set(sym, s.strategyName);
  }

  return broker.map((p) => ({
    id: `pos:${p.symbol}`,
    ticker: p.symbol.toUpperCase(),
    name: p.symbol.toUpperCase(),
    strategy: strategyBySymbol.get(p.symbol.toUpperCase()) || "Position",
    status: "Open" as const,
    pl: Math.round((p.unrealizedPnl ?? 0) * 100) / 100,
    pctOfMax: null,
    daysLeft: null,
  }));
}

async function loadClosedOutcomes(userId: string, limit?: number): Promise<JournalPosition[]> {
  const base = db
    .select()
    .from(tradeOutcomes)
    .where(eq(tradeOutcomes.userId, userId))
    .orderBy(desc(tradeOutcomes.exitTime));
  const rows = limit != null ? await base.limit(limit) : await base;

  return rows.map((r) => {
    const pl = r.pnl ?? 0;
    const isWin = pl >= 0;
    return {
      id: `out:${r.id}`,
      ticker: r.symbol.toUpperCase(),
      name: r.symbol.toUpperCase(),
      strategy: r.strategy || r.executedInstrumentType || "Closed trade",
      status: isWin ? ("Win" as const) : ("Loss" as const),
      pl: Math.round(pl * 100) / 100,
      pctOfMax: r.pnlPercent != null ? Math.round(r.pnlPercent) : null,
      daysLeft: 0,
      exitDate: r.exitTime ? r.exitTime.toISOString() : undefined,
      entryDate: r.entryTime ? r.entryTime.toISOString() : undefined,
    };
  });
}

function computeInsight(closed: JournalPosition[]): { text: string; type: "neutral" | "positive" | "warning" } {
  if (closed.length < 3) {
    return {
      text: "Once you close a few trades, this card will surface your strongest and weakest strategies automatically.",
      type: "neutral",
    };
  }
  const byStrategy = new Map<string, { wins: number; total: number; pl: number }>();
  for (const c of closed) {
    const k = c.strategy || "Other";
    const cur = byStrategy.get(k) || { wins: 0, total: 0, pl: 0 };
    cur.total += 1;
    cur.pl += c.pl;
    if (c.status === "Win") cur.wins += 1;
    byStrategy.set(k, cur);
  }
  const ranked = Array.from(byStrategy.entries())
    .filter(([, v]) => v.total >= 2)
    .map(([k, v]) => ({ k, rate: v.wins / v.total, pl: v.pl, total: v.total }))
    .sort((a, b) => b.rate - a.rate);
  if (ranked.length === 0) {
    return { text: "Not enough data per strategy yet — keep journaling.", type: "neutral" };
  }
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  if (best.k === worst.k) {
    const pct = Math.round(best.rate * 100);
    return {
      text: `Your ${best.k} trades are winning at ${pct}% over ${best.total} closed.`,
      type: pct >= 50 ? "positive" : "warning",
    };
  }
  const bp = Math.round(best.rate * 100);
  const wp = Math.round(worst.rate * 100);
  return {
    text: `Your ${best.k} trades win ${bp}% — your best strategy. Your ${worst.k} trades only ${wp}%.`,
    type: bp - wp >= 20 ? "positive" : "neutral",
  };
}

function buildMonthly(closed: JournalPosition[]): { month: string; pl: number }[] {
  const now = new Date();
  const buckets: { month: string; key: string; pl: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ month: monthKey(d), key: `${d.getFullYear()}-${d.getMonth()}`, pl: 0 });
  }
  for (const c of closed) {
    if (!c.exitDate) continue;
    const d = startOfMonth(new Date(c.exitDate));
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const b = buckets.find((x) => x.key === key);
    if (b) b.pl += c.pl;
  }
  return buckets.map(({ month, pl }) => ({ month, pl: Math.round(pl) }));
}

async function getClosedCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tradeOutcomes)
    .where(eq(tradeOutcomes.userId, userId));
  return row?.n ?? 0;
}

export function registerJournalRoutes(app: Express, isAuthenticated: RequestHandler): void {
  app.get("/api/journal/positions", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "unauthorized" });
      const view = isView(req.query.view) ? req.query.view : "all";

      // Always resolve global counts so tab badges stay correct even when the
      // current view loads only one side of the data.
      const [open, closed, totalClosedCount] = await Promise.all([
        loadOpenPositions(userId),
        view === "open" ? Promise.resolve([] as JournalPosition[]) : loadClosedOutcomes(userId),
        view === "open" ? getClosedCount(userId) : Promise.resolve(-1),
      ]);

      const positions = view === "open" ? open : view === "closed" ? closed : [...open, ...closed];
      const closedCount = totalClosedCount >= 0 ? totalClosedCount : closed.length;
      res.json({
        positions,
        counts: { open: open.length, closed: closedCount, all: open.length + closedCount },
      });
    } catch (err) {
      console.error("[journal] positions error:", err);
      res.status(500).json({ error: "Failed to load journal positions" });
    }
  });

  app.get("/api/journal/summary", isAuthenticated, async (req, res) => {
    try {
      const userId = (req.session as any)?.userId as string | undefined;
      if (!userId) return res.status(401).json({ error: "unauthorized" });

      const [open, closed] = await Promise.all([
        loadOpenPositions(userId),
        loadClosedOutcomes(userId), // full set so aggregates are accurate
      ]);

      const wins = closed.filter((c) => c.status === "Win");
      const losses = closed.filter((c) => c.status === "Loss");
      const sum = (xs: JournalPosition[]) => xs.reduce((s, p) => s + p.pl, 0);
      const totalPl = sum(closed) + sum(open);
      const winRate = closed.length ? Math.round((wins.length / closed.length) * 100) : 0;
      const avgWin = wins.length ? Math.round(sum(wins) / wins.length) : 0;
      const avgLoss = losses.length ? Math.round(sum(losses) / losses.length) : 0;
      const openPl = Math.round(sum(open));

      res.json({
        hasData: closed.length > 0 || open.length > 0,
        metrics: {
          totalPl: Math.round(totalPl),
          winRate,
          avgWin,
          avgLoss,
          openPl,
          openCount: open.length,
          closedCount: closed.length,
        },
        monthly: buildMonthly(closed),
        insight: computeInsight(closed),
        recentClosed: closed.slice(0, 3).map((c) => ({
          id: c.id,
          ticker: c.ticker,
          strategy: c.strategy,
          pl: c.pl,
        })),
      });
    } catch (err) {
      console.error("[journal] summary error:", err);
      res.status(500).json({ error: "Failed to load journal summary" });
    }
  });
}
