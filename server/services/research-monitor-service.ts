/**
 * Research Monitor Service — Sprint 2.5.4
 *
 * Continuous Research Monitoring & Daily Intelligence Feed
 *
 * RULES:
 * - No recomputation. All reads from existing precomputed stores.
 * - No LLM invocation.
 * - No new market data fetches.
 * - Deterministic change detection from precomputed intelligence.
 * - Compliance: never recommend, advise, predict, or guarantee.
 */

import { db } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  researchWatches,
  watchActivityLog,
  type ResearchWatchRow,
  type InsertResearchWatch,
  type InsertWatchActivity,
  type WatchActivityRow,
} from "../../shared/schema";
import type {
  ResearchWatch,
  WatchActivityEntry,
  WatchEvaluation,
  WatchCurrentStatus,
  ResearchWatchDetail,
  RelatedCandidate,
  DailyResearchFeed,
  FeedSection,
  FeedItem,
  FeedSummary,
  CreateWatchInput,
  UpdateWatchInput,
  WatchActivityType,
  ChangeDirection,
  WatchChangeSummary,
  ResearchMonitoringHealth,
  MyWatchChangesSection,
} from "../../shared/research-monitor-types";
import { getLatestRanking } from "./opportunity-ranking-engine";
import { getLatestThemeSnapshots, getLatestSectorSnapshots } from "./intelligence-snapshot-store";
import { getCanonicalOpportunity, getOpportunityIntelligence } from "./opportunity-intelligence-service";

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const log = (event: string, data?: Record<string, unknown>) =>
  console.log(JSON.stringify({ event: `[research-monitor] ${event}`, ts: new Date().toISOString(), ...data }));

// ---------------------------------------------------------------------------
// Helpers — row ↔ domain
// ---------------------------------------------------------------------------

function rowToWatch(row: ResearchWatchRow): ResearchWatch {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    watchType: row.watchType as ResearchWatch["watchType"],
    entityId: row.entityId ?? null,
    entityLabel: row.entityLabel ?? null,
    status: row.status as ResearchWatch["status"],
    lastEvaluatedAt: row.lastEvaluatedAt ?? null,
    lastChangeAt: row.lastChangeAt ?? null,
    lastChangeType: (row.lastChangeType ?? null) as WatchActivityType | null,
    lastChangeSummary: row.lastChangeSummary ?? null,
    notifyEmail: row.notifyEmail,
    notifyPush: row.notifyPush,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToActivity(row: WatchActivityRow): WatchActivityEntry {
  return {
    id: row.id,
    watchId: row.watchId,
    userId: row.userId,
    activityType: row.activityType as WatchActivityType,
    entitySymbol: row.entitySymbol ?? null,
    entityLabel: row.entityLabel ?? null,
    changeDirection: (row.changeDirection ?? null) as ChangeDirection | null,
    changeData: (row.changeData ?? null) as Record<string, unknown> | null,
    observedAt: row.observedAt,
  };
}

function freshnessSummary(lastUpdated: string | null): string | null {
  if (!lastUpdated) return null;
  const diffMs = Date.now() - new Date(lastUpdated).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 2) return "Just updated";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// CRUD — Watches
// ---------------------------------------------------------------------------

export async function createWatch(userId: string, input: CreateWatchInput): Promise<ResearchWatch> {
  const row: InsertResearchWatch = {
    userId,
    name: input.name.trim().slice(0, 100),
    watchType: input.watchType,
    entityId: input.entityId?.trim().toUpperCase().slice(0, 50) ?? null,
    entityLabel: input.entityLabel?.trim().slice(0, 100) ?? null,
    status: "active",
    notifyEmail: false,
    notifyPush: false,
  };
  const [inserted] = await db.insert(researchWatches).values(row).returning();
  log("watch_created", { userId, watchType: input.watchType, entityId: input.entityId });
  return rowToWatch(inserted);
}

export async function listWatches(userId: string, includeArchived = false): Promise<ResearchWatch[]> {
  const rows = includeArchived
    ? await db.select().from(researchWatches).where(eq(researchWatches.userId, userId)).orderBy(desc(researchWatches.createdAt))
    : await db.select().from(researchWatches).where(
        and(eq(researchWatches.userId, userId), sql`${researchWatches.status} != 'archived'`)
      ).orderBy(desc(researchWatches.createdAt));
  return rows.map(rowToWatch);
}

export async function getWatchById(watchId: string, userId: string): Promise<ResearchWatch | null> {
  const [row] = await db.select().from(researchWatches).where(
    and(eq(researchWatches.id, watchId), eq(researchWatches.userId, userId))
  );
  return row ? rowToWatch(row) : null;
}

export async function updateWatch(watchId: string, userId: string, input: UpdateWatchInput): Promise<ResearchWatch | null> {
  const updates: Partial<InsertResearchWatch> = {};
  if (input.name !== undefined)        updates.name = input.name.trim().slice(0, 100);
  if (input.status !== undefined)      updates.status = input.status;
  if (input.notifyEmail !== undefined) updates.notifyEmail = input.notifyEmail;
  if (input.notifyPush !== undefined)  updates.notifyPush = input.notifyPush;
  if (Object.keys(updates).length === 0) return getWatchById(watchId, userId);
  updates.updatedAt = new Date();
  const [updated] = await db.update(researchWatches)
    .set(updates)
    .where(and(eq(researchWatches.id, watchId), eq(researchWatches.userId, userId)))
    .returning();
  return updated ? rowToWatch(updated) : null;
}

export async function deleteWatch(watchId: string, userId: string): Promise<boolean> {
  // Soft delete: archive. Activity log is retained.
  const [updated] = await db.update(researchWatches)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(researchWatches.id, watchId), eq(researchWatches.userId, userId)))
    .returning();
  return !!updated;
}

