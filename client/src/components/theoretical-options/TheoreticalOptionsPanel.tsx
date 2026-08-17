/**
 * client/src/components/theoretical-options/TheoreticalOptionsPanel.tsx
 *
 * Sprint 2.8.7C — Theoretical Options Research UI
 *
 * DISPLAY RULES:
 *   - Always show the disclosure header: "Theoretical values — not live option quotes."
 *   - Label all values as "Theoretical Value" (never "Option Price")
 *   - Show methodology expandable section with BSM/HV details
 *   - DTE labels always show "(hypothetical)" — never an exchange date
 *   - Use ~ prefix for all modeled values in the ATM summary
 *   - Never visually imitate a live option chain layout
 *
 * MODES (§19):
 *   This panel implements MODE B — UNDERLYING_ONLY_THEORETICAL_MODE.
 *   It remains available whether or not a broker is connected (Mode C does
 *   not replace or disable theoretical research).
 *
 * CONTRACT RESEARCH BOUNDARY (§15):
 *   This panel is NOT a Contract Research replacement.
 *   Contract Research requires a live broker options chain.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Info,
} from "lucide-react";
import type {
  TheoreticalOptionsResearch,
  TheoreticalStrikeGrid,
  AtmSummaryRow,
  TheoreticalQuality,
} from "@shared/theoretical-options-types";

// ===========================================================================
// Quality badge
// ===========================================================================

function QualityBadge({ quality }: { quality: TheoreticalQuality }) {
  const variants: Record<TheoreticalQuality, { label: string; className: string }> = {
    NORMAL:               { label: "Normal",              className: "border-green-500/40 text-green-600 dark:text-green-400" },
    LOW_CONFIDENCE:       { label: "Low Confidence",      className: "border-yellow-500/40 text-yellow-600 dark:text-yellow-400" },
    SHORT_DTE_WARNING:    { label: "Short DTE",           className: "border-orange-500/40 text-orange-600 dark:text-orange-400" },
    DEEP_ITM_OTM_WARNING: { label: "Deep ITM/OTM",        className: "border-orange-500/40 text-orange-600 dark:text-orange-400" },
    INSUFFICIENT_HISTORY: { label: "Insufficient History", className: "border-red-500/40 text-red-600 dark:text-red-400" },
    UNAVAILABLE:          { label: "Unavailable",          className: "border-red-500/40 text-red-600 dark:text-red-400" },
  };
  const { label, className } = variants[quality];
  return (
    <Badge variant="outline" className={`text-[10px] ${className}`}>
      {label}
    </Badge>
  );
}

// ===========================================================================
// Methodology panel (expandable)
// ===========================================================================

function MethodologyPanel({ research }: { research: TheoreticalOptionsResearch }) {
  const [open, setOpen] = useState(false);
  const m = research.methodology;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="text-xs gap-1.5 px-2 h-7">
          <Info className="h-3 w-3" aria-hidden="true" />
          Methodology
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 rounded-lg border border-border/40 bg-muted/30 p-3 space-y-1.5 text-[11px] text-muted-foreground">
          <div className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-1">
            <span className="font-medium text-foreground/70">Model</span>
            <span>{m.pricingModel}</span>
            <span className="font-medium text-foreground/70">Volatility</span>
            <span>{m.volatilityInput}</span>
            <span className="font-medium text-foreground/70">Lookback</span>
            <span>{m.volatilityLookback}</span>
            {m.sigmaAsOf && (
              <>
                <span className="font-medium text-foreground/70">As of</span>
                <span>{m.sigmaAsOf}</span>
              </>
            )}
            <span className="font-medium text-foreground/70">Underlying</span>
            <span>{m.underlyingSource}</span>
            <span className="font-medium text-foreground/70">Risk-free rate</span>
            <span>{m.riskFreeRateValue}</span>
            <span className="font-medium text-foreground/70">Dividend yield</span>
            <span>{m.dividendYieldValue} ({m.dividendYieldSource})</span>
            <span className="font-medium text-foreground/70">Time T</span>
            <span>{m.timeConvention}</span>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ===========================================================================
// Historical volatility summary
// ===========================================================================

function HVSummary({ research }: { research: TheoreticalOptionsResearch }) {
  const hv = research.volatilitySet;
  const entries = [
    { label: "HV10", vol: hv.hv10.annualizedVol },
    { label: "HV20", vol: hv.hv20.annualizedVol },
    { label: "HV30", vol: hv.hv30.annualizedVol },
    { label: "HV60", vol: hv.hv60.annualizedVol },
    { label: "HV90", vol: hv.hv90.annualizedVol },
  ];
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
        Historical Volatility (annualized)
      </p>
      <div className="flex flex-wrap gap-2">
        {entries.map(({ label, vol }) => (
          <div
            key={label}
            className="flex flex-col items-center px-2.5 py-1.5 rounded border border-border/40 bg-muted/20 min-w-[3.5rem]"
          >
            <span className="text-[9px] text-muted-foreground font-medium">{label}</span>
            <span className="text-xs font-mono font-semibold">
              {vol !== null ? `${(vol * 100).toFixed(1)}%` : "—"}
            </span>
            {label === "HV30" && vol !== null && (
              <span className="text-[8px] text-primary/60 mt-0.5">default</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
// ATM summary table
// ===========================================================================

function AtmSummaryTable({ atmSummary }: { atmSummary: AtmSummaryRow[] }) {
  const fmt = (n: number | null, decimals = 2) =>
    n !== null ? n.toFixed(decimals) : "—";
  const fmtDollar = (n: number | null) =>
    n !== null ? `~$${n.toFixed(2)}` : "—";
  const fmtDelta = (n: number | null) =>
    n !== null ? `~${n.toFixed(3)}` : "—";

  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
        ATM Theoretical Values by DTE
      </p>
      <div className="overflow-x-auto">
        <table className="text-[11px] w-full border-collapse">
          <thead>
            <tr className="border-b border-border/40">
              <th className="text-left py-1 pr-3 font-medium text-muted-foreground">DTE</th>
              <th className="text-right py-1 px-2 font-medium text-muted-foreground">Call ~TV</th>
              <th className="text-right py-1 px-2 font-medium text-muted-foreground">Put ~TV</th>
              <th className="text-right py-1 px-2 font-medium text-muted-foreground">Δ Call</th>
              <th className="text-right py-1 px-2 font-medium text-muted-foreground">Δ Put</th>
              <th className="text-right py-1 px-2 font-medium text-muted-foreground">Quality</th>
            </tr>
          </thead>
          <tbody>
            {atmSummary.map((row) => (
              <tr
                key={row.dte}
                className="border-b border-border/20 hover:bg-muted/20 transition-colors"
              >
                <td className="py-1.5 pr-3 font-mono text-muted-foreground">{row.dteLabel}</td>
                <td className="py-1.5 px-2 text-right font-mono">{fmtDollar(row.modelCallValue)}</td>
                <td className="py-1.5 px-2 text-right font-mono">{fmtDollar(row.modelPutValue)}</td>
                <td className="py-1.5 px-2 text-right font-mono text-blue-600 dark:text-blue-400">{fmtDelta(row.modelCallDelta)}</td>
                <td className="py-1.5 px-2 text-right font-mono text-red-600 dark:text-red-400">{fmtDelta(row.modelPutDelta)}</td>
                <td className="py-1.5 px-2 text-right">
                  <QualityBadge quality={row.quality} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[9px] text-muted-foreground/70 mt-1">
        ~TV = Theoretical Value. Δ = Model Delta. All values are BSM estimates, not market quotes.
      </p>
    </div>
  );
}

// ===========================================================================
// Strike grid for a single DTE scenario
// ===========================================================================

function StrikeGridSection({ grid }: { grid: TheoreticalStrikeGrid }) {
  const [open, setOpen] = useState(false);
  const fmtVal = (n: number | null) => (n !== null ? `~$${n.toFixed(2)}` : "—");
  const fmtDelta = (n: number | null) => (n !== null ? n.toFixed(3) : "—");

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-2 w-full text-left py-2 px-1 hover:bg-muted/20 rounded transition-colors">
          <span className="text-[11px] font-medium font-mono">{grid.dteLabel}</span>
          <Badge variant="outline" className="text-[9px]">
            {grid.rows.length} strikes
          </Badge>
          <span className="ml-auto text-muted-foreground">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="overflow-x-auto pb-2">
          <table className="text-[10px] w-full border-collapse min-w-[600px]">
            <thead>
              <tr className="border-b border-border/40">
                <th className="text-right py-1 pr-2 font-medium text-muted-foreground">Strike</th>
                <th className="text-center py-1 px-2 font-medium text-muted-foreground">Money</th>
                <th className="text-right py-1 px-2 font-medium text-muted-foreground">Call ~TV</th>
                <th className="text-right py-1 px-2 font-medium text-muted-foreground">Put ~TV</th>
                <th className="text-right py-1 px-2 font-medium text-muted-foreground">Δ Call</th>
                <th className="text-right py-1 px-2 font-medium text-muted-foreground">Δ Put</th>
                <th className="text-right py-1 px-2 font-medium text-muted-foreground">Γ</th>
                <th className="text-right py-1 px-2 font-medium text-muted-foreground">Θ/day</th>
                <th className="text-right py-1 px-2 font-medium text-muted-foreground">ν/1%</th>
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row) => (
                <tr
                  key={row.strike}
                  className={`border-b border-border/10 transition-colors ${
                    row.moneyness === "ATM"
                      ? "bg-primary/5 font-semibold"
                      : "hover:bg-muted/10"
                  }`}
                >
                  <td className="py-1 pr-2 text-right font-mono">${row.strike.toFixed(2)}</td>
                  <td className="py-1 px-2 text-center">
                    <span
                      className={`text-[9px] px-1 rounded ${
                        row.moneyness === "ATM"
                          ? "bg-primary/10 text-primary"
                          : row.moneyness === "ITM"
                          ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {row.moneyness}
                    </span>
                  </td>
                  <td className="py-1 px-2 text-right font-mono">{fmtVal(row.modelCallValue)}</td>
                  <td className="py-1 px-2 text-right font-mono">{fmtVal(row.modelPutValue)}</td>
                  <td className="py-1 px-2 text-right font-mono text-blue-600 dark:text-blue-400">
                    {fmtDelta(row.modelCallDelta)}
                  </td>
                  <td className="py-1 px-2 text-right font-mono text-red-600 dark:text-red-400">
                    {fmtDelta(row.modelPutDelta)}
                  </td>
                  <td className="py-1 px-2 text-right font-mono text-muted-foreground">
                    {row.modelGamma !== null ? row.modelGamma.toFixed(4) : "—"}
                  </td>
                  <td className="py-1 px-2 text-right font-mono text-muted-foreground">
                    {row.modelCallTheta !== null ? row.modelCallTheta.toFixed(3) : "—"}
                  </td>
                  <td className="py-1 px-2 text-right font-mono text-muted-foreground">
                    {row.modelVega !== null ? row.modelVega.toFixed(3) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[9px] text-muted-foreground/60 mt-1 px-1">
            ~TV = Theoretical Value (BSM). No bid, ask, volume, OI, or OCC symbols.
            Not an option chain. Expiration is hypothetical, not exchange-listed.
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ===========================================================================
// Main panel
// ===========================================================================

export interface TheoreticalOptionsPanelProps {
  symbol: string;
  /** When false, panel is hidden. Useful for conditional rendering in the trade plan flow. */
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for testability (no DOM, no broker, no session)
// ---------------------------------------------------------------------------

