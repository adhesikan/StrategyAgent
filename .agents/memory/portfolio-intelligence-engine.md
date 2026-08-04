---
name: Portfolio Intelligence Engine
description: Sprint 5.3B — design decisions and invariants for the PortfolioIntelligence section computed from SafePortfolioAwareness + Brain sections.
---

# Portfolio Intelligence Engine

## Rule
The engine (`server/trader-brain/portfolio-intelligence-engine.ts`) is a **pure computation module** — no MCP calls, no I/O. It synthesises a `PortfolioIntelligence` section from an already-computed `TraderBrainResult` + a `SafePortfolioAwareness` snapshot. The GPT explanation is added afterward by `ask.ts` (non-blocking, never required).

**Why:** Keeps the Brain pipeline unchanged (no new tool invocations at analysis time) while adding portfolio-aware enrichment in the response-building phase.

## Defensive wrapper (critical)
`computePortfolioIntelligence` wraps `result` in a `safeResult` object at the top of the function. All downstream accesses use `safeResult`, never the raw `result` argument. This prevents crashes on malformed/empty inputs (`{}` passed as `TraderBrainResult`).

**Why:** Tests proved that passing a bare `{}` throws without the wrapper; the engine must never break a response.

## Hard prohibitions
- Never recommends buying or selling any security.
- Never exposes raw account IDs, balances, equity, or buying-power amounts.
- GPT prompt (`buildPortfolioIntelligencePrompt`) has explicit system-level hard rules blocking buy/sell advice.
- `hasPortfolioContext: false` → only `nextResearchQuestions` is populated; all other sections are empty arrays.

## Key outputs
- `exposureSummary` — per-symbol exposure list (max 6 symbols) from Brain sections + normalizedRequest
- `concentration` — before/after concentration % (only when `concentrationWarning.pct` is available)
- `candidateImpact` — candidate-level impact entries with `concentrationBefore`, `concentrationAfterEstimate`, `sizingNote`
- `cashUtilization` — passes through `cashSufficiency` / `buyingPowerSufficiency` labels
- `earningsFlags` — extracted from `result.warnings` + `result.limitations` via `EARNINGS_RISK_RE`
- `nextResearchQuestions` — ≤5 contextual follow-up prompts; none contain buy/sell language

## Wiring in ask.ts
Computed inside the Sprint 5.1 early-Brain block, right after `brainResult` status check, before per-intent response building. Result stored in `s53bPortfolioIntelligence` and spread into `s51HttpExtras` for all 5 intent branches (RANK, PLAN, RECOMMEND, COMBINED, EDUCATION_PLUS).

**How to apply:** When adding new Brain intent branches, always include `...(s53bPortfolioIntelligence ? { portfolioIntelligence: s53bPortfolioIntelligence } : {})` in the `s51HttpExtras` object.

## SafePortfolioAwareness limitations
The scrubbed awareness object has NO raw positions array, NO sector data, NO total equity. Concentration % is only available for the primary symbol (symbol-specific). "After" concentration is a rough estimate from `maxRiskDollars` + `concentrationWarning.pct` — not exact without total equity.

## Test file
`server/trader-brain/__tests__/sprint53-portfolio-intelligence.test.ts` — 47 tests (PI01–PI10).