// ---------------------------------------------------------------------------
// Activity Log
// ---------------------------------------------------------------------------

export async function getWatchActivity(
  watchId: string,
  userId: string,
  limit = 20,
): Promise<WatchActivityEntry[]> {
  const rows = await db.select().from(watchActivityLog)
    .where(and(eq(watchActivityLog.watchId, watchId), eq(watchActivityLog.userId, userId)))
    .orderBy(desc(watchActivityLog.observedAt))
    .limit(limit);
  return rows.map(rowToActivity);
}

async function writeActivity(entry: Omit<InsertWatchActivity, "id">): Promise<WatchActivityEntry> {
  const [row] = await db.insert(watchActivityLog).values(entry).returning();
  return rowToActivity(row);
}

// ---------------------------------------------------------------------------
// Watch Evaluation — pure reads from precomputed stores
// ---------------------------------------------------------------------------

/**
 * Evaluate a single watch against current precomputed intelligence.
 * Returns a WatchEvaluation with the current status and any detected changes.
 * Writes to watch_activity_log if a meaningful change is detected.
 * Updates last_evaluated_at on the watch row.
 */
export async function evaluateWatch(watchId: string, userId: string): Promise<WatchEvaluation | null> {
  const watch = await getWatchById(watchId, userId);
  if (!watch || watch.status !== "active") return null;

  const now = new Date().toISOString();
  let evaluation: WatchEvaluation;

  try {
    evaluation = await _evaluateByType(watch, now);
  } catch (err: any) {
    log("evaluate_error", { watchId, error: err?.message });
    return null;
  }

  // Write activity entry (including stable/unchanged)
  const actRow: Omit<InsertWatchActivity, "id"> = {
    watchId,
    userId,
    activityType: evaluation.changeType,
    entitySymbol: watch.entityId?.toUpperCase() ?? null,
    entityLabel: watch.entityLabel,
    changeDirection: evaluation.changeDirection,
    changeData: {
      summary: evaluation.changeSummary,
      ...evaluation.currentStatus,
    },
    observedAt: new Date(now),
  };
  const savedEntry = await writeActivity(actRow);
  evaluation.activityEntries = [savedEntry];

  // Update watch row
  const updatePayload: Partial<InsertResearchWatch> = {
    lastEvaluatedAt: new Date(now),
    updatedAt: new Date(now),
  };
  if (evaluation.changed) {
    updatePayload.lastChangeAt = new Date(now);
    updatePayload.lastChangeType = evaluation.changeType;
    updatePayload.lastChangeSummary = evaluation.changeSummary;
  }
  await db.update(researchWatches)
    .set(updatePayload)
    .where(and(eq(researchWatches.id, watchId), eq(researchWatches.userId, userId)));

  return evaluation;
}

async function _evaluateByType(watch: ResearchWatch, now: string): Promise<WatchEvaluation> {
  const base: Omit<WatchEvaluation, "currentStatus" | "changed" | "changeType" | "changeDirection" | "changeSummary"> = {
    watchId: watch.id,
    evaluatedAt: now,
    activityEntries: [],
  };

  switch (watch.watchType) {
    case "company": return _evalCompany(watch, base, now);
    case "theme": return _evalTheme(watch, base, now);
    case "sector": return _evalSector(watch, base, now);
    case "market_regime": return _evalRegime(watch, base, now);
    case "growth_candidates":
    case "income_candidates":
    case "momentum":
    case "etf_candidates":
    case "dividend_candidates":
    case "opportunity_type": return _evalOpportunityType(watch, base, now);
    case "institutional_activity": return _evalInstitutional(watch, base, now);
    case "collection":
    case "custom_collection": return _evalCollection(watch, base, now);
    default: return { ...base, changed: false, changeType: "status_unchanged", changeDirection: null, changeSummary: "Watch type evaluation not yet available", currentStatus: { lastUpdated: null } };
  }
}