/**
 * Returns the React Query cache key for the theoretical options endpoint.
 * Depends only on symbol — no broker token, no session ID.
 */
export function buildTheoreticalOptionsQueryKey(symbol: string): [string, string] {
  return ["theoretical-options", symbol];
}

/**
 * Returns true when the panel should attempt to fetch data.
 * Pure function: only depends on enabled flag and symbol validity.
 * No broker state, no session, no account access required.
 */
export function isPanelActive(symbol: string | undefined | null, enabled = true): boolean {
  return enabled === true && typeof symbol === "string" && symbol.trim().length > 0;
}

/**
 * Returns the required disclosure text that must always be visible on the panel.
 * Invariant: this string can never be empty and must contain "Theoretical values".
 */
export function getRequiredDisclosureText(): string {
  return "Theoretical values — not live option quotes.";
}

/**
 * Returns true when fieldName is a forbidden execution/market field.
 * Theoretical research must never surface bid, ask, volume, openInterest,
 * lastPrice, mark, midpoint, or OCC contract symbols.
 */
export function isForbiddenMarketField(fieldName: string): boolean {
  // All entries must be lowercase — lookup uses .toLowerCase()
  const FORBIDDEN = new Set([
    "bid", "ask", "volume", "openinterest", "lastprice",
    "mark", "midpoint", "executionprice", "occsymbol",
  ]);
  return FORBIDDEN.has(fieldName.trim().toLowerCase());
}

