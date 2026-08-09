---
name: Research Reports Engine (Sprint 2.5.5)
description: Report generation architecture, OpportunityChange field names, export format shapes, and integration contracts.
---

## Core Rules
- `OpportunityChange` (from opportunity-ranking-engine.ts) uses `direction: "upgraded" | "downgraded" | "new" | "moved"` — NOT `changeType`. Always use `.direction` for filtering changes.
- `getOpportunityIntelligence()` takes no userId argument — `OpportunityFilterOptions` has no userId field.
- `ResearchReport` domain object has no `typeLabel` field — use `REPORT_TYPE_LABELS[report.reportType]` instead.
- Dynamic imports in test files at `server/routes/__tests__/` must use `../../services/` (not `../services/`) to reach `server/services/`.
- RESEARCH_DISCLAIMER uses "buy", "sell", "guarantee" in negation context ("does not constitute...a recommendation to buy or sell...or a guarantee"). Tests must check for affirmative recommendation language, not bare word presence.

## Report Types
16 types (REPORT_TYPES array in shared/research-report-types.ts). All generate from precomputed stores — no rescanning.

## Export Formats
5 formats: html (string), markdown (string), json (ReportContent object), pdf_ready (pages[] JSON), ppt_ready (slides[] JSON). No rendering libraries.

## Integration Points
- Command center: `latestReport: LatestReportSection` added to CommandCenterDailySnapshot; built by `buildLatestReportSection(userId)`.
- Platform health: `researchReports` card via `checkResearchReports()` → `getResearchReportsHealth()`.
- App routing: `/research-reports` → `ResearchReportsPage`.
- DB table: `research_reports` — created by `ensureResearchReportsTables()` on startup.

**Why:** Sprint 2.5.5 completes the Research Platform. PDF/PPT rendering, scheduled delivery, and email are Sprint 2.6+ roadmap.