async function _evalCompany(watch: ResearchWatch, base: any, _now: string): Promise<WatchEvaluation> {
  const symbol = watch.entityId;
  if (!symbol) return _stableEval(base, "No symbol configured");
  const opp = await getCanonicalOpportunity(symbol);
  if (!opp) {
    return {
      ...base,
      changed: true,
      changeType: "candidate_removed",
      changeDirection: "removed",
      changeSummary: `${symbol} is no longer a qualified research candidate`,
      currentStatus: { isQualified: false, lastUpdated: null },
    };
  }
  const currentStatus: WatchCurrentStatus = {
    score: opp.researchScore,
    confidence: opp.confidence,
    label: opp.opportunityTypeLabel,
    isQualified: true,
    opportunityType: opp.opportunityType,
    lastUpdated: opp.lastUpdated,
    freshnessSec: opp.lastUpdated ? Math.floor((Date.now() - new Date(opp.lastUpdated).getTime()) / 1000) : null,
  };
  // Compare to last activity for this watch
  const lastActivity = await getWatchActivity(watch.id, watch.userId, 1);
  const lastData = lastActivity[0]?.changeData as Record<string, unknown> | null;
  const lastScore = lastData?.score as number | undefined;
  const delta = lastScore !== undefined ? (opp.researchScore - lastScore) : 0;
  const threshold = 5;
  if (lastScore === undefined) {
    return { ...base, changed: true, changeType: "new_candidate", changeDirection: "new", changeSummary: `${symbol} added to research monitoring`, currentStatus };
  }
  if (delta >= threshold) {
    return { ...base, changed: true, changeType: "score_improved", changeDirection: "improved", changeSummary: `${symbol} research score improved by ${delta} points (now ${opp.researchScore})`, currentStatus };
  }
  if (delta <= -threshold) {
    return { ...base, changed: true, changeType: "score_weakened", changeDirection: "weakened", changeSummary: `${symbol} research score declined by ${Math.abs(delta)} points (now ${opp.researchScore})`, currentStatus };
  }
  return _stableEval(base, `${symbol} score unchanged at ${opp.researchScore}`, currentStatus);
}

async function _evalTheme(watch: ResearchWatch, base: any, _now: string): Promise<WatchEvaluation> {
  const themeId = watch.entityId;
  const themes = await getLatestThemeSnapshots();
  const theme = themes.find(t => (t as any).themeId === themeId || (t as any).theme_id === themeId || (t as any).themeId?.toLowerCase() === themeId?.toLowerCase());
  if (!theme) return _stableEval(base, "Theme data not yet available");
  const score = (theme as any).score ?? 0;
  const currentStatus: WatchCurrentStatus = {
    score,
    label: (theme as any).label ?? null,
    memberCount: (theme as any).metrics?.memberCount ?? null,
    lastUpdated: (theme as any).generatedAt ?? null,
  };
  const lastActivity = await getWatchActivity(watch.id, watch.userId, 1);
  const lastData = lastActivity[0]?.changeData as Record<string, unknown> | null;
  const lastScore = lastData?.score as number | undefined;
  if (lastScore === undefined) return { ...base, changed: true, changeType: "theme_improved", changeDirection: "new", changeSummary: `${watch.entityLabel ?? themeId} theme monitoring started`, currentStatus };
  const delta = score - lastScore;
  if (delta >= 5) return { ...base, changed: true, changeType: "theme_improved", changeDirection: "improved", changeSummary: `${watch.entityLabel ?? themeId} theme score improved to ${score}`, currentStatus };
  if (delta <= -5) return { ...base, changed: true, changeType: "theme_weakened", changeDirection: "weakened", changeSummary: `${watch.entityLabel ?? themeId} theme score weakened to ${score}`, currentStatus };
  return _stableEval(base, `${watch.entityLabel ?? themeId} theme score stable at ${score}`, currentStatus);
}

async function _evalSector(watch: ResearchWatch, base: any, _now: string): Promise<WatchEvaluation> {
  const sectorName = watch.entityId;
  const sectors = await getLatestSectorSnapshots();
  const sector = sectors.find(s => (s as any).sector?.toLowerCase() === sectorName?.toLowerCase());
  if (!sector) return _stableEval(base, "Sector data not yet available");
  const score = (sector as any).score ?? 0;
  const currentStatus: WatchCurrentStatus = {
    score,
    label: (sector as any).label ?? null,
    memberCount: (sector as any).metrics?.rankedCount ?? null,
    lastUpdated: (sector as any).generatedAt ?? null,
  };
  const lastActivity = await getWatchActivity(watch.id, watch.userId, 1);
  const lastData = lastActivity[0]?.changeData as Record<string, unknown> | null;
  const lastScore = lastData?.score as number | undefined;
  if (lastScore === undefined) return { ...base, changed: true, changeType: "sector_improved", changeDirection: "new", changeSummary: `${watch.entityLabel ?? sectorName} sector monitoring started`, currentStatus };
  const delta = score - lastScore;
  if (delta >= 5) return { ...base, changed: true, changeType: "sector_improved", changeDirection: "improved", changeSummary: `${watch.entityLabel ?? sectorName} sector improved to score ${score}`, currentStatus };
  if (delta <= -5) return { ...base, changed: true, changeType: "sector_weakened", changeDirection: "weakened", changeSummary: `${watch.entityLabel ?? sectorName} sector weakened to score ${score}`, currentStatus };
  return _stableEval(base, `${watch.entityLabel ?? sectorName} sector stable at ${score}`, currentStatus);
}

