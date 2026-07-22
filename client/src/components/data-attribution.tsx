// Reusable market-data attribution component (Twelve Data licensing
// requirement). Rendered wherever Twelve Data-backed data or derived
// analytics are displayed — including in pre-launch testing so the final UI
// is validated before external launch.

export function DataAttribution({ className = "" }: { className?: string }) {
  return (
    <p
      className={`text-[11px] leading-snug text-muted-foreground ${className}`}
      data-testid="text-data-attribution"
    >
      Historical daily market data provided by Twelve Data. Technical analysis, scores,
      rankings, and AI-generated insights are produced by VCP Trader AI.
    </p>
  );
}

export function DataSourcesList({ className = "" }: { className?: string }) {
  return (
    <div className={`text-[11px] text-muted-foreground space-y-0.5 ${className}`} data-testid="list-data-sources">
      <div className="font-medium text-xs">Data Sources</div>
      <div>Historical daily market data: Twelve Data</div>
      <div>News data: configured news provider</div>
      <div>Analysis and scoring: VCP Trader AI</div>
    </div>
  );
}
