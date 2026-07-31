import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, TrendingUp, Eye, Wrench } from "lucide-react";
import {
  stageLabel,
  stageTone,
  structureRows,
  assessmentItems,
  isRenderableVcpAnalysis,
  type VcpAnalysis,
} from "@/lib/vcp-analysis";

// Structured VCP analysis cards for Ask AI stock-analysis answers.
// Renders only when a scan-backed vcpAnalysis exists; otherwise the page is
// exactly as before. All strings come from the server-derived analysis —
// nothing is computed or fabricated client-side.
export function VcpAnalysisCards({ analysis }: { analysis: VcpAnalysis | undefined | null }) {
  if (!isRenderableVcpAnalysis(analysis)) return null;
  const { analysisSummary: sum, vcpStructure: vs, setupAssessment: sa } = analysis;
  const why = assessmentItems(sa);
  const rows = structureRows(vs);

  return (
    <div className="space-y-3" data-testid="section-vcp-analysis">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <TrendingUp className="h-3.5 w-3.5" />
        VCP Analysis
      </div>

      {/* Summary metrics row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2" data-testid="row-vcp-summary">
        <div className="rounded-lg border bg-card/50 p-2.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">VCP Score</div>
          <div className="text-lg font-semibold tabular-nums" data-testid="text-vcp-score">
            {sum.vcpScore !== null ? `${sum.vcpScore}/100` : "—"}
          </div>
        </div>
        <div className="rounded-lg border bg-card/50 p-2.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Stage</div>
          <Badge variant="outline" className={`mt-1 ${stageTone(sum.stage)}`} data-testid="badge-vcp-stage">
            {stageLabel(sum.stage)}
          </Badge>
        </div>
        <div className="rounded-lg border bg-card/50 p-2.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Trend</div>
          <div className="text-sm font-medium mt-1" data-testid="text-vcp-trend">{sum.trend ?? "—"}</div>
        </div>
        <div className="rounded-lg border bg-card/50 p-2.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Setup</div>
          <Badge
            variant="outline"
            className={`mt-1 ${sa.qualifies ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10" : "border-rose-500/40 text-rose-300 bg-rose-500/10"}`}
            data-testid="badge-vcp-qualifies"
          >
            {sa.qualifies ? "Qualified" : "Not Qualified"}
          </Badge>
        </div>
      </div>

      {/* Detail cards: 2-column on desktop, stacked on mobile */}
      <div className="grid gap-3 md:grid-cols-2">
        <Card data-testid="card-vcp-structure">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Structure</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {rows.map((r) => (
              <div key={r.label} className="flex items-start justify-between gap-3 text-sm" data-testid={`row-vcp-structure-${r.label.toLowerCase().replace(/\s+/g, "-")}`}>
                <span className="text-muted-foreground shrink-0">{r.label}</span>
                <span className={`text-right min-w-0 break-words ${r.muted ? "text-muted-foreground text-xs mt-0.5" : ""}`}>
                  {r.value}
                  {r.subtext && <span className="block text-[10px] text-muted-foreground">{r.subtext}</span>}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card data-testid="card-vcp-why">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{why.title}</CardTitle>
          </CardHeader>
          <CardContent>
            {why.items.length > 0 ? (
              <ul className="space-y-1.5">
                {why.items.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm" data-testid={`text-vcp-why-${i}`}>
                    {why.positive ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 mt-0.5 shrink-0" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-rose-400 mt-0.5 shrink-0" />
                    )}
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-muted-foreground">No factors reported by the scanner.</div>
            )}
          </CardContent>
        </Card>

        {sa.improvementConditions.length > 0 && (
          <Card data-testid="card-vcp-improve">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                <Wrench className="h-3.5 w-3.5 text-sky-400" />
                What would improve the setup
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5">
                {sa.improvementConditions.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm" data-testid={`text-vcp-improve-${i}`}>
                    <span className="text-sky-400/70 mt-0.5">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {sa.watchConditions.length > 0 && (
          <Card data-testid="card-vcp-watch">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-1.5">
                <Eye className="h-3.5 w-3.5 text-amber-400" />
                Levels &amp; conditions to watch
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5">
                {sa.watchConditions.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm" data-testid={`text-vcp-watch-${i}`}>
                    <span className="text-amber-400/70 mt-0.5">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