async function _evalRegime(watch: ResearchWatch, base: any, _now: string): Promise<WatchEvaluation> {
  const ranking = getLatestRanking();
  const regime = ranking?.regime ?? null;
  const currentStatus: WatchCurrentStatus = { regime, lastUpdated: ranking?.generatedAt ?? null };
  const lastActivity = await getWatchActivity(watch.id, watch.userId, 1);
  const lastRegime = (lastActivity[0]?.changeData as any)?.regime as string | undefined;
  if (lastRegime === undefined) return { ...base, changed: true, changeType: "regime_change", changeDirection: "new", changeSummary: `Market regime monitoring started: ${regime ?? "Unknown"}`, currentStatus };
  if (regime !== lastRegime) return { ...base, changed: true, changeType: "regime_change", changeDirection: "attention", changeSummary: `Market regime changed from "${lastRegime}" to "${regime ?? "Unknown"}"`, currentStatus };
  return _stableEval(base, `Market regime unchanged: ${regime ?? "Unknown"}`, currentStatus);
}

async function _evalOpportunityType(watch: ResearchWatch, base: any, _now: string): Promise<WatchEvaluation> {
  const intel = await getOpportunityIntelligence();
  if (!intel) return _stableEval(base, "Opportunity intelligence not yet available");
  const type = watch.watchType === "opportunity_type" ? (watch.entityId ?? null) : watch.watchType.replace("_candidates", "");
  const candidates = intel.opportunities.filter(o => {
    const t = o.opportunityType?.toLowerCase() ?? "";
    if (watch.watchType === "growth_candidates") return t.includes("growth");
    if (watch.watchType === "income_candidates") return t.includes("income");
    if (watch.watchType === "momentum") return t.includes("momentum") || t.includes("swing");
    if (watch.watchType === "etf_candidates") return t.includes("etf");
    if (watch.watchType === "dividend_candidates") return t.includes("dividend") || t.includes("covered");
    if (watch.watchType === "opportunity_type" && type) return t.includes(type.toLowerCase());
    return true;
  });
  const count = candidates.length;
  const currentStatus: WatchCurrentStatus = { memberCount: count, lastUpdated: intel.generatedAt ?? null };
  const lastActivity = await getWatchActivity(watch.id, watch.userId, 1);
  const lastCount = (lastActivity[0]?.changeData as any)?.memberCount as number | undefined;
  if (lastCount === undefined) return { ...base, changed: true, changeType: "new_candidate", changeDirection: "new", changeSummary: `Research monitoring started: ${count} candidates observed`, currentStatus };
  const delta = count - lastCount;
  if (delta > 0) return { ...base, changed: true, changeType: "member_count_changed", changeDirection: "improved", changeSummary: `${delta} new ${watch.entityLabel ?? type ?? "research"} candidates observed (now ${count})`, currentStatus };
  if (delta < 0) return { ...base, changed: true, changeType: "member_count_changed", changeDirection: "weakened", changeSummary: `${Math.abs(delta)} ${watch.entityLabel ?? type ?? "research"} candidates removed (now ${count})`, currentStatus };
  return _stableEval(base, `${count} candidates observed — no change`, currentStatus);
}

async function _evalInstitutional(watch: ResearchWatch, base: any, _now: string): Promise<WatchEvaluation> {
  const symbol = watch.entityId;
  if (!symbol) return _stableEval(base, "No symbol configured");
  const opp = await getCanonicalOpportunity(symbol);
  const instScore = opp?.institutionalScore ?? null;
  const currentStatus: WatchCurrentStatus = {
    score: instScore ?? undefined,
    lastUpdated: opp?.lastUpdated ?? null,
  };
  const lastActivity = await getWatchActivity(watch.id, watch.userId, 1);
  const lastScore = (lastActivity[0]?.changeData as any)?.score as number | undefined;
  if (lastScore === undefined) return { ...base, changed: true, changeType: "institutional_accumulation", changeDirection: "new", changeSummary: `${symbol} institutional monitoring started (score: ${instScore ?? "N/A"})`, currentStatus };
  if (instScore !== null && lastScore !== undefined && instScore - lastScore >= 8) {
    return { ...base, changed: true, changeType: "institutional_accumulation", changeDirection: "improved", changeSummary: `${symbol} institutional score improved (now ${instScore})`, currentStatus };
  }
  if (instScore !== null && lastScore !== undefined && instScore - lastScore <= -8) {
    return { ...base, changed: true, changeType: "institutional_distribution", changeDirection: "weakened", changeSummary: `${symbol} institutional score declined (now ${instScore})`, currentStatus };
  }
  return _stableEval(base, `${symbol} institutional score stable`, currentStatus);
}

