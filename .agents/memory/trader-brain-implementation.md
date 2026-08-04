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

**Wiring gap:** Ranked-trade-search and portfolio-trade-plan early-return branches do NOT
emit live shadow comparisons yet (fixture suite only). Phase 1 work required.

**Log event:** `BRAIN_SHADOW_COMPARISON` JSON — monitor for `overallVerdict:"MISMATCH"` (non-COMBINED intents only; COMBINED is now authoritative).

## COMBINED_ANALYSIS_RECOMMENDATION Migration (Phase 1 — complete)

**COMBINED is now authoritative** — Brain Core runs as the primary path. `callOpenAi` is bypassed for this intent.

### New files
- `server/trader-brain/combined-response-builder.ts` — pure builders: `buildCombinedAskAnswer()`, `buildCombinedSystemPrompt()`, `buildCombinedUserContent()`
- `server/trader-brain/__tests__/combined-response-builder.test.ts` — 65 tests covering all 4 partial-failure cases

### Planner change
COMBINED plan: both analysis + recommend steps are now `required: false, failurePolicy: "skip_section"` with **no dependency between them** (run concurrently). OpenAI step has `dependsOn: []` so it always runs.

**Why:** spec requires independent partial-failure handling: analysis fail → still show rec; rec fail → still show analysis. The old sequential dependsOn design would skip recommend when analysis failed.

### ask.ts routing (lines ~1868+)
- `classifyBrainIntent` called first to detect COMBINED intent
- COMBINED → authoritative Brain path → focused OpenAI explanation → `buildCombinedAskAnswer` → response
- Non-COMBINED → unchanged shadow mode + callOpenAi
- Catastrophic Brain failure → falls through to callOpenAi (legacy fallback preserved)
- Shadow comparison skipped for COMBINED (Brain is already authoritative)

### 4 partial-failure behaviors
1. Both OK → headline+confidence from recommendation; both sections; OpenAI prose
2. Analysis OK, rec failed → analysis section; `recommendationFailed: true`; honest disclosure
3. Rec OK, analysis failed → recommendation section; analysis limitation disclosed in answer
4. Both failed → honest unavailable; `recommendationFailed: true`; confidence: "low"

### MultiStrategyAnalysis shape reminder
No `.strategies[]` field — use `.primarySetup`, `.supportingSetups[]`, `.strategiesMatched`, `.strategiesChecked`, `.overallVerdict`.

## Phase 0 Limitation (still applies for non-COMBINED intents)

No dedicated portfolio/options tokens wired to Brain for non-COMBINED paths. Brain runs market-only. Phase 1 token wiring pending for RECOMMEND and PLAN_PORTFOLIO_TRADE.

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
