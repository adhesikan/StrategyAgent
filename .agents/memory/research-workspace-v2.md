---
name: Research Workspace v2
description: Sprint 2.6.4 — canonical cross-platform AI research entry point; type fixes, context contract, compliance rules
---

## Context Entry Contract

All other surfaces link into `/research-workspace` with URL params. The two rules that must never be broken:

1. **Always pair `mode` + `action`** — `?mode=company&action=challenge` is correct; `?mode=challenge` is wrong (not a valid ResearchMode value and is silently ignored).
2. **`parseWorkspaceParams` is the single source** — lives in `shared/research-workspace-helpers.ts`. Both client and server tests import from there. Never duplicate it in the client page.

Valid ResearchMode values: `opportunity | company | theme | sector | institutional | market | collection | comparison`

## Type Traps (CanonicalOpportunity)

`CanonicalOpportunity` (from `shared/opportunity-intelligence-types.ts`) does NOT have:
- ❌ `evidence` → use `primaryEvidence` + `secondaryEvidence` (both `EvidenceItem[]`)
- ❌ `thesisInvalidators` → use `invalidatesThesis` (`InvalidatesThesis[]` with `.condition` + `.detail`)
- ❌ `riskFactors` is NOT `string[]` → it is `RiskFactor[]` (objects with `.label`, `.detail`, `.severity`)

When serializing to text for AI: `.map(r => r.label)` for risks, `.map(t => t.condition)` for thesis invalidators.

## OpportunityFilterOptions Has No `scope` Field

`filterOpportunities()` from `opportunity-intelligence-service.ts` takes `OpportunityFilterOptions` which has no `scope`. Scope-based filtering requires a local `filterByScopeKey()` function that manually maps scope keys to theme names, risk levels, or opportunity types.

## sortOpportunities Requires an Object

```typescript
// WRONG:
sortOpportunities(opps, "researchScore")
// CORRECT:
sortOpportunities(opps, { field: "researchScore", direction: "desc" })
```

## Portfolio Lookup (No portfolio-service Module)

No `portfolio-service.ts` exists. To look up a portfolio by ID, query the `portfolios` table directly via `db.select().from(portfolios).where(...)`. Import: `db` from `../db`, `portfolios` from `../../shared/schema`, `eq/and` from `drizzle-orm`.

## Research Reports: getReport not getReportById

The function is `getReport(reportId, userId)` in `research-report-service.ts`. There is no `getReportById`.

## ResearchWatch Uses `.name` Not `.label`

The `ResearchWatch` interface field for the watch name is `name` (not `label`). Referenced via `(watch as { name: string }).name`.

## Compliance — System Prompt Must Not Contain "recommendation"

The system prompt compliance section MUST NOT spell out the word "recommendation" literally (even in a NEVER-USE list), because tests scan the entire prompt for that word. Use periphrasis: "advise-to-act language" or "transaction verbs or price targets".

## DB Schema Migration

`migrations/026_research_workspace_context.sql` adds 5 nullable columns to `workspace_conversations`:
`context_type`, `context_label`, `primary_symbol`, `comparison_symbols` (TEXT[]), `source_route`.
Migration was applied to dev DB before 2026-08-10. Must be run on production before deploying Sprint 2.6.4.

## ConvRow Type

`Awaited<ReturnType<typeof db.select>>["0"]` is invalid (returns builder, not array). Use a plain inline type for the DB result row.

## Why These Rules Matter

The OW handoff bug (`?mode=explain_concept` instead of `?mode=company&action=explain_concept`) would silently deliver a default-mode experience instead of prefilling the question. The type mismatches (evidence field names, riskFactors) would have caused runtime serialization errors when the AI received malformed context JSON.