async function _evalCollection(watch: ResearchWatch, base: any, _now: string): Promise<WatchEvaluation> {
  // Collection evaluation: check if member count changed
  const intel = await getOpportunityIntelligence();
  if (!intel) return _stableEval(base, "Opportunity intelligence not yet available");
  const count = intel.opportunities.length;
  const currentStatus: WatchCurrentStatus = { memberCount: count, lastUpdated: intel.generatedAt ?? null };
  const lastActivity = await getWatchActivity(watch.id, watch.userId, 1);
  const lastCount = (lastActivity[0]?.changeData as any)?.memberCount as number | undefined;
  if (lastCount === undefined) return { ...base, changed: true, changeType: "collection_added", changeDirection: "new", changeSummary: `Collection monitoring started`, currentStatus };
  const delta = count - lastCount;
  if (delta > 0) return { ...base, changed: true, changeType: "collection_added", changeDirection: "improved", changeSummary: `${delta} new candidates in collection`, currentStatus };
  if (delta < 0) return { ...base, changed: true, changeType: "collection_removed", changeDirection: "weakened", changeSummary: `${Math.abs(delta)} candidates removed from collection`, currentStatus };
  return _stableEval(base, `Collection unchanged — ${count} candidates`, currentStatus);
}

function _stableEval(base: any, summary: string, currentStatus: WatchCurrentStatus = { lastUpdated: null }): WatchEvaluation {
  return { ...base, changed: false, changeType: "status_unchanged" as WatchActivityType, changeDirection: null, changeSummary: summary, currentStatus };
}

// ---------------------------------------------------------------------------
// Watch Detail
// ---------------------------------------------------------------------------

export async function getWatchDetail(watchId: string, userId: string): Promise<ResearchWatchDetail | null> {
  const watch = await getWatchById(watchId, userId);
  if (!watch) return null;

  const recentActivity = await getWatchActivity(watchId, userId, 10);
  const latestData = recentActivity[0]?.changeData as Record<string, unknown> | null;

  // Build current status from last activity
  const currentStatus: WatchCurrentStatus = {
    score: latestData?.score as number | undefined,
    confidence: latestData?.confidence as string | undefined,
    label: latestData?.label as string | undefined,
    memberCount: latestData?.memberCount as number | undefined,
    regime: latestData?.regime as string | undefined,
    lastUpdated: recentActivity[0]?.observedAt.toISOString() ?? null,
  };

  // Related candidates: load from opportunity intel for entity
  const relatedCandidates: RelatedCandidate[] = [];
  if (watch.watchType === "company" && watch.entityId) {
    const opp = await getCanonicalOpportunity(watch.entityId);
    if (opp) {
      relatedCandidates.push({
        symbol: opp.symbol,
        label: opp.companyName ?? opp.symbol,
        score: opp.researchScore,
        direction: "stable",
        linkTo: `/opportunities/${opp.symbol}`,
      });
    }
  } else if (["theme", "sector", "growth_candidates", "income_candidates", "momentum", "etf_candidates"].includes(watch.watchType)) {
    const intel = await getOpportunityIntelligence();
    const slice = (intel?.opportunities ?? []).slice(0, 5);
    for (const o of slice) {
      relatedCandidates.push({
        symbol: o.symbol,
        label: o.companyName ?? o.symbol,
        score: o.researchScore,
        direction: "stable",
        linkTo: `/opportunities/${o.symbol}`,
      });
    }
  }

  // Evidence strings from recent activity
  const evidence: string[] = recentActivity
    .filter(a => a.activityType !== "status_unchanged")
    .slice(0, 3)
    .map(a => (a.changeData as any)?.summary as string | undefined ?? "Research change observed")
    .filter(Boolean) as string[];

  // Why changed
  const whyChanged: string[] = recentActivity
    .filter(a => a.activityType !== "status_unchanged")
    .slice(0, 5)
    .map(a => (a.changeData as any)?.summary as string | undefined ?? "Observed change")
    .filter(Boolean) as string[];

  const freshness = freshnessSummary(currentStatus.lastUpdated);

  return {
    ...watch,
    currentStatus,
    recentActivity,
    relatedCandidates,
    evidence,
    whyChanged,
    freshness,
  };
}

