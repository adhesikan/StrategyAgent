// CompactMarketContext — Scannable market context card for the Overview tab.
// Sprint 2.2.1: new component; displays regime, alignment, scanner, data source
// and scan time in a compact grid. No new API calls — all data from pkg + snapshot.
//
// Only shows fields that are genuinely available. Missing fields show "Not available."
// Does not claim real-time data unless the response explicitly says so.

import { Activity, Clock, Database, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ResearchPackage, MarketSnapshot } from "./types";

// ---------------------------------------------------------------------------
// Pure, exported helpers
// ---------------------------------------------------------------------------

/** Map internal regime keys to display labels. */
export function formatRegimeLabel(regime: string | null | undefined): string {
  if (!regime) return "Not available";
  const upper = regime.toUpperCase();
  if (upper === "TRENDING") return "Strong Bull";
  if (upper === "CHOPPY")   return "Choppy";
  if (upper === "RISK_OFF") return "Risk-Off";
  return regime;
}

/** Format a UTC ISO scan time as a short local string. */
export function formatScanTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return "—";
  }
}

/** Determine candidate alignment with the current market regime. */
export function deriveAlignment(
  candidateRegime: string | null,
  marketRegime: string | null,
): string {
  if (!marketRegime) return "Not available";
  if (!candidateRegime) return "Unverified";
  if (candidateRegime === marketRegime) return "Aligned";
  if (marketRegime === "RISK_OFF") return "Caution — Risk-Off regime";
  if (marketRegime === "CHOPPY") return "Mixed — Choppy regime";
  return "Partial";
}

/**
 * Produce a factual data-source label.
 * Avoids claiming "real-time" or "live" unless the raw string says so.
 */
export function sanitizeDataSource(raw: string | null | undefined): string {
  if (!raw) return "Not available";
  const lower = raw.toLowerCase();
  // Prefer factual restatements for known MCP + Twelve Data phrases
  if (lower.includes("twelve data") && lower.includes("mcp")) {
    return "Stored market history via MCP (Twelve Data)";
  }
  if (lower.includes("twelve data")) {
    return "Twelve Data market history";
  }
  if (lower.includes("mcp")) {
    return "MCP-sourced market data";
  }
  if (lower.includes("stored") || lower.includes("daily")) {
    return raw; // already factual
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CompactMarketContextProps {
  pkg: ResearchPackage;
  snapshot?: MarketSnapshot | null;
}

interface ContextRow {
  label: string;
  value: string;
  valueClass?: string;
  testId: string;
}

export function CompactMarketContext({ pkg, snapshot }: CompactMarketContextProps) {
  const regime = pkg.marketRegime;
  const regimeLabel = formatRegimeLabel(regime);
  const regimeClass =
    regime === "TRENDING"
      ? "text-emerald-400"
      : regime === "RISK_OFF"
      ? "text-rose-400"
      : regime === "CHOPPY"
      ? "text-amber-400"
      : "text-muted-foreground";

  // Regime strength from snapshot if available
  const strengthPct = snapshot?.marketRegime?.strength != null
    ? `${Math.round(snapshot.marketRegime.strength)}%`
    : null;

  // Alignment
  const alignment = deriveAlignment(
    pkg.candidate.strategy ? pkg.marketRegime : null,
    pkg.marketRegime,
  );
  const alignClass =
    alignment === "Aligned"
      ? "text-emerald-400"
      : alignment.startsWith("Caution")
      ? "text-rose-400"
      : "text-muted-foreground";

  // Data source (factual restatement)
  const dataSource = sanitizeDataSource(pkg.dataSource);

  // Scan time
  const scanTime = formatScanTime(pkg.completedAt);

  const rows: ContextRow[] = [
    {
      label: "Regime",
      value: regimeLabel,
      valueClass: regimeClass,
      testId: "ctx-regime",
    },
    ...(strengthPct
      ? [{ label: "Regime Strength", value: strengthPct, testId: "ctx-strength" }]
      : []),
    {
      label: "Candidate Alignment",
      value: alignment,
      valueClass: alignClass,
      testId: "ctx-alignment",
    },
    {
      label: "Market Data",
      value: dataSource,
      testId: "ctx-data-source",
    },
    {
      label: "Scanned",
      value: scanTime,
      testId: "ctx-scan-time",
    },
  ];

  return (
    <Card className="border-border/40" data-testid="compact-market-context">
      <CardHeader className="px-4 py-2.5 border-b border-border/30">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" aria-hidden="true" />
            Market Context
          </CardTitle>
          {pkg.freshnessStatus === "stale" && (
            <Badge
              variant="outline"
              className="text-[9px] text-amber-400 border-amber-500/30 bg-amber-500/8"
            >
              Stale
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="px-4 py-2.5">
        <dl className="space-y-0">
          {rows.map((row, i) => (
            <div
              key={row.testId}
              className={cn(
                "flex items-center justify-between py-1.5 text-[11px]",
                i < rows.length - 1 && "border-b border-border/15",
              )}
              data-testid={row.testId}
            >
              <dt className="text-muted-foreground/70 font-medium min-w-0 shrink-0 w-36">
                {row.label}
              </dt>
              <dd className={cn("font-medium text-right truncate", row.valueClass ?? "text-foreground/80")}>
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
