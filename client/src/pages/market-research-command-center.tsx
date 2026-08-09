/**
 * Market Research Command Center — Sprint 2.5.3
 *
 * Primary daily destination answering "What changed today?"
 * without requiring the user to search.
 *
 * 10 sections — each independently loaded from the same snapshot:
 *   Market Overview · Opportunity Changes · Theme Changes · Sector Changes
 *   Institutional Changes · Collection Changes · My Collections
 *   AI Research Summary · Research Timeline · Explain Why
 *
 * Cross navigation into every intelligence surface:
 *   Opportunity Workspace · AI Research Workspace
 *   Theme Research · Sector Research · Collections · Institutional
 */

import { useQuery }       from "@tanstack/react-query";
import { useLocation }    from "wouter";
import { Link }           from "wouter";
import { cn }             from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge }          from "@/components/ui/badge";
import { Button }         from "@/components/ui/button";
import { Skeleton }       from "@/components/ui/skeleton";
import {
  TrendingUp, TrendingDown, Minus, Activity, ArrowRight,
  Building2, Brain, Star, Bookmark, Clock, Sparkles,
  BarChart2, ShieldCheck, Layers, AlertCircle, CheckCircle2,
  ChevronRight, Globe, Search,
} from "lucide-react";
import type {
  CommandCenterDailySnapshot,
  MarketOverviewSection,
  OpportunityChangesSection,
  ThemeChangesSection,
  SectorChangesSection,
  InstitutionalChangesSection,
  CollectionChangesSection,
  MyCollectionsSection,
  AiResearchSummarySection,
  ResearchTimelineSection,
  RelatedResearchLink,
  ConfidenceLevel,
  OpportunityChangeItem,
  ThemeSummaryItem,
  SectorSummaryItem,
  CollectionChangeSummary,
} from "@shared/command-center-types";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function ConfidenceBadge({ confidence }: { confidence: ConfidenceLevel }) {
  const colors: Record<string, string> = {
    high:   "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    medium: "bg-amber-500/15  text-amber-400  border-amber-500/30",
    low:    "bg-slate-500/15  text-slate-400  border-slate-500/30",
  };
  return (
    <Badge variant="outline" className={cn("text-[10px] font-medium", colors[confidence.level])}
           title={confidence.basis}>
      {confidence.level} confidence
    </Badge>
  );
}

function FreshnessBadge({ freshness }: { freshness: string | null }) {
  if (!freshness) return null;
  const dt = new Date(freshness);
  const diffMin = Math.round((Date.now() - dt.getTime()) / 60_000);
  const label = diffMin < 60
    ? `${diffMin}m ago`
    : diffMin < 1440
    ? `${Math.round(diffMin / 60)}h ago`
    : `${Math.round(diffMin / 1440)}d ago`;
  return (
    <Badge variant="outline" className="text-[10px] text-muted-foreground border-border/50">
      <Clock className="h-2.5 w-2.5 mr-1" />
      {label}
    </Badge>
  );
}

function DirectionIcon({ direction }: { direction: "up" | "down" | "stable" }) {
  if (direction === "up")   return <TrendingUp   className="h-3.5 w-3.5 text-emerald-400" />;
  if (direction === "down") return <TrendingDown  className="h-3.5 w-3.5 text-rose-400"   />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

function RelatedLinks({ links }: { links: RelatedResearchLink[] }) {
  const [, navigate] = useLocation();
  if (links.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {links.map(l => (
        <button
          key={l.path}
          onClick={() => navigate(l.path)}
          className="text-[11px] text-primary/70 hover:text-primary flex items-center gap-1 transition-colors"
        >
          <ChevronRight className="h-3 w-3" />
          {l.label}
        </button>
      ))}
    </div>
  );
}

function EvidenceList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="text-[11px] text-muted-foreground space-y-0.5 mt-1">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-1.5">
          <CheckCircle2 className="h-3 w-3 mt-0.5 text-emerald-500/60 shrink-0" />
          {item}
        </li>
      ))}
    </ul>
  );
}