// ---------------------------------------------------------------------------
// Daily Research Feed (deterministic from precomputed stores)
// ---------------------------------------------------------------------------

export async function getDailyFeed(userId: string): Promise<DailyResearchFeed> {
  const now = new Date().toISOString();
  const feedDate = now.split("T")[0];
  const feedId = `feed-${feedDate}-${userId.slice(0, 8)}`;

  const [ranking, themes, sectors, userWatches] = await Promise.all([
    Promise.resolve(getLatestRanking()),
    getLatestThemeSnapshots(),
    getLatestSectorSnapshots(),
    listWatches(userId),
  ]);

  const sections: FeedSection[] = [];
  const feedSummary: FeedSummary = {
    totalChanges: 0,
    highlights: [],
    newCandidates: 0,
    improvedCandidates: 0,
    weakenedCandidates: 0,
    themeChanges: 0,
    sectorChanges: 0,
    regimeChanged: false,
  };

  // ── Section 1: Opportunity Changes ──────────────────────────────────────
  if (ranking) {
    const changes = ranking.changes ?? [];
    const newItems: FeedItem[] = changes
      .filter(c => c.direction === "new")
      .map(c => ({
        id: `new-${c.symbol}`,
        symbol: c.symbol,
        label: c.symbol,
        detail: `New qualified research candidate`,
        changeDirection: "new" as ChangeDirection,
        linkTo: `/opportunities/${c.symbol}`,
        score: (c.to as any)?.overallScore,
      }));

    const improvedItems: FeedItem[] = changes
      .filter(c => c.direction === "upgraded")
      .slice(0, 5)
      .map(c => ({
        id: `up-${c.symbol}`,
        symbol: c.symbol,
        label: c.symbol,
        detail: `Research score improved`,
        changeDirection: "improved" as ChangeDirection,
        linkTo: `/opportunities/${c.symbol}`,
        score: (c.to as any)?.overallScore,
      }));

    const weakenedItems: FeedItem[] = changes
      .filter(c => c.direction === "downgraded")
      .slice(0, 5)
      .map(c => ({
        id: `down-${c.symbol}`,
        symbol: c.symbol,
        label: c.symbol,
        detail: `Research score declined`,
        changeDirection: "weakened" as ChangeDirection,
        linkTo: `/opportunities/${c.symbol}`,
        score: (c.to as any)?.overallScore,
      }));

    feedSummary.newCandidates = newItems.length;
    feedSummary.improvedCandidates = improvedItems.length;
    feedSummary.weakenedCandidates = weakenedItems.length;

    if (newItems.length > 0) {
      sections.push({
        id: "new-candidates",
        title: `${newItems.length} New Qualified Candidate${newItems.length !== 1 ? "s" : ""}`,
        description: "Symbols that newly qualified based on technical and institutional research signals",
        changeType: "new",
        count: newItems.length,
        items: newItems,
        linkTo: "/dashboard",
      });
      feedSummary.highlights.push(`${newItems.length} new research candidate${newItems.length !== 1 ? "s" : ""} observed`);
    }
    if (improvedItems.length > 0) {
      sections.push({
        id: "improved-candidates",
        title: `${improvedItems.length} Improved Research Score${improvedItems.length !== 1 ? "s" : ""}`,
        description: "Symbols with meaningfully improved research scores since last evaluation",
        changeType: "improved",
        count: improvedItems.length,
        items: improvedItems,
        linkTo: "/dashboard",
      });
      feedSummary.highlights.push(`${improvedItems.length} research score${improvedItems.length !== 1 ? "s" : ""} improved`);
    }
    if (weakenedItems.length > 0) {
      sections.push({
        id: "weakened-candidates",
        title: `${weakenedItems.length} Weakened Research Score${weakenedItems.length !== 1 ? "s" : ""}`,
        description: "Symbols where research scores declined since last evaluation",
        changeType: "weakened",
        count: weakenedItems.length,
        items: weakenedItems,
        linkTo: "/dashboard",
      });
    }

    // Regime section
    if (ranking.regime) {
      sections.push({
        id: "market-regime",
        title: "Market Regime",
        description: "Current market environment classification",
        changeType: "stable",
        count: 1,
        items: [{
          id: "regime",
          label: ranking.regime,
          detail: "Current market regime based on technical and breadth signals",
          changeDirection: "stable",
          linkTo: "/research",
          score: undefined,
        }],
        linkTo: "/research",
      });
    }
  }

  // ── Section 2: Theme Changes ─────────────────────────────────────────────
  const themeChanges: FeedItem[] = [];
  for (const t of (themes as any[]).slice(0, 10)) {
    const changes = t.changes ?? (t.metrics as any)?.changes;
    if (!changes?.summary) continue;
    const scoreDelta = changes.scoreDelta ?? 0;
    if (Math.abs(scoreDelta) < 3) continue;
    themeChanges.push({
      id: `theme-${t.themeId ?? t.theme_id}`,
      label: t.themeName ?? t.theme_name ?? t.themeId ?? "Theme",
      detail: changes.summary,
      changeDirection: scoreDelta > 0 ? "improved" : "weakened",
      linkTo: `/intelligence/themes/${t.themeId ?? t.theme_id}`,
      score: t.score,
      delta: scoreDelta,
    });
    feedSummary.themeChanges++;
  }
  if (themeChanges.length > 0) {
    sections.push({
      id: "theme-changes",
      title: `${themeChanges.length} Research Theme${themeChanges.length !== 1 ? "s" : ""} Changed`,
      description: "Research themes with meaningful intelligence changes",
      changeType: themeChanges.some(t => t.changeDirection === "improved") ? "improved" : "weakened",
      count: themeChanges.length,
      items: themeChanges,
      linkTo: "/intelligence",
    });
    feedSummary.highlights.push(`${themeChanges.length} research theme change${themeChanges.length !== 1 ? "s" : ""} observed`);
  }

  // ── Section 3: Sector Changes ────────────────────────────────────────────
  const sectorChanges: FeedItem[] = [];
  for (const s of (sectors as any[]).slice(0, 10)) {
    const changes = s.changes ?? (s.metrics as any)?.changes;
    if (!changes?.summary) continue;
    const scoreDelta = changes.scoreDelta ?? 0;
    if (Math.abs(scoreDelta) < 3) continue;
    sectorChanges.push({
      id: `sector-${s.sector}`,
      label: s.sector ?? "Sector",
      detail: changes.summary,
      changeDirection: scoreDelta > 0 ? "improved" : "weakened",
      linkTo: `/intelligence/sectors/${encodeURIComponent(s.sector ?? "")}`,
      score: s.score,
      delta: scoreDelta,
    });
    feedSummary.sectorChanges++;
  }
  if (sectorChanges.length > 0) {
    sections.push({
      id: "sector-changes",
      title: `${sectorChanges.length} Sector${sectorChanges.length !== 1 ? "s" : ""} Changed`,
      description: "Market sectors with observed research intelligence changes",
      changeType: sectorChanges.some(s => s.changeDirection === "improved") ? "improved" : "weakened",
      count: sectorChanges.length,
      items: sectorChanges,
      linkTo: "/intelligence",
    });
  }

  // ── Section 4: My Watch Changes (personalized) ──────────────────────────
  const activeWatches = userWatches.filter(w => w.status === "active");
  if (activeWatches.length > 0) {
    const watchChanges: FeedItem[] = [];
    for (const w of activeWatches.slice(0, 20)) {
      if (!w.lastChangeAt || !w.lastChangeSummary) continue;
      const ageMs = Date.now() - new Date(w.lastChangeAt).getTime();
      if (ageMs > 24 * 60 * 60 * 1000) continue; // only last 24h
      watchChanges.push({
        id: `watch-${w.id}`,
        symbol: w.entityId?.toUpperCase() ?? undefined,
        label: w.name,
        detail: w.lastChangeSummary,
        changeDirection: (w.lastChangeType?.includes("improved") || w.lastChangeType?.includes("accumulation") ? "improved" :
                          w.lastChangeType?.includes("weakened") || w.lastChangeType?.includes("distribution") ? "weakened" :
                          w.lastChangeType === "new_candidate" ? "new" : "stable") as ChangeDirection,
        linkTo: w.entityId ? `/opportunities/${w.entityId}` : "/research-monitor",
        watchId: w.id,
      });
    }
    if (watchChanges.length > 0) {
      sections.push({
        id: "my-watch-changes",
        title: `${watchChanges.length} Research Watch Change${watchChanges.length !== 1 ? "s" : ""}`,
        description: "Updates from your research monitors in the last 24 hours",
        changeType: "attention",
        count: watchChanges.length,
        items: watchChanges,
        linkTo: "/research-monitor",
      });
      feedSummary.highlights.unshift(`${watchChanges.length} watch update${watchChanges.length !== 1 ? "s" : ""} for you`);
    }
  }

  feedSummary.totalChanges = sections.reduce((sum, s) => sum + s.count, 0);
  if (feedSummary.highlights.length === 0) {
    feedSummary.highlights.push("No significant research changes observed");
  }

  return {
    feedId,
    generatedAt: now,
    feedDate,
    summary: feedSummary,
    sections,
    isPersonalized: activeWatches.length > 0,
    watchCount: activeWatches.length,
  };
}

