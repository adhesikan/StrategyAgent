---
name: TraderBrain Core — Implementation Status
description: Phase 0 implementation complete. All modules written, wired, tested. Shadow mode integrated into ask.ts.
---

## Status: Phase 0 Complete

All 9 `server/trader-brain/` modules are implemented and tested.
174 tests across 4 test files, all green.

## Module Map

| File | Purpose |
|------|---------|
| `types.ts` | Shared type algebra (no any, all closed unions) |
| `intent-classifier.ts` | `classifyBrainIntent()` — wraps existing classifiers, priority order |
| `request-normalizer.ts` | `normalizeBrainRequest()` — pure, no I/O |
| `planner.ts` | `buildToolPlan()` — deterministic, pure, no I/O |
| `evidence.ts` | `wrapSuccess/wrapFailure/wrapSkipped` — preserves full payload |
| `fallbacks.ts` | `ruleBasedFallback()` — honest unavailability, no invented trades |
| `observability.ts` | Structured JSON log events, never logs credentials |
| `executor.ts` | `executeToolPlan()` — dependency ordering, bounded concurrency |
| `composer.ts` | `composeBrainResult()` + `projectToResponseField()` |
| `service.ts` | `TraderBrainService` + `runBrainShadow()` singleton |

## Integration: ask.ts

Shadow mode added to the general path (the main non-early-return `res.json`).
- `brainShadowPromise` runs concurrently with `callOpenAi` via `Promise.all`
- `traderBrain` field added to response when `TRADER_BRAIN_ENABLED` is set
- Default: off (`TRADER_BRAIN_ENABLED=false` or unset)
- Evidence envelopes always stripped before client response
- No existing `res.json` fields altered

## Feature Flag

`TRADER_BRAIN_ENABLED` env var:
- `"false"` / unset: disabled (Phase 0 default)
- `"all"` / `"shadow"`: all intents
- Comma list: `"COMBINED_ANALYSIS_RECOMMENDATION,RECOMMEND_SYMBOL_TRADE"`

## Key Constraints

- Brain is a thin orchestration wrapper — never reimplements domain logic
- Tokens from TrustedContext injected per step.trustedContextScopes — never in plan args
- `findCredentialArgs(plan)` verifies no tokens leak into plan arguments (tested)
- Required step failure → remaining steps skipped; honest "unavailable" returned
- OpenAI step always optional (required: false) — deterministic sections survive OpenAI failure

## Shadow Validator (Phase 0 complete)

`server/trader-brain/shadow-validator.ts` — 8-dimension comparison engine (pure, no I/O).
`server/trader-brain/__tests__/shadow-validator.test.ts` — 88 tests, all passing.
`docs/TRADER_BRAIN_SHADOW_REPORT.md` — fixture-suite analysis, migration roadmap.

**Wiring:** `runBrainShadowFull()` added to service.ts; general path in ask.ts uses it;
shadow comparison is fire-and-forget after Promise.all; never delays or alters response.

**Wiring gap:** Ranked-trade-search and portfolio-trade-plan early-return branches do NOT
emit live shadow comparisons yet (fixture suite only). Phase 1 work required.

**Migration-ready intents:** RECOMMEND_SYMBOL_TRADE, COMBINED_ANALYSIS_RECOMMENDATION
(all 8 dimensions MATCH in fixture suite; general path wired; no blocking mismatches).

**Log event:** `BRAIN_SHADOW_COMPARISON` JSON — monitor for `overallVerdict:"MISMATCH"`.

## Phase 0 Limitation

No dedicated portfolio/options tokens wired to Brain in Phase 0. Brain runs market-only (no portfolio context). Tokens wired in Phase 1 when Brain takes over the affected ask.ts paths.

## Intent Classifier Priority

1. PLAN_PORTFOLIO_TRADE (dollar/pct/sector/holdings constraints)
2-5. classifyTradeRequest → COMBINED / EDUCATION_PLUS_ACTION / RECOMMEND / RANK
6. classifyRankedTradeSearch → RANK_MARKET_TRADES
7. ANALYZE_SYMBOL (ticker present, no clearer intent)
8. MARKET_RESEARCH (checked before EXPLAIN_CONCEPT — macro "what is" questions)
9. EXPLAIN_CONCEPT
10. UNKNOWN

**Why MARKET_RESEARCH before EXPLAIN_CONCEPT:** Macro questions often start with
"what is / why is" (e.g. "What is the Fed doing?") which would match EXPLAIN_CONCEPT
first. MARKET_RESEARCH wins if its keywords are present.
