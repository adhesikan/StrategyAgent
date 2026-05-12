export type MarketSession = "pre" | "regular" | "after" | "closed";

export interface MarketSessionInfo {
  session: MarketSession;
  label: string;
  isExtended: boolean;
  isTradeable: boolean;
}

export function getEasternTimeMinutes(date: Date = new Date()): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return hour * 60 + minute;
}

export function getEasternWeekday(date: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  });
  return fmt.formatToParts(date).find((p) => p.type === "weekday")?.value ?? "";
}

export const PRE_MARKET_OPEN_MIN = 4 * 60;       // 4:00 AM ET
export const REGULAR_OPEN_MIN = 9 * 60 + 30;     // 9:30 AM ET
export const REGULAR_CLOSE_MIN = 16 * 60;        // 4:00 PM ET
export const AFTER_HOURS_CLOSE_MIN = 20 * 60;    // 8:00 PM ET

export function getMarketSession(date: Date = new Date()): MarketSession {
  const weekday = getEasternWeekday(date);
  if (weekday === "Sat" || weekday === "Sun") return "closed";
  const m = getEasternTimeMinutes(date);
  if (m >= PRE_MARKET_OPEN_MIN && m < REGULAR_OPEN_MIN) return "pre";
  if (m >= REGULAR_OPEN_MIN && m < REGULAR_CLOSE_MIN) return "regular";
  if (m >= REGULAR_CLOSE_MIN && m < AFTER_HOURS_CLOSE_MIN) return "after";
  return "closed";
}

export function getMarketSessionInfo(date: Date = new Date()): MarketSessionInfo {
  const session = getMarketSession(date);
  const labels: Record<MarketSession, string> = {
    pre: "Pre-Market",
    regular: "Market Open",
    after: "After-Hours",
    closed: "Market Closed",
  };
  return {
    session,
    label: labels[session],
    isExtended: session === "pre" || session === "after",
    isTradeable: session !== "closed",
  };
}

/**
 * Map the current market session to a Tradier-compatible order duration.
 * Returns null when the market is closed (no extended-hours order can be placed).
 */
export function durationForExtendedHours(date: Date = new Date()): "pre" | "post" | null {
  const session = getMarketSession(date);
  if (session === "pre") return "pre";
  if (session === "after") return "post";
  return null;
}
