---
name: Institutional Signal Engine
description: Sprint 2.2.6 — pure-computation signal engine on top of quarterly aggregates; precomputed signals table; new API routes; no LLM.
---

## Architecture

**Input**: `institutional_quarterly_aggregates` (two most recent rows per symbol)
**Output**: `institutional_symbol_signals` (one row per symbol, single-row lookup)
**Computation**: fully pure (`buildInstitutionalSignal`) — no raw holdings at request time

## Key files
- `server/services/institutional/signal-engine.ts` — all pure computation + rebuild service + DB upsert
- `server/routes/institutional-signals.ts` — GET /api/institutional/signals/:symbol, POST /api/admin/institutional/signals/rebuild
- `shared/schema.ts` — `institutionalSymbolSignals` table (end of file)
- `scripts/migrate-signal-engine.sql` — CREATE TABLE IF NOT EXISTS institutional_symbol_signals + indexes

## Score formula (A×30% + B×30% + C×25% + D×15%)
- A. Breadth: 50 + 50*(increased−reduced)/max(increased+reduced, 1)
- B. Accumulation: 50 + 50*clamp(shareChangePct/0.25, −1, 1)
- C. Entrants vs Exits: 50 + 50*clamp((new−exited)/max(new+exited, 1), −1, 1)
- D. Concentration: broadening=65, stable=50, increasing=40, insufficient=50
- Null components excluded; weights renormalized; score=null when confidence=insufficient

## Label thresholds
- ≥75 → Strong Accumulation
- ≥60 → Accumulation
- ≥40 → Stable
- ≥25 → Distribution
- <25  → Strong Distribution
- null → Insufficient Data

## Data quality gates
- high: managerCount ≥ 10 AND mappingCoverage ≥ 0.5 AND hasTwoQuarters
- moderate: managerCount ≥ 5 AND coverage ≥ 0.3 AND hasTwoQuarters
- limited: managerCount ≥ 2 AND hasTwoQuarters
- insufficient: managerCount < 2 OR single quarter → score = null

## Route registration order (CRITICAL)
Must maintain: signals → mappings → admin → institutional → dynamic :symbol
signals route registered BEFORE the dynamic :symbol route to avoid path collision.

## topBuyers/topSellers/newPositions/exitedPositions
Derived from stored largestHolders JSONB (top 20 by shares).
exitedPositions: check previous quarter largestHolders absent from current (by managerCik).

## Migration required in production
Run `scripts/migrate-signal-engine.sql` before first use.
Then call POST /api/admin/institutional/signals/rebuild to populate.

## Consumer contracts (Sprint 2.2.7)
- `signalToEvidence()` → InstitutionalEvidence (available/score/label/evidenceStrength/dataQuality/summary)
- `signalToWorkspaceContract()` → InstitutionalWorkspaceContract (status/score/label/latestQuarter/summary/topEvidence[≤3])
- These are exported from signal-engine.ts; NOT yet wired into Workspace or Opportunity Ranking