// ---------------------------------------------------------------------------
// Command Center — My Watch Changes section
// ---------------------------------------------------------------------------

export async function buildMyWatchChangesSection(userId: string): Promise<MyWatchChangesSection> {
  try {
    const watches = await listWatches(userId);
    const active = watches.filter(w => w.status === "active");
    if (active.length === 0) {
      return { available: false, watchCount: 0, activeWatchCount: 0, recentChanges: [], lastEvaluatedAt: null, feedSummary: null };
    }
    const recentChanges: WatchChangeSummary[] = active
      .filter(w => w.lastChangeAt && w.lastChangeSummary && w.lastChangeType !== "status_unchanged")
      .sort((a, b) => (b.lastChangeAt?.getTime() ?? 0) - (a.lastChangeAt?.getTime() ?? 0))
      .slice(0, 8)
      .map(w => ({
        watchId: w.id,
        watchName: w.name,
        watchType: w.watchType,
        entityLabel: w.entityLabel,
        changeType: w.lastChangeType!,
        changeDirection: (w.lastChangeType?.includes("improved") || w.lastChangeType?.includes("accumulation") ? "improved" :
                          w.lastChangeType?.includes("weakened") || w.lastChangeType?.includes("distribution") ? "weakened" :
                          w.lastChangeType === "new_candidate" ? "new" : "stable") as ChangeDirection,
        changeSummary: w.lastChangeSummary!,
        changedAt: w.lastChangeAt!.toISOString(),
        linkTo: w.entityId ? `/opportunities/${w.entityId}` : "/research-monitor",
      }));
    const lastEvalDates = active.map(w => w.lastEvaluatedAt).filter(Boolean) as Date[];
    const lastEvaluatedAt = lastEvalDates.length > 0
      ? new Date(Math.max(...lastEvalDates.map(d => d.getTime()))).toISOString()
      : null;
    const changed = recentChanges.length;
    const feedSummary = changed > 0 ? `${changed} research watch update${changed !== 1 ? "s" : ""} since last evaluation` : null;
    return {
      available: true,
      watchCount: watches.length,
      activeWatchCount: active.length,
      recentChanges,
      lastEvaluatedAt,
      feedSummary,
    };
  } catch {
    return { available: false, watchCount: 0, activeWatchCount: 0, recentChanges: [], lastEvaluatedAt: null, feedSummary: null };
  }
}

