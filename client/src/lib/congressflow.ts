export const CONGRESSFLOW_ORIGIN = "https://congress.vcptrader.com";
export const CONGRESSFLOW_EMBED_URL = `${CONGRESSFLOW_ORIGIN}/embed`;

export type CongressFlowView = "activity" | "ticker" | "politician";

const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeTicker(raw: string): string | null {
  const t = (raw ?? "").trim().toUpperCase();
  return TICKER_RE.test(t) ? t : null;
}

export function isValidPoliticianSlug(slug: string): boolean {
  return typeof slug === "string" && slug.length <= 80 && SLUG_RE.test(slug);
}

export function isValidIsoDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const parsed = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === d;
}

export function buildCongressFlowEmbedUrl(opts: {
  view?: CongressFlowView;
  ticker?: string;
  politicianSlug?: string;
}): string {
  const url = new URL(CONGRESSFLOW_EMBED_URL);
  const view = opts.view ?? "activity";
  if (view === "ticker") {
    const t = opts.ticker ? normalizeTicker(opts.ticker) : null;
    if (!t) return url.toString();
    url.searchParams.set("view", "ticker");
    url.searchParams.set("ticker", t);
  } else if (view === "politician") {
    if (!opts.politicianSlug || !isValidPoliticianSlug(opts.politicianSlug)) return url.toString();
    url.searchParams.set("view", "politician");
    url.searchParams.set("slug", opts.politicianSlug);
  }
  return url.toString();
}

export interface CongressFlowIncomingEvents {
  CONGRESSFLOW_READY: { type: "CONGRESSFLOW_READY"; version?: string };
  CONGRESSFLOW_HEIGHT_CHANGED: { type: "CONGRESSFLOW_HEIGHT_CHANGED"; height: number };
  CONGRESSFLOW_TICKER_SELECTED: { type: "CONGRESSFLOW_TICKER_SELECTED"; ticker: string };
  CONGRESSFLOW_POLITICIAN_SELECTED: { type: "CONGRESSFLOW_POLITICIAN_SELECTED"; slug: string; name?: string };
  CONGRESSFLOW_SOURCE_OPENED: { type: "CONGRESSFLOW_SOURCE_OPENED"; url: string };
}

export const CONGRESSFLOW_INCOMING_TYPES = new Set<string>([
  "CONGRESSFLOW_READY",
  "CONGRESSFLOW_HEIGHT_CHANGED",
  "CONGRESSFLOW_TICKER_SELECTED",
  "CONGRESSFLOW_POLITICIAN_SELECTED",
  "CONGRESSFLOW_SOURCE_OPENED",
]);

export function normalizeWatchlist(tickers: string[], max = 50): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tickers ?? []) {
    const t = normalizeTicker(raw);
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
      if (out.length >= max) break;
    }
  }
  return out;
}
