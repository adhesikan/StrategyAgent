import type { FuturesTick, FuturesBar } from "../brokers/futures/types";

interface SymbolSnapshot {
  lastTick: FuturesTick | null;
  lastBar: FuturesBar | null;
  bars: FuturesBar[];
}

const MAX_BARS = 900;
const state = new Map<string, SymbolSnapshot>();

function ensureSymbol(symbol: string): SymbolSnapshot {
  let snap = state.get(symbol);
  if (!snap) {
    snap = { lastTick: null, lastBar: null, bars: [] };
    state.set(symbol, snap);
  }
  return snap;
}

export function upsertTick(tick: FuturesTick): void {
  const snap = ensureSymbol(tick.symbol);
  snap.lastTick = tick;
}

export function upsertBar(bar: FuturesBar): void {
  const snap = ensureSymbol(bar.symbol);
  const existing = snap.bars.findIndex((b) => b.time === bar.time);
  if (existing >= 0) {
    snap.bars[existing] = bar;
  } else {
    snap.bars.push(bar);
    if (snap.bars.length > MAX_BARS) {
      snap.bars = snap.bars.slice(-MAX_BARS);
    }
  }
  snap.lastBar = bar;
}

export function getSnapshot(symbol: string): SymbolSnapshot | null {
  return state.get(symbol) ?? null;
}

export function getRecentBars(symbol: string, limit: number = 300): FuturesBar[] {
  const snap = state.get(symbol);
  if (!snap) return [];
  return snap.bars.slice(-limit);
}

export function getLastTick(symbol: string): FuturesTick | null {
  return state.get(symbol)?.lastTick ?? null;
}

export function clearSymbol(symbol: string): void {
  state.delete(symbol);
}

export function getAllSubscribedSymbols(): string[] {
  return Array.from(state.keys());
}
