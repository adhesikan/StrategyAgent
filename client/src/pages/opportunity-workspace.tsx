// /opportunities/:symbol — Sprint 2.3.0 Opportunity Research Workspace
//
// Professional research workspace answering:
//   • Why is this opportunity ranked highly?
//   • What evidence supports it?
//   • What risks exist?
//   • What changed since yesterday?
//
// Performance contract: exactly 2 API calls.
//   Call 1 — GET /api/opportunities/today     → full ranking (in-memory, instant)
//   Call 2 — GET /api/opportunities/workspace/:symbol → history + institutional
//
// Compliance: never uses "buy/sell/recommendation/expected profit/target return".
//             All price levels labeled as educational planning only.
//             No LLM — all explanations are deterministic.

import { useState, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { SCORE_LABEL_TO_GLOSSARY_KEY } from "@shared/research-glossary";
import { ResearchDefinitionTooltip } from "@/components/research-definition-tooltip";
import { UnderstandingScoresLink } from "@/components/score-explanation-modal";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  Shield,
  Building2,
  BarChart2,
  Clock,
  RefreshCcw,
  GitCompare,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  Info,
  Users,
  Activity,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  getScoreColor,
  getScoreBarBg,
  getConfidenceBadge,
  getCategoryBadge,
  buildRankedExplanation,
  buildRiskExplanation,
  findRelated,
  analyzeHistoryTrend,
  getAllRankedSymbols,
  findScoredCandidate,
  type OpportunityScore,
  type ScoredCandidate,
  type WatchScoredCandidate,
  type OpportunityRanking,
  type HistoryEntry,
} from "@/lib/opportunity-workspace-helpers";

// ---------------------------------------------------------------------------
// Server response types (mirrored from server/routes/opportunity-workspace.ts)
// ---------------------------------------------------------------------------

interface InstitutionalMetrics {
  managerCountLatest: number | null;
  managerCountPrevious: number | null;
  totalSharesLatest: number | null;
  totalSharesPrevious: number | null;
  newManagerCount: number;
  exitedManagerCount: number;
  increasedManagerCount: number;
  reducedManagerCount: number;
}

interface InstitutionalSignal {
  symbol: string;
  status: string;
  latestQuarter: string | null;
  previousQuarter: string | null;
  periodEndDate: string | null;
  score: number | null;
  label: string | null;
  summary: string | null;
  metrics: InstitutionalMetrics;
  concentration: {
    holderCount: number;
    topHolderSharePct: number | null;
    top5HolderSharePct: number | null;
    trend: string;
  };
  dataQuality: {
    confidence: string;
    comparableManagerCount: number;
    mappingCoverage: number | null;
  };
  freshness: {
    source: string;
    delayed: boolean;
    periodEndDate: string | null;
    calculatedAt: string | null;
  };
}

// ChangeExplanation type (subset of OpportunityChangeExplanation from server)
interface ChangeExplanation {
  symbol: string;
  previousRank: number | null;
  currentRank:  number | null;
  previousScore: number | null;
  currentScore:  number;
  scoreDelta:    number | null;
  rankDelta:     number | null;
  importance:    "Minor" | "Moderate" | "Major" | "Critical";
  summary:       string;
  drivers:       string[];
  warnings:      string[];
  confidence:    "high" | "medium" | "low";
  category:      string;
  direction:     "upgraded" | "downgraded" | "new" | "moved" | "unchanged" | "removed";
}

interface WorkspaceResponse {
  symbol: string;
  companyName: string | null;
  history: HistoryEntry[];
  institutional: InstitutionalSignal | null;
  changeExplanation: ChangeExplanation | null;
}