// ---------------------------------------------------------------------------
// Platform Health
// ---------------------------------------------------------------------------

export async function getResearchMonitoringHealth(): Promise<ResearchMonitoringHealth> {
  try {
    const totalResult = await db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM research_watches WHERE status = 'active'`);
    const activeCount = parseInt(totalResult.rows[0]?.count ?? "0", 10);
    const allResult = await db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM research_watches WHERE status != 'archived'`);
    const watchCount = parseInt(allResult.rows[0]?.count ?? "0", 10);
    const lastEvalResult = await db.execute<{ last_eval: string | null }>(sql`SELECT MAX(last_evaluated_at)::text as last_eval FROM research_watches WHERE status = 'active'`);
    const lastEvaluatedAt = lastEvalResult.rows[0]?.last_eval ?? null;
    const todayResult = await db.execute<{ count: string }>(sql`SELECT COUNT(*)::text as count FROM watch_activity_log WHERE observed_at > NOW() - INTERVAL '24 hours'`);
    const evaluationsToday = parseInt(todayResult.rows[0]?.count ?? "0", 10);
    return { watchCount, activeWatchCount: activeCount, lastEvaluatedAt, lastFeedGeneratedAt: null, evaluationsToday };
  } catch {
    return { watchCount: 0, activeWatchCount: 0, lastEvaluatedAt: null, lastFeedGeneratedAt: null, evaluationsToday: 0 };
  }
}

// ---------------------------------------------------------------------------
// Startup migrations (CREATE TABLE IF NOT EXISTS for resilience)
// ---------------------------------------------------------------------------

export async function ensureResearchMonitorTables(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS research_watches (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL,
        name TEXT NOT NULL,
        watch_type TEXT NOT NULL,
        entity_id TEXT,
        entity_label TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        last_evaluated_at TIMESTAMP,
        last_change_at TIMESTAMP,
        last_change_type TEXT,
        last_change_summary TEXT,
        notify_email BOOLEAN NOT NULL DEFAULT false,
        notify_push BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_rw_user_id ON research_watches(user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_rw_status ON research_watches(user_id, status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_rw_watch_type ON research_watches(user_id, watch_type)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS watch_activity_log (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        watch_id VARCHAR NOT NULL,
        user_id VARCHAR NOT NULL,
        activity_type TEXT NOT NULL,
        entity_symbol TEXT,
        entity_label TEXT,
        change_direction TEXT,
        change_data JSONB,
        observed_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_wal_watch_id ON watch_activity_log(watch_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_wal_user_id ON watch_activity_log(user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_wal_observed_at ON watch_activity_log(watch_id, observed_at)`);
    log("tables_ready");
  } catch (err: any) {
    log("table_create_error", { error: err?.message });
  }
}