export function TheoreticalOptionsPanel({
  symbol,
  enabled = true,
}: TheoreticalOptionsPanelProps) {
  const query = useQuery<TheoreticalOptionsResearch>({
    queryKey: ["theoretical-options", symbol],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/trade-planning/theoretical-options/${encodeURIComponent(symbol)}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: enabled && !!symbol,
    staleTime: 5 * 60 * 1000,   // 5 minutes
    refetchOnWindowFocus: false,
  });

  if (!enabled || !symbol) return null;

  if (query.isLoading) {
    return (
      <Card data-testid="theoretical-options-panel">
        <CardHeader className="pb-2">
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Card data-testid="theoretical-options-panel">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <FlaskConical className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Theoretical Options Research
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4 text-destructive/70" aria-hidden="true" />
            <span>Theoretical research is currently unavailable for {symbol}.</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const research = query.data;
  const isUnavailable = research.quality === "UNAVAILABLE";

  return (
    <Card data-testid="theoretical-options-panel">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <FlaskConical className="h-4 w-4 text-primary" aria-hidden="true" />
            Theoretical Options Research
          </CardTitle>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge
              variant="outline"
              className="text-[9px] border-amber-500/40 text-amber-600 dark:text-amber-400"
            >
              MODE B — Underlying Only
            </Badge>
            <QualityBadge quality={research.quality} />
          </div>
        </div>

        {/* Required disclosure — always visible */}
        <div
          className="flex items-start gap-1.5 mt-1.5 rounded-md border border-amber-500/30 bg-amber-50/40 dark:bg-amber-950/20 px-2.5 py-1.5"
          role="note"
          aria-label="Theoretical options research disclosure"
          data-testid="theoretical-options-disclosure"
        >
          <AlertCircle className="h-3 w-3 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <p className="text-[10px] text-amber-700 dark:text-amber-300">
            <strong>Theoretical values — not live option quotes.</strong>{" "}
            Model estimates from historical volatility (Black-Scholes). Not market prices.
            Not a recommendation to buy or sell any option.
          </p>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Quality notes */}
        {research.qualityNotes.length > 0 && (
          <div className="space-y-1">
            {research.qualityNotes.map((note, i) => (
              <p key={i} className="text-[11px] text-muted-foreground">
                {note}
              </p>
            ))}
          </div>
        )}

        {isUnavailable ? (
          <div className="text-sm text-muted-foreground py-2">
            Underlying market data is unavailable — theoretical research requires a
            reference price.
          </div>
        ) : (
          <>
            {/* Historical Volatility summary */}
            <HVSummary research={research} />

            {/* ATM Summary table */}
            {research.atmSummary.length > 0 && (
              <AtmSummaryTable atmSummary={research.atmSummary} />
            )}

            {/* Strike Grids — collapsed by default */}
            {research.strikeGrids.length > 0 && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                  Theoretical Strike Grid
                </p>
                <p className="text-[10px] text-muted-foreground/70 mb-2">
                  Not an option chain. No OCC symbols. Expiration is hypothetical.
                </p>
                <div className="divide-y divide-border/30">
                  {research.strikeGrids.map((grid) => (
                    <StrikeGridSection key={grid.dte} grid={grid} />
                  ))}
                </div>
              </div>
            )}

            {/* Methodology expandable */}
            <div className="flex items-center justify-between flex-wrap gap-2 pt-1 border-t border-border/30">
              <MethodologyPanel research={research} />
              <p className="text-[9px] text-muted-foreground/60 font-mono">
                σ={research.methodology.volatilityInput.split(" ")[0]} · r={(research.riskFreeRate * 100).toFixed(1)}% · q={(research.dividendYield * 100).toFixed(1)}%
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