interface OpportunityTodayResponse {
  ranking: OpportunityRanking | null;
  available: boolean;
  message: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAge(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtNum(n: number | null | undefined, decimals = 0): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// ---------------------------------------------------------------------------
// Why It Changed Panel (Sprint 2.3.1)
// ---------------------------------------------------------------------------

const IMPORTANCE_BORDER: Record<string, string> = {
  Critical: "border-rose-700 bg-rose-950/20",
  Major:    "border-amber-700 bg-amber-950/20",
  Moderate: "border-sky-800 bg-sky-950/20",
  Minor:    "border-slate-700 bg-slate-900/60",
};

const DIRECTION_ICON_WS: Record<string, string> = {
  new: "★", upgraded: "↑", downgraded: "↓", moved: "→", unchanged: "·", removed: "✕",
};

function WhyItChangedPanel({ exp }: { exp: ChangeExplanation }) {
  const [expanded, setExpanded] = useState(false);
  const borderClass = IMPORTANCE_BORDER[exp.importance] ?? IMPORTANCE_BORDER.Minor;
  const dirIcon     = DIRECTION_ICON_WS[exp.direction] ?? "·";
  const scoreDeltaStr =
    exp.scoreDelta == null ? null :
    exp.scoreDelta > 0 ? `+${exp.scoreDelta}` : `${exp.scoreDelta}`;
  const deltaColor =
    (exp.scoreDelta ?? 0) > 0 ? "text-emerald-400" :
    (exp.scoreDelta ?? 0) < 0 ? "text-rose-400" : "text-slate-500";

  return (
    <Card className={`border ${borderClass}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
          <Activity className="h-4 w-4 text-amber-400" />
          Why It Changed
          <span className={`ml-auto flex items-center gap-1 text-xs font-mono ${deltaColor}`}>
            <span className="opacity-70">{dirIcon}</span>
            {scoreDeltaStr ?? ""}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-slate-200">{exp.summary}</p>

        {exp.drivers.length > 0 && (
          <>
            <button
              className="text-[11px] text-slate-500 hover:text-slate-300 transition-colors flex items-center gap-1"
              onClick={() => setExpanded(e => !e)}
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {expanded ? "Hide" : "Show"} drivers ({exp.drivers.length})
            </button>
            {expanded && (
              <ul className="space-y-1.5">
                {exp.drivers.map((d, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-slate-300 pl-2 border-l border-slate-700">
                    {d}
                  </li>
                ))}
                {exp.warnings.map((w, i) => (
                  <li key={`w${i}`} className="flex items-start gap-2 text-xs text-amber-300 pl-2 border-l border-amber-800">
                    ⚠ {w}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <div className="flex items-center gap-3 pt-1 text-[10px] text-slate-500">
          <span className="capitalize">{exp.importance} change</span>
          <span>·</span>
          <span className="capitalize">{exp.confidence} confidence</span>
          {exp.previousScore != null && (
            <>
              <span>·</span>
              <span>Prev score: {exp.previousScore}</span>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ScoreBar({ score, label }: { score: number; label: string }) {
  const termKey = SCORE_LABEL_TO_GLOSSARY_KEY[label];
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        {termKey ? (
          <ResearchDefinitionTooltip term={termKey} side="left" showCaution={false}>
            <span className="text-slate-400">{label}</span>
          </ResearchDefinitionTooltip>
        ) : (
          <span className="text-slate-400">{label}</span>
        )}
        <span className={cn("font-medium tabular-nums", getScoreColor(score))}>{score}</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-800">
        <div
          className={cn("h-full rounded-full transition-all duration-500", getScoreBarBg(score))}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

function ScorePill({ label, score }: { label: string; score: number }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg bg-slate-900 border border-slate-800 px-3 py-2 min-w-[72px]">
      <span className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</span>
      <span className={cn("text-lg font-bold tabular-nums", getScoreColor(score))}>{score}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview Tab
// ---------------------------------------------------------------------------

function OverviewTab({
  candidate,
  score,
  regime,
}: {
  candidate: ScoredCandidate | WatchScoredCandidate | null;
  score: OpportunityScore;
  regime: string | null;
}) {
  const isScored = (c: any): c is ScoredCandidate => c && "rewardRisk" in c;
  const c = isScored(candidate) ? candidate : null;
  const exp = buildRankedExplanation(score, c, regime);
  const entryPrice = c?.trigger ?? null;
  const stopPrice  = c?.invalidation ?? null;
  const target     = c?.objective ?? null;

  return (
    <div className="space-y-5">
      {/* Score overview */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm text-slate-300">Research Score</CardTitle>
            <UnderstandingScoresLink />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <ScoreBar score={score.overallScore}     label="Overall" />
          <ScoreBar score={score.technicalScore}   label="Technical" />
          <ScoreBar score={score.institutionalScore} label="Institutional" />
          <ScoreBar score={score.fundamentalScore} label="Fundamental" />
          <ScoreBar score={score.riskScore}        label="Risk" />
          <ScoreBar score={score.regimeScore}      label="Regime" />
        </CardContent>
      </Card>

      {/* Why This Ranked */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
            <Info className="h-4 w-4 text-sky-400" />
            Why This Ranked
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-400">{exp.summary}</p>
          <ul className="space-y-2">
            {exp.bullets.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                {b}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Signals */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Supporting Signals
            </CardTitle>
          </CardHeader>
          <CardContent>
            {score.reasons.length === 0 ? (
              <p className="text-sm text-slate-500">No signals recorded.</p>
            ) : (
              <ul className="space-y-1.5">
                {score.reasons.map((r, i) => (
                  <li key={i} className="text-sm text-slate-300">{r}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" /> Risk Warnings
            </CardTitle>
          </CardHeader>
          <CardContent>
            {score.warnings.length === 0 ? (
              <p className="text-sm text-slate-500">No warnings flagged.</p>
            ) : (
              <ul className="space-y-1.5">
                {score.warnings.map((w, i) => (
                  <li key={i} className="text-sm text-amber-300">{w}</li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Entry / Stop / Target */}
      {(entryPrice || stopPrice || target) && (
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-300">
              Educational Planning Levels
              <span className="ml-2 text-[10px] font-normal text-slate-500 uppercase tracking-wide">
                Not financial advice
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                { label: "Entry Zone", value: entryPrice },
                { label: "Stop Level",  value: stopPrice },
                { label: "Target",      value: target },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg bg-slate-950 border border-slate-800 p-2">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">{label}</p>
                  <p className="text-sm text-slate-200 font-medium">{value ?? "—"}</p>
                </div>
              ))}
            </div>
            {c?.rewardRisk != null && (
              <p className="mt-3 text-center text-xs text-slate-500">
                Risk/Reward: <span className={cn("font-medium", c.rewardRisk >= 3 ? "text-emerald-400" : "text-amber-400")}>{c.rewardRisk.toFixed(1)}:1</span>
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Technical Tab
// ---------------------------------------------------------------------------

function TechnicalTab({ candidate }: { candidate: ScoredCandidate | WatchScoredCandidate | null }) {
  const isScored = (c: any): c is ScoredCandidate => c && "whySelected" in c;
  const c = isScored(candidate) ? candidate : null;
  const score = candidate?.opportunityScore;

  const rows: Array<{ label: string; value: string | number | undefined | null }> = [
    { label: "Strategy",          value: c?.strategy ?? (candidate as WatchScoredCandidate)?.strategy },
    { label: "Pattern / Setup",   value: c?.structure ?? (candidate as WatchScoredCandidate)?.currentStage },
    { label: "Stage",             value: (candidate as WatchScoredCandidate)?.currentStage },
    { label: "Confidence",        value: c?.confidence },
    { label: "Volume Confirmation", value: c?.whySelected?.find(w => w.toLowerCase().includes("volume")) ?? null },
    { label: "Support / Stop",    value: c?.invalidation },
    { label: "Resistance / Entry", value: c?.trigger },
    { label: "Breakout Level",    value: c?.trigger },
    { label: "Setup Status",      value: c?.setupStatus ?? (candidate as WatchScoredCandidate)?.missingConfirmation },
    { label: "Technical Score",   value: score ? `${score.technicalScore}/100` : null },
  ];

  const filteredRows = rows.filter(r => r.value != null && String(r.value).trim() !== "");
  const deduped = filteredRows.filter((r, i, arr) =>
    arr.findIndex(x => x.value === r.value && x.label !== r.label) === i ||
    !arr.slice(0, i).some(x => x.value === r.value)
  );

  const trendBullets: string[] = c?.whySelected ?? (candidate as WatchScoredCandidate)?.watchConditions ?? [];

  return (
    <div className="space-y-5">
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
            <BarChart2 className="h-4 w-4 text-sky-400" /> Technical Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          {deduped.length === 0 ? (
            <p className="text-sm text-slate-500">Technical details available after the first live scan.</p>
          ) : (
            <dl className="space-y-3">
              {deduped.map(({ label, value }) => (
                <div key={label} className="flex justify-between items-start gap-4">
                  <dt className="text-sm text-slate-500 shrink-0 w-40">{label}</dt>
                  <dd className="text-sm text-slate-200 text-right">{String(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </CardContent>
      </Card>

      {trendBullets.length > 0 && (
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-400" /> Trend Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {trendBullets.map((b, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                  <span className="text-slate-600 mt-0.5">•</span> {b}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Institutional Tab
// ---------------------------------------------------------------------------

function InstitutionalTab({
  institutional,
  score,
}: {
  institutional: InstitutionalSignal | null;
  score: OpportunityScore;
}) {
  const isUnavailable = !institutional || institutional.status === "unavailable";

  if (isUnavailable) {
    return (
      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="py-10 text-center">
          <Building2 className="h-8 w-8 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-400">Institutional 13F data is not yet available for this symbol.</p>
          <p className="text-xs text-slate-600 mt-1">Score uses neutral baseline of 50.</p>
        </CardContent>
      </Card>
    );
  }

  const m = institutional.metrics;
  const dq = institutional.dataQuality;
  const freshness = institutional.freshness;

  const trendLabel: Record<string, string> = {
    increasing_concentration:  "Increasing concentration",
    stable_concentration:      "Stable concentration",
    broadening_ownership:      "Broadening ownership",
    insufficient_data:         "Insufficient data",
  };

  const rows: Array<{ label: string; value: React.ReactNode }> = [
    { label: "Institutional Score",  value: <span className={cn("font-bold", getScoreColor(institutional.score ?? 0))}>{institutional.score ?? "—"}/100</span> },
    { label: "Signal",               value: institutional.label ?? "—" },
    { label: "Period",               value: institutional.latestQuarter ?? "—" },
    { label: "Manager Count",        value: fmtNum(m.managerCountLatest) },
    { label: "New Managers",         value: <span className="text-emerald-400">{fmtNum(m.newManagerCount)}</span> },
    { label: "Exited Managers",      value: <span className="text-rose-400">{fmtNum(m.exitedManagerCount)}</span> },
    { label: "Increased Positions",  value: <span className="text-emerald-400">{fmtNum(m.increasedManagerCount)}</span> },
    { label: "Reduced Positions",    value: <span className="text-amber-400">{fmtNum(m.reducedManagerCount)}</span> },
    { label: "Institutional Trend",  value: trendLabel[institutional.concentration.trend] ?? institutional.concentration.trend },
    { label: "Data Confidence",      value: <span className="capitalize">{dq.confidence}</span> },
    { label: "Comparable Managers",  value: fmtNum(dq.comparableManagerCount) },
    { label: "Data Source",          value: freshness.source },
  ];

  return (
    <div className="space-y-5">
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-300 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-sky-400" /> 13F Institutional Signal
            <Badge className="ml-auto text-[10px] bg-amber-900/40 text-amber-400 border border-amber-800">
              Delayed — SEC Form 13F
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {institutional.summary && (
            <p className="text-sm text-slate-300 mb-4 pb-4 border-b border-slate-800">{institutional.summary}</p>
          )}
          <dl className="space-y-3">
            {rows.map(({ label, value }) => (
              <div key={label} className="flex justify-between items-center gap-4">
                <dt className="text-sm text-slate-500 shrink-0 w-44">{label}</dt>
                <dd className="text-sm text-slate-200">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <p className="text-[11px] text-slate-600 text-center">
        13F data is delayed up to 45 days after quarter end. Holdings reflect the period ending{" "}
        {freshness.periodEndDate ? formatDate(freshness.periodEndDate) : "unknown"}.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Risk Tab
// ---------------------------------------------------------------------------

function RiskTab({
  score,
  candidate,
}: {
  score: OpportunityScore;
  candidate: ScoredCandidate | WatchScoredCandidate | null;
}) {
  const isScored = (c: any): c is ScoredCandidate => c && "rewardRisk" in c;
  const c = isScored(candidate) ? candidate : null;
  const exp = buildRiskExplanation(score, c);

  const riskRows = [
    { icon: <BarChart2 className="h-4 w-4 text-sky-400" />,     label: "Risk Budget",       value: exp.riskBudget },
    { icon: <TrendingUp className="h-4 w-4 text-emerald-400" />, label: "Reward/Risk",       value: exp.rewardRisk },
    { icon: <AlertTriangle className="h-4 w-4 text-amber-400" />, label: "Gap Risk",          value: exp.gapRisk },
    { icon: <Activity className="h-4 w-4 text-slate-400" />,     label: "Liquidity",         value: exp.liquidity },
    { icon: <Clock className="h-4 w-4 text-slate-400" />,        label: "Upcoming Earnings", value: exp.earningsNote },
    { icon: <Layers className="h-4 w-4 text-slate-400" />,       label: "Volatility",        value: exp.volatility },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-amber-950/30 border border-amber-900/50 p-3">
        <p className="text-xs text-amber-400">
          All risk levels are for educational planning only. Past patterns are not predictive of future outcomes.
          Always apply your own position sizing and risk management rules.
        </p>
      </div>
      {riskRows.map(({ icon, label, value }) => (
        <Card key={label} className="bg-slate-900 border-slate-800">
          <CardContent className="py-3 px-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0">{icon}</div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-0.5">{label}</p>
                <p className="text-sm text-slate-200">{value}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// History Tab
// ---------------------------------------------------------------------------

function HistoryTab({ history, symbol }: { history: HistoryEntry[]; symbol: string }) {
  const trend = analyzeHistoryTrend(history);

  const trendIcon =
    trend.direction === "improving" ? <TrendingUp className="h-4 w-4 text-emerald-400" /> :
    trend.direction === "declining" ? <TrendingDown className="h-4 w-4 text-rose-400" /> :
    trend.direction === "stable"    ? <Minus className="h-4 w-4 text-slate-400" /> :
    <Info className="h-4 w-4 text-slate-500" />;

  const trendColor =
    trend.direction === "improving" ? "text-emerald-400" :
    trend.direction === "declining" ? "text-rose-400" : "text-slate-400";

  return (
    <div className="space-y-5">
      {/* Trend summary */}
      <Card className="bg-slate-900 border-slate-800">
        <CardContent className="py-4 px-4">
          <div className="flex items-center gap-3">
            {trendIcon}
            <div>
              <p className="text-sm text-slate-200">
                <span className={cn("font-semibold capitalize", trendColor)}>{trend.direction}</span>
                {trend.deltaScore != null && (
                  <span className="ml-2 text-slate-500">
                    ({trend.deltaScore > 0 ? "+" : ""}{trend.deltaScore} pts over {trend.sessions} sessions)
                  </span>
                )}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">{symbol} score trend over available history</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* History table */}
      {history.length === 0 ? (
        <Card className="bg-slate-900 border-slate-800">
          <CardContent className="py-10 text-center">
            <Clock className="h-8 w-8 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-400">No ranking history yet for {symbol}.</p>
            <p className="text-xs text-slate-600 mt-1">History is recorded after each scanner run.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-sm text-slate-300">
            <thead>
              <tr className="border-b border-slate-800 text-xs text-slate-500 uppercase tracking-wide">
                <th className="text-left py-2 px-3">Date</th>
                <th className="text-right py-2 px-3">Rank</th>
                <th className="text-right py-2 px-3">Score</th>
                <th className="text-left py-2 px-3">Status</th>
                <th className="text-left py-2 px-3">Category Change</th>
                <th className="text-left py-2 px-3">Regime</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row, i) => {
                const prev = history[i + 1];
                const scoreDelta = prev ? row.score - prev.score : null;
                const statusColor =
                  row.lifecycleState === "NEWLY_QUALIFIED" || row.lifecycleState === "STRENGTHENING"
                    ? "text-emerald-400"
                    : row.lifecycleState === "WEAKENING" || row.lifecycleState === "DROPPED"
                    ? "text-rose-400"
                    : "text-slate-400";
                return (
                  <tr key={row.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                    <td className="py-2 px-3 whitespace-nowrap">{formatDate(row.scanTime)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{row.rank ?? "—"}</td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      <span className={cn("font-medium", getScoreColor(row.score))}>{row.score.toFixed(1)}</span>
                      {scoreDelta != null && (
                        <span className={cn("ml-1 text-[10px]", scoreDelta > 0 ? "text-emerald-500" : scoreDelta < 0 ? "text-rose-500" : "text-slate-600")}>
                          {scoreDelta > 0 ? "+" : ""}{scoreDelta.toFixed(1)}
                        </span>
                      )}
                    </td>
                    <td className={cn("py-2 px-3 text-xs", statusColor)}>
                      {row.lifecycleState.replace(/_/g, " ").toLowerCase()}
                    </td>
                    <td className="py-2 px-3 text-xs text-slate-400">{row.qualificationStatus}</td>
                    <td className="py-2 px-3 text-xs text-slate-500">{row.marketRegime ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compare Panel
// ---------------------------------------------------------------------------

function ComparePanel({
  symbol,
  compareSymbol,
  ranking,
  onClose,
}: {
  symbol: string;
  compareSymbol: string;
  ranking: OpportunityRanking;
  onClose: () => void;
}) {
  const a = findScoredCandidate(symbol, ranking);
  const b = findScoredCandidate(compareSymbol, ranking);

  const scoreA = a?.opportunityScore;
  const scoreB = b?.opportunityScore;

  if (!scoreA || !scoreB) {
    return (
      <Card className="bg-slate-900 border-slate-800 mt-4">
        <CardContent className="py-6 text-center">
          <p className="text-sm text-slate-400">
            {!scoreA ? symbol : compareSymbol} is not in the current ranking.
          </p>
          <Button variant="ghost" size="sm" className="mt-2 text-slate-500" onClick={onClose}>Close</Button>
        </CardContent>
      </Card>
    );
  }

  const metrics: Array<{ label: string; keyA: keyof OpportunityScore }> = [
    { label: "Overall",       keyA: "overallScore" },
    { label: "Technical",     keyA: "technicalScore" },
    { label: "Institutional", keyA: "institutionalScore" },
    { label: "Fundamental",   keyA: "fundamentalScore" },
    { label: "Risk",          keyA: "riskScore" },
    { label: "Regime",        keyA: "regimeScore" },
  ];

  return (
    <Card className="bg-slate-900 border-slate-800 mt-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-slate-300 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-sky-400" />
            {symbol} vs {compareSymbol}
          </span>
          <Button variant="ghost" size="sm" className="h-6 text-xs text-slate-500" onClick={onClose}>✕</Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="grid grid-cols-3 text-xs text-slate-500 uppercase tracking-wide mb-1">
            <span>{symbol}</span>
            <span className="text-center">Metric</span>
            <span className="text-right">{compareSymbol}</span>
          </div>
          {metrics.map(({ label, keyA }) => {
            const va = scoreA[keyA] as number;
            const vb = scoreB[keyA] as number;
            return (
              <div key={label} className="grid grid-cols-3 items-center">
                <span className={cn("text-sm font-medium tabular-nums", getScoreColor(va), va >= vb ? "font-bold" : "")}>{va}</span>
                <span className="text-center text-xs text-slate-500">{label}</span>
                <span className={cn("text-sm font-medium tabular-nums text-right", getScoreColor(vb), vb > va ? "font-bold" : "")}>{vb}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-4 pt-3 border-t border-slate-800 grid grid-cols-2 gap-3 text-center text-xs">
          <div>
            <Badge className={cn("border", getCategoryBadge(scoreA.category))}>{scoreA.category}</Badge>
            <p className="mt-1 text-slate-500">{scoreA.confidence} confidence</p>
          </div>
          <div>
            <Badge className={cn("border", getCategoryBadge(scoreB.category))}>{scoreB.category}</Badge>
            <p className="mt-1 text-slate-500">{scoreB.confidence} confidence</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Related Opportunities
// ---------------------------------------------------------------------------

function RelatedSection({
  symbol,
  ranking,
  onSelect,
}: {
  symbol: string;
  ranking: OpportunityRanking;
  onSelect: (sym: string) => void;
}) {
  const related = useMemo(() => findRelated(symbol, ranking, 4), [symbol, ranking]);

  if (related.length === 0) return null;

  const reasonLabel: Record<string, string> = {
    same_strategy: "Same strategy",
    same_category: "Same category",
    same_bucket:   "Same bucket",
  };

  return (
    <section>
      <h3 className="text-sm font-medium text-slate-400 mb-3">Related Opportunities</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {related.map(r => (
          <button
            key={r.symbol}
            onClick={() => onSelect(r.symbol)}
            className="rounded-lg bg-slate-900 border border-slate-800 p-3 text-left hover:border-slate-600 transition-colors"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold text-slate-200">{r.symbol}</span>
              <span className={cn("text-sm font-bold tabular-nums", getScoreColor(r.overallScore))}>{r.overallScore}</span>
            </div>
            <Badge className={cn("text-[9px] border mb-1", getCategoryBadge(r.category))}>{r.category}</Badge>
            <p className="text-[10px] text-slate-600">{reasonLabel[r.reason] ?? r.reason}</p>
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function OpportunityWorkspacePage() {
  const { symbol: rawSymbol } = useParams<{ symbol: string }>();
  const symbol = (rawSymbol ?? "").toUpperCase();
  const [, navigate] = useLocation();

  const [compareSymbol, setCompareSymbol] = useState<string>("");
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareInput, setCompareInput] = useState("");

  // ── Call 1: full ranking (already cached by dashboard)
  const todayQuery = useQuery<OpportunityTodayResponse>({
    queryKey: ["/api/opportunities/today"],
    staleTime: 5 * 60 * 1000,
  });

  // ── Call 2: workspace enrichment (history + institutional)
  const workspaceQuery = useQuery<WorkspaceResponse>({
    queryKey: ["/api/opportunities/workspace", symbol],
    queryFn: async () => {
      const res = await fetch(`/api/opportunities/workspace/${encodeURIComponent(symbol)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load workspace data");
      return res.json();
    },
    enabled: !!symbol,
    staleTime: 5 * 60 * 1000,
  });

  const ranking = todayQuery.data?.ranking ?? null;
  const candidate = ranking ? findScoredCandidate(symbol, ranking) : null;
  const score = candidate?.opportunityScore ?? null;

  const companyName = workspaceQuery.data?.companyName ?? null;
  const history     = workspaceQuery.data?.history ?? [];
  const institutional    = workspaceQuery.data?.institutional ?? null;
  const changeExplanation = workspaceQuery.data?.changeExplanation ?? null;

  const isLoading = todayQuery.isLoading || workspaceQuery.isLoading;
  const allSymbols = ranking ? getAllRankedSymbols(ranking).filter(s => s !== symbol) : [];

  function handleCompare() {
    const target = compareInput.toUpperCase().trim();
    if (target && target !== symbol) {
      setCompareSymbol(target);
      setCompareOpen(true);
      setCompareInput("");
    }
  }

  function handleRelatedSelect(sym: string) {
    navigate(`/opportunities/${sym}`);
  }

  // ── Loading skeleton
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 p-4 sm:p-6">
        <div className="max-w-3xl mx-auto space-y-4">
          <Skeleton className="h-8 w-32 bg-slate-800" />
          <Skeleton className="h-24 w-full bg-slate-800" />
          <Skeleton className="h-10 w-full bg-slate-800" />
          <Skeleton className="h-64 w-full bg-slate-800" />
        </div>
      </div>
    );
  }

