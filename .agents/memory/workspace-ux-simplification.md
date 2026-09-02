---
name: Workspace UX simplification (Sprint 2.2.4)
description: Information architecture redesign for the AI Trading Workspace tab — Understand → Plan → Verify → Execute flow.
---

## What changed

The Workspace tab (TabsContent value="overview") was redesigned from a 12-section linear scroll into a structured hierarchy:

1. **WorkspaceHeroCard** — prominent decision card; thesis variant (bullish/neutral/bearish), max 3 whySelected bullets, top risk, regime, confidence. "View Full Decision →" navigates to Decision tab.
2. **WorkspaceTradePlanCard** — two-column (Stock left, Options right); all fields from `candidate` + `OptionsStructure.label/preferredDTE/strikeGuidance`.
3. **WorkspacePrimaryActions** — single action area; primary CTA = "Review with InstaTrade®" (broker) or "Connect Broker"; secondary = Ask VCP AI, Congress, Trade Plan.
4. **WorkspaceRiskCompact** — max 3 risks initially; "+N more" expand; uses `selectTopRisks(groups, 3)`.
5. **WorkspaceEvidenceCompact** — 4 score bars (technical/regime/congress/news), expandable to 6; uses `buildEvidenceSummaryRows`.
6. **WorkspaceMarketContextCompact** — 4-row compact grid (regime, source, quality, scan time).
7. **WorkspaceWhatChangedCompact** — one sentence from `formatWhatChanged(item)` + "View Scan History →" scroll link.
8. **WorkspaceAdvancedAccordion** — collapsible deep-dive; one-open-at-a-time; accepts `scanHistoryContent: ReactNode` from page (avoids duplicating local `ScanHistorySection`).
9. **WorkspaceFooterCta** — `lg:hidden` fixed bottom bar; hidden when assistant open (`hidden` prop).

## Key pure helpers (all exported for testing)

- `selectTopRisks(groups, maxShown)` — flatten + sort by severity; returns `{shown, hiddenCount}`.
- `buildHeroData(pkg, thesis, riskGroups)` — derives all Hero card display values.
- `buildCompactPlanData(pkg, optStructure)` — two-column plan data including `holdingPeriod` inferred from `strategy`.
- `formatWhatChanged(item)` — calls `deriveLifecycleSummary` and combines `headline + detail` into one sentence.

## WorkspaceNav removed from workspace tab

Secondary horizontal nav pills removed from the Workspace tab per spec. Component still exists in workspace-nav.tsx (not deleted). Import of `buildRiskGroups` added to page via workspace barrel.

## Test file

`workspace-simplified.test.tsx` — 53 pure-function tests (sections A–E).
`LifecycleItem` fixtures must include `scoreDelta: number` — it's required and `deriveLifecycleSummary` calls `.toFixed()` on it.

## Files changed / created

- `workspace-simplified.tsx` — new, all components and helpers
- `workspace-simplified.test.tsx` — new, 53 tests
- `workspace/index.ts` — added exports for simplified components
- `opportunity-research.tsx` — imports updated; `workspaceRiskGroups` precomputed; workspace tab content replaced; `WorkspaceFooterCta` added at page level

## Invariants

- `ScanHistorySection` is a local function inside `opportunity-research.tsx` (not a shared module). Pass it as `scanHistoryContent` ReactNode prop to `WorkspaceAdvancedAccordion`.
- `MarketSnapshot` type must be imported from `@/components/research/types` in `workspace-simplified.tsx`.
- `WorkspaceFooterCta` must be hidden when `assistantOpen` is true (bottom sheet conflict on mobile).