function WhatsNewList({ items, label = "What's New" }: { items: string[]; label?: string }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <ul className="space-y-0.5">
        {items.map((item, i) => (
          <li key={i} className="text-[12px] text-foreground/80 flex items-start gap-1.5">
            <Sparkles className="h-3 w-3 mt-0.5 text-primary/60 shrink-0" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function WhatsChangedList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">What's Changed</p>
      <ul className="space-y-0.5">
        {items.map((item, i) => (
          <li key={i} className="text-[12px] text-foreground/80 flex items-start gap-1.5">
            <Activity className="h-3 w-3 mt-0.5 text-amber-400/60 shrink-0" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionHeader({
  icon: Icon, title, confidence, freshness, badge,
}: {
  icon: React.ElementType;
  title: string;
  confidence?: ConfidenceLevel;
  freshness?: string | null;
  badge?: React.ReactNode;
}) {
  return (
    <CardHeader className="pb-2">
      <CardTitle className="text-sm font-semibold flex items-center gap-2 flex-wrap">
        <Icon className="h-4 w-4 text-primary/70 shrink-0" />
        {title}
        {badge}
        <span className="ml-auto flex items-center gap-1.5">
          {confidence && <ConfidenceBadge confidence={confidence} />}
          {freshness !== undefined && <FreshnessBadge freshness={freshness ?? null} />}
        </span>
      </CardTitle>
    </CardHeader>
  );
}

function UnavailableCard({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 py-4 px-2 text-sm text-muted-foreground">
      <AlertCircle className="h-4 w-4 shrink-0" />
      {message}
    </div>
  );
}

function SkeletonSection() {
  return (
    <Card className="border-border/40">
      <CardContent className="pt-4 space-y-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section: Market Overview
// ---------------------------------------------------------------------------

function MarketOverviewSection({ data }: { data: MarketOverviewSection }) {
  const healthColor =
    data.marketHealthLabel === "Strong"  ? "text-emerald-400" :
    data.marketHealthLabel === "Moderate"? "text-amber-400"   :
    data.marketHealthLabel === "Weak"    ? "text-rose-400"    :
    "text-muted-foreground";

  return (
    <Card className="border-border/40" data-testid="cmd-market-overview">
      <SectionHeader
        icon={Globe}
        title="Market Overview"
        confidence={data.confidence}
        freshness={data.freshness}
      />
      <CardContent className="space-y-4">
        {!data.hasData ? (
          <UnavailableCard message="Market snapshots not yet computed. Check Intelligence Hub." />
        ) : (
          <>
            {/* Market health summary */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/30">
              <div>
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Market Health</p>
                <p className={cn("text-xl font-bold", healthColor)}>{data.marketHealthLabel}</p>
                {data.regime && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">Regime: {data.regime}</p>
                )}
              </div>
              {data.marketHealth != null && (
                <div className="ml-auto text-right">
                  <p className="text-[10px] text-muted-foreground">Score</p>
                  <p className={cn("text-2xl font-bold tabular-nums", healthColor)}>{data.marketHealth}</p>
                </div>
              )}
            </div>

            {/* Leading themes row */}
            {data.leadingThemes.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Leading Themes</p>
                <div className="flex flex-wrap gap-1.5">
                  {data.leadingThemes.slice(0, 5).map(t => (
                    <Link key={t.themeId} href={`/intelligence/themes/${t.themeId}`}>
                      <Badge variant="outline" className="cursor-pointer hover:bg-muted/60 transition-colors gap-1">
                        <DirectionIcon direction={t.direction} />
                        {t.themeName}
                        <span className="text-muted-foreground ml-1">{t.score}</span>
                      </Badge>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Leading sectors row */}
            {data.leadingSectors.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Leading Sectors</p>
                <div className="flex flex-wrap gap-1.5">
                  {data.leadingSectors.slice(0, 5).map(s => (
                    <Link key={s.sector} href={`/intelligence/sectors/${encodeURIComponent(s.sector)}`}>
                      <Badge variant="outline" className="cursor-pointer hover:bg-muted/60 transition-colors gap-1">
                        <DirectionIcon direction={s.direction} />
                        {s.label}
                        <span className="text-muted-foreground ml-1">{s.score}</span>
                      </Badge>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <WhatsNewList items={data.whatsNew} />
              <WhatsChangedList items={data.whatsChanged} />
            </div>
            <EvidenceList items={data.evidence} />
            <RelatedLinks links={data.relatedResearch} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section: Opportunity Changes
// ---------------------------------------------------------------------------

function ChangeTypeBadge({ type }: { type: OpportunityChangeItem["changeType"] }) {
  const map: Record<string, { label: string; cls: string }> = {
    major_mover: { label: "Major Move",  cls: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
    upgrade:     { label: "Upgraded",    cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    downgrade:   { label: "Downgraded",  cls: "bg-rose-500/15 text-rose-400 border-rose-500/30" },
    new:         { label: "New Entry",   cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
    removed:     { label: "Removed",     cls: "bg-slate-500/15 text-slate-400 border-slate-500/30" },
  };
  const m = map[type] ?? { label: type, cls: "" };
  return <Badge variant="outline" className={cn("text-[10px]", m.cls)}>{m.label}</Badge>;
}

function OpportunityChangeRow({ item }: { item: OpportunityChangeItem }) {
  const [, navigate] = useLocation();
  return (
    <div
      className="flex items-start gap-2 py-2 border-b border-border/30 last:border-0 group cursor-pointer hover:bg-muted/20 rounded px-1 transition-colors"
      onClick={() => navigate(`/opportunities/${item.symbol}`)}
      role="button"
      tabIndex={0}
      onKeyDown={e => (e.key === "Enter" || e.key === " ") && navigate(`/opportunities/${item.symbol}`)}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-sm">{item.symbol}</span>
          <ChangeTypeBadge type={item.changeType} />
          <Badge variant="outline" className="text-[10px] text-muted-foreground">
            {item.importance}
          </Badge>
        </div>
        <p className="text-[12px] text-muted-foreground mt-0.5 line-clamp-2">{item.explanation}</p>
        {item.drivers.length > 0 && (
          <p className="text-[11px] text-primary/60 mt-0.5">
            Drivers: {item.drivers.slice(0, 2).join(" · ")}
          </p>
        )}
      </div>
      {item.scoreDelta != null && (
        <div className="text-right shrink-0">
          <span className={cn(
            "text-sm font-bold tabular-nums",
            item.scoreDelta > 0 ? "text-emerald-400" : item.scoreDelta < 0 ? "text-rose-400" : "text-muted-foreground",
          )}>
            {item.scoreDelta > 0 ? "+" : ""}{item.scoreDelta.toFixed(1)}
          </span>
        </div>
      )}
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary/60 transition-colors shrink-0 mt-1" />
    </div>
  );
}

function OpportunityChangesSection({ data }: { data: OpportunityChangesSection }) {
  const totalBadge = data.totalChanged > 0 ? (
    <Badge className="ml-1 text-[10px]">{data.totalChanged} changes</Badge>
  ) : null;

  return (
    <Card className="border-border/40" data-testid="cmd-opp-changes">
      <SectionHeader
        icon={Activity}
        title="Opportunity Changes"
        confidence={data.confidence}
        freshness={data.freshness}
        badge={totalBadge}
      />
      <CardContent className="space-y-4">
        {!data.available ? (
          <UnavailableCard message="Opportunity ranking not yet available. Waiting for first scan." />
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <WhatsNewList items={data.whatsNew} />
              <WhatsChangedList items={data.whatsChanged} />
            </div>

            {/* Major Movers */}
            {data.majorMovers.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Major Movers</p>
                {data.majorMovers.slice(0, 5).map(item => (
                  <OpportunityChangeRow key={item.symbol} item={item} />
                ))}
              </div>
            )}

            {/* New Entries */}
            {data.newEntries.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">New Entries</p>
                {data.newEntries.slice(0, 5).map(item => (
                  <OpportunityChangeRow key={item.symbol} item={item} />
                ))}
              </div>
            )}

            {/* Upgrades */}
            {data.upgrades.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Upgrades</p>
                {data.upgrades.slice(0, 4).map(item => (
                  <OpportunityChangeRow key={item.symbol} item={item} />
                ))}
              </div>
            )}

            {/* Downgrades */}
            {data.downgrades.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Downgrades</p>
                {data.downgrades.slice(0, 4).map(item => (
                  <OpportunityChangeRow key={item.symbol} item={item} />
                ))}
              </div>
            )}

            {/* Removed */}
            {data.removed.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Left Qualified Set</p>
                {data.removed.slice(0, 3).map(item => (
                  <OpportunityChangeRow key={item.symbol} item={item} />
                ))}
              </div>
            )}

            {data.majorMovers.length === 0 && data.newEntries.length === 0 && data.upgrades.length === 0 && (
              <p className="text-sm text-muted-foreground py-2">No significant changes detected since last scan.</p>
            )}

            <EvidenceList items={data.evidence} />
            <RelatedLinks links={data.relatedResearch} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section: Theme Changes
// ---------------------------------------------------------------------------

function ThemeRow({ theme }: { theme: ThemeSummaryItem }) {
  return (
    <Link href={`/intelligence/themes/${theme.themeId}`}>
      <div className="flex items-center gap-2 py-2 border-b border-border/30 last:border-0 hover:bg-muted/20 rounded px-1 transition-colors cursor-pointer">
        <DirectionIcon direction={theme.direction} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{theme.themeName}</p>
          {theme.topSymbols.length > 0 && (
            <p className="text-[11px] text-muted-foreground">{theme.topSymbols.join(" · ")}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <span className="text-sm font-bold tabular-nums">{theme.score}</span>
          {theme.scoreDelta != null && (
            <p className={cn(
              "text-[10px] tabular-nums",
              theme.scoreDelta > 0 ? "text-emerald-400" : theme.scoreDelta < 0 ? "text-rose-400" : "text-muted-foreground",
            )}>
              {theme.scoreDelta > 0 ? "+" : ""}{theme.scoreDelta.toFixed(1)}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

function ThemeChangesSection({ data }: { data: ThemeChangesSection }) {
  return (
    <Card className="border-border/40" data-testid="cmd-theme-changes">
      <SectionHeader
        icon={Layers}
        title="Theme Changes"
        confidence={data.confidence}
        freshness={data.freshness}
      />
      <CardContent className="space-y-3">
        {!data.hasData ? (
          <UnavailableCard message="Theme snapshots not yet computed. Run an intelligence rebuild." />
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <WhatsNewList items={data.whatsNew} />
              <WhatsChangedList items={data.whatsChanged} />
            </div>
            <div className="max-h-64 overflow-y-auto">
              {data.themes.map(t => <ThemeRow key={t.themeId} theme={t} />)}
            </div>
            <EvidenceList items={data.evidence} />
            <RelatedLinks links={data.relatedResearch} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section: Sector Changes
// ---------------------------------------------------------------------------

function SectorRow({ sector }: { sector: SectorSummaryItem }) {
  return (
    <Link href={`/intelligence/sectors/${encodeURIComponent(sector.sector)}`}>
      <div className="flex items-center gap-2 py-2 border-b border-border/30 last:border-0 hover:bg-muted/20 rounded px-1 transition-colors cursor-pointer">
        <DirectionIcon direction={sector.direction} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{sector.label}</p>
          {sector.topSymbols.length > 0 && (
            <p className="text-[11px] text-muted-foreground">{sector.topSymbols.join(" · ")}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <span className="text-sm font-bold tabular-nums">{sector.score}</span>
          {sector.scoreDelta != null && (
            <p className={cn(
              "text-[10px] tabular-nums",
              sector.scoreDelta > 0 ? "text-emerald-400" : sector.scoreDelta < 0 ? "text-rose-400" : "text-muted-foreground",
            )}>
              {sector.scoreDelta > 0 ? "+" : ""}{sector.scoreDelta.toFixed(1)}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

function SectorChangesSection({ data }: { data: SectorChangesSection }) {
  return (
    <Card className="border-border/40" data-testid="cmd-sector-changes">
      <SectionHeader
        icon={BarChart2}
        title="Sector Changes"
        confidence={data.confidence}
        freshness={data.freshness}
      />
      <CardContent className="space-y-3">
        {!data.hasData ? (
          <UnavailableCard message="Sector snapshots not yet computed. Run an intelligence rebuild." />
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <WhatsNewList items={data.whatsNew} />
              <WhatsChangedList items={data.whatsChanged} />
            </div>
            <div>
              {data.sectors.map(s => <SectorRow key={s.sector} sector={s} />)}
            </div>
            <EvidenceList items={data.evidence} />
            <RelatedLinks links={data.relatedResearch} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section: Institutional Changes
// ---------------------------------------------------------------------------

function InstitutionalChangesSection({ data }: { data: InstitutionalChangesSection }) {
  const [, navigate] = useLocation();
  return (
    <Card className="border-border/40" data-testid="cmd-institutional-changes">
      <SectionHeader
        icon={Building2}
        title="Institutional Changes"
        confidence={data.confidence}
        freshness={data.freshness}
      />
      <CardContent className="space-y-3">
        {!data.available ? (
          <UnavailableCard message="Institutional data not available. Enable INSTITUTIONAL_INTELLIGENCE_ENABLED." />
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <WhatsNewList items={data.whatsNew} />
              <WhatsChangedList items={data.whatsChanged} />
            </div>

            <div>
              {data.recentSignals.slice(0, 8).map((sig, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 py-2 border-b border-border/30 last:border-0 hover:bg-muted/20 rounded px-1 cursor-pointer transition-colors"
                  onClick={() => navigate(`/opportunities/${sig.symbol}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => (e.key === "Enter" || e.key === " ") && navigate(`/opportunities/${sig.symbol}`)}
                >
                  <ShieldCheck className={cn(
                    "h-4 w-4 mt-0.5 shrink-0",
                    sig.magnitude === "high"   ? "text-emerald-400" :
                    sig.magnitude === "medium" ? "text-amber-400"   : "text-muted-foreground",
                  )} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm">{sig.symbol}</span>
                      <Badge variant="outline" className="text-[10px]">{sig.signalType}</Badge>
                      <Badge variant="outline" className={cn(
                        "text-[10px]",
                        sig.magnitude === "high"   ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" :
                        sig.magnitude === "medium" ? "bg-amber-500/10  text-amber-400  border-amber-500/30"    :
                                                     "bg-slate-500/10  text-slate-400  border-slate-500/30",
                      )}>
                        {sig.magnitude}
                      </Badge>
                    </div>
                    <p className="text-[12px] text-muted-foreground mt-0.5 line-clamp-1">{sig.detail}</p>
                  </div>
                </div>
              ))}
              {data.recentSignals.length === 0 && (
                <p className="text-sm text-muted-foreground py-2">No institutional signals available yet.</p>
              )}
            </div>

            <EvidenceList items={data.evidence} />
            <RelatedLinks links={data.relatedResearch} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section: Collection Changes
// ---------------------------------------------------------------------------

function CollectionCard({ c }: { c: CollectionChangeSummary }) {
  const [, navigate] = useLocation();
  return (
    <div
      className="p-3 rounded-lg border border-border/40 hover:bg-muted/20 transition-colors cursor-pointer"
      onClick={() => navigate(`/research?collection=${c.id}`)}
      role="button"
      tabIndex={0}
      onKeyDown={e => (e.key === "Enter" || e.key === " ") && navigate(`/research?collection=${c.id}`)}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium truncate">{c.name}</p>
        <Badge variant="outline" className="text-[10px] shrink-0">
          {c.opportunityCount} candidates
        </Badge>
      </div>
      {c.collectionType === "system" && (
        <p className="text-[10px] text-muted-foreground mt-0.5">System Collection</p>
      )}
    </div>
  );
}

function CollectionChangesSection({ data }: { data: CollectionChangesSection }) {
  return (
    <Card className="border-border/40" data-testid="cmd-collection-changes">
      <SectionHeader
        icon={Layers}
        title="Collection Changes"
        confidence={data.confidence}
        freshness={data.freshness}
      />
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <WhatsNewList items={data.whatsNew} />
          <WhatsChangedList items={data.whatsChanged} />
        </div>

        {data.collections.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {data.collections.slice(0, 8).map(c => (
              <CollectionCard key={c.id} c={c} />
            ))}
          </div>
        ) : (
          <UnavailableCard message="No collections found. System collections seed on first startup." />
        )}

        <EvidenceList items={data.evidence} />
        <RelatedLinks links={data.relatedResearch} />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section: My Collections
// ---------------------------------------------------------------------------

function MyCollectionsSection({ data }: { data: MyCollectionsSection }) {
  const [, navigate] = useLocation();

  const renderGroup = (label: string, items: CollectionChangeSummary[], icon: React.ElementType) => {
    if (items.length === 0) return null;
    const Icon = icon;
    return (
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
          <Icon className="h-3 w-3" /> {label}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {items.slice(0, 5).map(c => (
            <Badge
              key={c.id}
              variant="outline"
              className="cursor-pointer hover:bg-muted/60 transition-colors gap-1"
              onClick={() => navigate(`/research?collection=${c.id}`)}
            >
              {c.name}
              <span className="text-muted-foreground">{c.opportunityCount}</span>
            </Badge>
          ))}
        </div>
      </div>
    );
  };

  return (
    <Card className="border-border/40" data-testid="cmd-my-collections">
      <SectionHeader
        icon={Bookmark}
        title="My Collections"
      />
      <CardContent className="space-y-3">
        {data.total === 0 ? (
          <UnavailableCard message="No collections yet. Browse the Research Hub to follow collections." />
        ) : (
          <>
            {renderGroup("Pinned", data.pinned, Star)}
            {renderGroup("Favorites", data.favorites, Star)}
            {renderGroup("Following", data.followed, Bookmark)}
            {renderGroup("System Highlights", data.systemHighlights, Layers)}

            <RelatedLinks links={data.relatedResearch} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section: AI Research Summary
// ---------------------------------------------------------------------------

function AiResearchSummarySection({ data }: { data: AiResearchSummarySection }) {
  const [, navigate] = useLocation();
  return (
    <Card className="border-border/40" data-testid="cmd-ai-research-summary">
      <SectionHeader
        icon={Brain}
        title="AI Research Summary"
        confidence={data.confidence}
      />
      <CardContent className="space-y-4">
        {/* Stats */}
        {data.available && (
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-muted/30 border border-border/30 text-center">
              <p className="text-xl font-bold">{data.recentConversationCount}</p>
              <p className="text-[11px] text-muted-foreground">Conversations</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30 border border-border/30 text-center">
              <p className="text-xl font-bold">{data.pinnedConversationCount}</p>
              <p className="text-[11px] text-muted-foreground">Pinned</p>
            </div>
          </div>
        )}

        <WhatsNewList items={data.whatsNew} />

        {/* Suggested queries */}
        {data.suggestedQueries.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Suggested Research Queries</p>
            <div className="space-y-1.5">
              {data.suggestedQueries.slice(0, 3).map((q, i) => (
                <button
                  key={i}
                  onClick={() => navigate(`/research-workspace?mode=${q.mode}&scope=${q.scope}`)}
                  className="w-full text-left p-2.5 rounded-lg border border-border/40 hover:bg-muted/40 transition-colors group"
                >
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-primary/60 shrink-0 group-hover:text-primary transition-colors" />
                    <div>
                      <p className="text-[12px] font-medium">{q.label}</p>
                      <p className="text-[11px] text-muted-foreground">{q.description}</p>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary/60 transition-colors ml-auto shrink-0" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <EvidenceList items={data.evidence} />
        <RelatedLinks links={data.relatedResearch} />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section: Research Timeline
// ---------------------------------------------------------------------------

function ResearchTimelineSection({ data }: { data: ResearchTimelineSection }) {
  const [, navigate] = useLocation();
  return (
    <Card className="border-border/40" data-testid="cmd-research-timeline">
      <SectionHeader
        icon={Clock}
        title="Research Timeline"
      />
      <CardContent className="space-y-2">
        {!data.available || data.items.length === 0 ? (
          <div className="space-y-2">
            <UnavailableCard message="No research conversations yet. Start a session in the AI Workspace." />
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => navigate("/research-workspace")}
            >
              <Brain className="h-3.5 w-3.5 mr-1.5" />
              Open AI Research Workspace
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-0">
              {data.items.map(item => (
                <div
                  key={item.id}
                  className="flex items-start gap-2 py-2.5 border-b border-border/30 last:border-0 hover:bg-muted/20 rounded px-1 transition-colors cursor-pointer group"
                  onClick={() => navigate(`/research-workspace?conversation=${item.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => (e.key === "Enter" || e.key === " ") && navigate(`/research-workspace?conversation=${item.id}`)}
                >
                  {item.isPinned && <Star className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {item.researchMode} · {item.contextScope}
                    </p>
                  </div>
                  <p className="text-[10px] text-muted-foreground shrink-0">
                    {new Date(item.lastMessageAt).toLocaleDateString()}
                  </p>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary/60 transition-colors shrink-0 mt-1" />
                </div>
              ))}
            </div>
            <RelatedLinks links={data.relatedResearch} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Section: Explain Why (gateway into AI Workspace)
// ---------------------------------------------------------------------------

function ExplainWhySection() {
  const [, navigate] = useLocation();
  return (
    <Card className="border-border/40 bg-gradient-to-br from-primary/5 to-transparent" data-testid="cmd-explain-why">
      <SectionHeader icon={Search} title="Explain Why" />
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Ask the AI Research Workspace to explain any change, candidate, theme, or sector movement in depth.
          The AI synthesizes evidence across the full intelligence stack — never invents data.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            { label: "Why did this candidate qualify?",      mode: "company",      scope: "entire_market"  },
            { label: "What drives this theme's strength?",   mode: "theme",        scope: "ai-infrastructure" },
            { label: "Which sector is leading today?",       mode: "sector",       scope: "entire_market"  },
            { label: "What are institutions accumulating?",  mode: "institutional", scope: "entire_market" },
            { label: "Compare two candidates side by side",  mode: "comparison",   scope: "entire_market"  },
            { label: "Summarize today's market intelligence",mode: "market",       scope: "entire_market"  },
          ].map((item, i) => (
            <button
              key={i}
              onClick={() => navigate(`/research-workspace?mode=${item.mode}&scope=${item.scope}`)}
              className="text-left p-2.5 rounded-lg border border-border/40 hover:bg-muted/40 transition-colors group flex items-center gap-2"
            >
              <Sparkles className="h-3.5 w-3.5 text-primary/60 group-hover:text-primary shrink-0 transition-colors" />
              <span className="text-[12px]">{item.label}</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary/60 ml-auto shrink-0 transition-colors" />
            </button>
          ))}
        </div>

        <Button
          className="w-full"
          onClick={() => navigate("/research-workspace")}
        >
          <Brain className="h-4 w-4 mr-2" />
          Open AI Research Workspace
        </Button>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page skeleton (while loading)
// ---------------------------------------------------------------------------

function PageSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 4 }).map((_, i) => <SkeletonSection key={i} />)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function MarketResearchCommandCenterPage() {
  const { data, isLoading, error } = useQuery<CommandCenterDailySnapshot>({
    queryKey:      ["/api/command-center/daily"],
    refetchInterval: 5 * 60_000,   // refresh every 5 minutes
    staleTime:     2 * 60_000,
  });

  const [, navigate] = useLocation();

  return (
    <div className="flex-1 overflow-auto">
      <div className="w-full max-w-6xl mx-auto px-4 md:px-8 py-5 md:py-6 space-y-5">

        {/* Page header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight" data-testid="cmd-center-title">
              Market Research Command Center
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              What changed today — across every intelligence surface
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate("/research-workspace")}>
              <Brain className="h-3.5 w-3.5 mr-1.5" />
              AI Workspace
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/intelligence")}>
              <BarChart2 className="h-3.5 w-3.5 mr-1.5" />
              Intelligence
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/research")}>
              <Search className="h-3.5 w-3.5 mr-1.5" />
              Research Hub
            </Button>
          </div>
        </div>

        {/* Error state */}
        {error && (
          <Card className="border-rose-500/30 bg-rose-500/5">
            <CardContent className="pt-4 flex items-center gap-2 text-sm text-rose-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Failed to load command center. The intelligence stack may still be computing.
            </CardContent>
          </Card>
        )}

        {/* Loading */}
        {isLoading && <PageSkeleton />}

        {/* Content */}
        {data && !isLoading && (
          <div className="space-y-4">
            {/* Row 1: Market Overview (full width) */}
            <MarketOverviewSection data={data.marketOverview} />

            {/* Row 2: Opportunity Changes (full width — most important) */}
            <OpportunityChangesSection data={data.opportunityChanges} />

            {/* Row 3: Theme + Sector Changes (side by side on wide screens) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ThemeChangesSection   data={data.themeChanges} />
              <SectorChangesSection  data={data.sectorChanges} />
            </div>

            {/* Row 4: Institutional Changes + Collection Changes */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <InstitutionalChangesSection data={data.institutionalChanges} />
              <CollectionChangesSection    data={data.collectionChanges} />
            </div>

            {/* Row 5: My Collections + AI Research Summary */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <MyCollectionsSection      data={data.myCollections} />
              <AiResearchSummarySection  data={data.aiResearchSummary} />
            </div>

            {/* Row 6: Research Timeline + Explain Why */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ResearchTimelineSection data={data.researchTimeline} />
              <ExplainWhySection />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