  // ── Not in ranking
  if (!score && !isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 p-4 sm:p-6">
        <div className="max-w-3xl mx-auto">
          <Button variant="ghost" className="mb-4 text-slate-400" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Dashboard
          </Button>
          <Card className="bg-slate-900 border-slate-800">
            <CardContent className="py-16 text-center">
              <Info className="h-10 w-10 text-slate-600 mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-slate-200 mb-2">{symbol} not in current ranking</h2>
              <p className="text-sm text-slate-400 max-w-sm mx-auto">
                {todayQuery.data?.available === false
                  ? todayQuery.data.message ?? "Rankings are being computed."
                  : `${symbol} is not in today's opportunity ranking. It may have been excluded by the scanner or not yet ingested.`}
              </p>
              <Button className="mt-6" onClick={() => navigate("/dashboard")}>Back to Dashboard</Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!score) return null;

  return (
    <div className="min-h-screen bg-slate-950">
      {/* ── Header ── */}
      <div className="sticky top-0 z-40 bg-slate-950/95 backdrop-blur border-b border-slate-800">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <Button variant="ghost" size="sm" className="mb-2 text-slate-400 -ml-2" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
          </Button>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-slate-100">{symbol}</h1>
                {companyName && <span className="text-sm text-slate-400">{companyName}</span>}
              </div>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                <Badge className={cn("text-xs border", getCategoryBadge(score.category))}>{score.category}</Badge>
                <Badge className={cn("text-xs border", getConfidenceBadge(score.confidence))}>
                  {score.confidence} confidence
                </Badge>
                {ranking?.regime && (
                  <Badge className="text-xs border bg-slate-800/60 text-slate-300 border-slate-700">
                    {ranking.regime}
                  </Badge>
                )}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className={cn("text-3xl font-black tabular-nums", getScoreColor(score.overallScore))}>
                {score.overallScore}
              </div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wide">Overall Score</div>
              {ranking && (
                <div className="text-[10px] text-slate-600 mt-0.5">
                  <Clock className="h-3 w-3 inline mr-1" />
                  {formatAge(ranking.generatedAt)}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Score pills summary */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          <ScorePill label="Tech"  score={score.technicalScore} />
          <ScorePill label="Inst"  score={score.institutionalScore} />
          <ScorePill label="Fund"  score={score.fundamentalScore} />
          <ScorePill label="Risk"  score={score.riskScore} />
          <ScorePill label="Regime" score={score.regimeScore} />
        </div>

        {/* Why it changed — Sprint 2.3.1 Change Intelligence panel */}
        {changeExplanation && changeExplanation.direction !== "unchanged" && (
          <WhyItChangedPanel exp={changeExplanation} />
        )}

        {/* Compare controls */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 flex-1">
            <GitCompare className="h-4 w-4 text-slate-500 shrink-0" />
            <input
              list="ranked-symbols"
              value={compareInput}
              onChange={e => setCompareInput(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === "Enter" && handleCompare()}
              placeholder="Compare with… (e.g. AMD)"
              className="flex-1 bg-slate-900 border border-slate-700 rounded-md px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-sky-700"
            />
            <datalist id="ranked-symbols">
              {allSymbols.map(s => <option key={s} value={s} />)}
            </datalist>
            <Button size="sm" variant="outline" className="border-slate-700 text-slate-300 shrink-0" onClick={handleCompare}>
              Compare
            </Button>
          </div>
        </div>

        {compareOpen && compareSymbol && ranking && (
          <ComparePanel
            symbol={symbol}
            compareSymbol={compareSymbol}
            ranking={ranking}
            onClose={() => { setCompareOpen(false); setCompareSymbol(""); }}
          />
        )}

        {/* Tabs */}
        <Tabs defaultValue="overview">
          <TabsList className="bg-slate-900 border border-slate-800 w-full grid grid-cols-5">
            <TabsTrigger value="overview"      className="text-xs data-[state=active]:bg-slate-800">Overview</TabsTrigger>
            <TabsTrigger value="technical"     className="text-xs data-[state=active]:bg-slate-800">Technical</TabsTrigger>
            <TabsTrigger value="institutional" className="text-xs data-[state=active]:bg-slate-800">Institutional</TabsTrigger>
            <TabsTrigger value="risk"          className="text-xs data-[state=active]:bg-slate-800">Risk</TabsTrigger>
            <TabsTrigger value="history"       className="text-xs data-[state=active]:bg-slate-800">History</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            <OverviewTab candidate={candidate} score={score} regime={ranking?.regime ?? null} />
          </TabsContent>
          <TabsContent value="technical" className="mt-4">
            <TechnicalTab candidate={candidate} />
          </TabsContent>
          <TabsContent value="institutional" className="mt-4">
            <InstitutionalTab institutional={institutional} score={score} />
          </TabsContent>
          <TabsContent value="risk" className="mt-4">
            <RiskTab score={score} candidate={candidate} />
          </TabsContent>
          <TabsContent value="history" className="mt-4">
            <HistoryTab history={history} symbol={symbol} />
          </TabsContent>
        </Tabs>

        {/* Related opportunities */}
        {ranking && (
          <RelatedSection symbol={symbol} ranking={ranking} onSelect={handleRelatedSelect} />
        )}

        {/* Footer disclaimer */}
        <p className="text-[11px] text-slate-700 text-center pb-4">
          All scores are algorithmic and educational only. Not financial advice. Scores reflect pattern recognition only — not predictions.
        </p>
      </div>
    </div>
  );
}
