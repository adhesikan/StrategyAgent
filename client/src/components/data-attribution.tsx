// Reusable market-data attribution component (Twelve Data licensing
// requirement). Rendered wherever Twelve Data-backed data or derived
// analytics are displayed — including in pre-launch testing so the final UI
// is validated before external launch.
//
// Twelve Data attribution rules: "Data provided by Twelve Data" with a
// dofollow link to the main Twelve Data website, clearly visible near the
// displayed data. Short form for compact UIs: "Source: Twelve Data".

export function TwelveDataLink({ short = false }: { short?: boolean }) {
  return (
    <>
      {short ? "Source: " : "Data provided by "}
      <a
        href="https://twelvedata.com/"
        target="_blank"
        className="underline hover:text-foreground"
        data-testid="link-twelve-data-attribution"
      >
        Twelve Data
      </a>
    </>
  );
}

export function DataAttribution({ className = "" }: { className?: string }) {
  return (
    <p
      className={`text-[11px] leading-snug text-muted-foreground ${className}`}
      data-testid="text-data-attribution"
    >
      <TwelveDataLink />. Technical analysis, scores, rankings, and AI-generated
      insights are produced by VCP Trader AI.
    </p>
  );
}

export function DataSourcesList({ className = "" }: { className?: string }) {
  return (
    <div className={`text-[11px] text-muted-foreground space-y-0.5 ${className}`} data-testid="list-data-sources">
      <div className="font-medium text-xs">Data Sources</div>
      <div>
        Historical daily market data: <TwelveDataLink short />
      </div>
      <div>News data: configured news provider</div>
      <div>Analysis and scoring: VCP Trader AI</div>
    </div>
  );
}
