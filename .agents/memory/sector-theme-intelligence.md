---
name: Sector & Theme Intelligence
description: Sprint 2.3.3 — deterministic sector/theme intelligence layer aggregating stock-level ranking data.
---

## Architecture

**Classification source:**
- `symbols` table (`sector`, `industry` columns) — sector grouping for ranked candidates
- Theme registry: `server/config/theme-registry.ts` — curated TypeScript config, NOT DB-backed
- Themes are many-to-many; symbols can belong to multiple themes
- 12 active themes; `classificationMethod: "curated"` for all

**Engines (pure computation — no DB, no LLM):**
- `server/services/sector-intelligence-engine.ts` — `computeSectorSnapshot()`, `aggregateSector()`, pure helpers
- `server/services/theme-intelligence-engine.ts` — `computeThemeSnapshot()`, `aggregateTheme()`, pure helpers
- Engines take pre-fetched data as input; DB queries live in orchestrator

**Orchestrator:**
- `server/services/intelligence-orchestrator.ts` — `runIntelligencePrecomputation()`
- Called fire-and-forget from `opportunity-engine.ts` after ranking completes (never throws)
- Loads: `symbols` table (sector), `institutional_symbol_signals` (signals), previous snapshots for change detection

**Persistence:**
- `sector_intelligence_snapshots` — one row per sector per scan cycle; DISTINCT ON (sector) ORDER BY generated_at DESC for latest
- `theme_intelligence_snapshots` — one row per theme per scan cycle; same query pattern
- 30-day retention enforced on each write
- Previous snapshot fetched via ROW_NUMBER() OVER (PARTITION BY ... ORDER BY generated_at DESC) WHERE rn = 2

**Routes:** `server/routes/intelligence.ts` (registered without auth — read-only public data)
- GET /api/intelligence/sectors
- GET /api/intelligence/sectors/:sector
- GET /api/intelligence/themes
- GET /api/intelligence/themes/:themeId
- GET /api/intelligence/themes/:themeId/history

**Client pages:**
- `/intelligence` → `IntelligencePage`
- `/intelligence/themes/:themeId` → `IntelligenceThemeDetailPage`
- `/intelligence/sectors/:sector` → `IntelligenceSectorDetailPage`

## Score Formulas

**Sector score (0-100):**
- Quality (40%): averageOpportunityScore / 100 × 40
- Breadth (25%): rankedSymbolCount / eligibleSymbolCount × 25
- Institutional (20%): institutionalAccumulationCount / institutionalDataAvailableCount × 20
- Momentum (15%): mapped net (strengthening - weakening) / rankedCount to 0-1 × 15
- **Critical:** When rankedSymbolCount = 0, momentum component = 0 (not 0.5 neutral)

**Theme score (0-100):**
- Quality (35%): averageOpportunityScore / 100 × 35
- Technical breadth (25%): % ranked members with technicalScore ≥ 65 × 25
- Institutional breadth (20%): % members with accumulation signal × 20
- Opportunity breadth (20%): rankedMemberCount / memberCount × 20

**Label mapping:** ≥75 = Strong, ≥60 = Improving, ≥40 = Mixed, ≥25 = Weakening, <25 = Weak

## Key Constraints

- Sector score returns 0 for empty sector (no ranked symbols → momentum = 0, breadth = 0, quality = 0)
- Missing institutional data: `institutionalDataAvailableCount = 0` → accumBreadth = 0 (no penalty)
- Change detection needs previous snapshot (rn=2 query) — first-ever snapshot returns `scoreDelta: null`
- Dashboard contracts exposed via GET /api/intelligence/themes response (leadingSectors/leadingThemes/improvingThemes/weakeningThemes) — NOT wired to dashboard UI yet
- Scanner/Opportunity Ranking Engine are NOT modified — this layer only reads and aggregates

## Compliance Vocabulary

- "Sector Strength" / "Theme Strength" / "Research Evidence"
- "Improving" / "Weakening" (not "bullish" / "bearish")
- "Institutional Activity" (not "Smart Money")
- NEVER: "Buy This Theme", "Hot Sector", "Sector Recommendation"

## Tests

90 pure-function tests across sector + theme engine + registry:
- Classification lookup, multi-theme membership, sector aggregation, theme aggregation
- Breadth edge cases (zero denominator, missing institutional data)
- Score bounds (0–100 guaranteed), label thresholds, change detection
- determinism check, forbidden language check, no-LLM assertion
