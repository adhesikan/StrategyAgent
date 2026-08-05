---
name: Research Persistence Foundation
description: Sprint 5.4C — save-handle architecture, evidence validation rules, schema, and wiring decisions for research records and decision journals.
---

# Research Persistence Foundation

## Rule
Evidence content **never comes from client input**. The flow is: Brain result → `extractResearchEvidence()` → `validateResearchEvidence()` → `issueResearchSaveHandle()` → frontend gets only `{handleId, domain, titleSuggestion, expiresAt}`. Client sends `handleId` → server resolves → DB write.

**Why:** Prevents client from submitting fake deterministic evidence and claiming it came from MCP.

## Save handle design
- In-process Map, keyed by SHA-256(handleId) — same pattern as `portfolio-context.ts`
- 10-min TTL, single-use (`consumed` flag set on first successful resolve)
- User-bound: `resolveResearchSaveHandle(id, userId)` → `WRONG_USER` → 404
- Expires → HTTP 410 Gone
- Helper: `_clearAllHandles()` for tests; `activeHandleCount()` for diagnostics

## Tag normalizer (critical)
`generateTagSuggestions` normalizes tags with `replace(/[\s_]+/g, "-")` — underscores become hyphens, NOT stripped. Without this, `"SYMBOL_ANALYSIS"` → `"symbolanalysis"` (underscore is stripped by `[^a-z0-9-]`).

**Why:** Discovered via failing test; underscore is not in `[a-z0-9-]` charset.

## Forbidden-key scanner
`scanForForbiddenKeys(value, path)` in `research-evidence-validator.ts` recurses into all objects/arrays. It NEVER logs the offending value — only logs the JSON path. Same 21-key list as spec §6.

## Ownership pattern
All service methods: `AND user_id = authenticatedUserId` in WHERE. Returns `null` (not throw) when not found; routes translate `null` → 404. No 403 — avoids revealing existence of other users' records.

## Immutable fields
After creation, only `title`, `userLabel`, `tags`, `archived` may be patched via `updateUserMetadata()`. Evidence fields silently ignored in patch operations.

## Journal execution boundary
`entered_manually` and `closed_manually` require `recordExplicitManualDecision()` — they cannot be set via `updateUserAuthoredFields()`. The route gate: `PATCH /api/research-records/:id/journal?manual=true`. No broker API calls anywhere in journal service.

## Domain → Brain intent mapping
SYMBOL_ANALYSIS←ANALYZE_SYMBOL, TRADE_RESEARCH←RECOMMEND_SYMBOL_TRADE, MARKET_OPPORTUNITY_SEARCH←RANK_MARKET_TRADES, PORTFOLIO_GOAL_RESEARCH←PLAN_PORTFOLIO_TRADE, PORTFOLIO_IMPACT←hasPortfolioContext (priority), COMBINED→SYMBOL_ANALYSIS then TRADE_RESEARCH. Education/Concept/MarketResearch → no handle.

## DB cascade
`decision_journal_entries.research_record_id` FK has `ON DELETE CASCADE` — deleting a research record auto-deletes its journal entry. Research records are NOT cascaded by conversation deletion (conversationId is nullable).

## Migration
Idempotent SQL blocks added to `scripts/migrate.js`. Both tables created with `IF NOT EXISTS`. Indexes: user_id, user_id+domain, user_id+symbol, user_id+archived, research_record_id, unique(research_record_id) for journal.

## Frontend testing pattern (5.4D)
`@testing-library/react` is NOT installed — client tests must be pure TS unit tests in `client/src/__tests__/*.ts` (not `.tsx`). vitest root flag `--root .` is required to find client tests. Component rendering tests deferred until testing-library is installed.

## formatGeneratedAt safety
Must guard with `isNaN(d.getTime())` before calling `toLocaleDateString` — `new Date("not-a-date")` is valid JS but returns "Invalid Date" string from toLocaleDateString; the guard returns the original string instead.
