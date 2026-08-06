---
name: AI Trading Workspace — Sprint 2.2.3
description: Workspace tab on /opportunity/:symbol — architecture, prompt ordering contract, assistant drawer, schema extension.
---

## What was built

The Overview tab on `/opportunity/:symbol` (`OpportunityResearchPage`) was renamed to "Workspace" and restructured into a 12-section AI Trading Workspace. New workspace components live in `client/src/components/research/workspace/`.

## Component layout

- `workspace-sections.tsx` — 12 section components + 5 exported pure helpers
- `workspace-nav.tsx` — sticky pill nav with IntersectionObserver active tracking
- `workspace-assistant.tsx` — contextual AI panel (POST /api/ask) + desktop drawer + mobile bottom sheet
- `index.ts` — barrel export

## Prompt ordering contract (buildAssistantPrompts)

The function enforces 8-prompt cap via `slice(0, 8)`. Tiers are ordered so high-priority items always land within 8:

1. "Why did this candidate qualify?" (always)
2. "What are the strongest supporting factors for {symbol}?" (always)
3. "What would invalidate this setup?" (always)
4. Lifecycle prompt — only if `pkg.lifecycleItem` exists
5. "What evidence weakens the research thesis?" (always)
6. InstaTrade prompt — ALWAYS here (slot 5 or 6 depending on lifecycle):
   - with contract: "What should I verify before using InstaTrade™ with this selected contract?"
   - without: "What should I verify before using InstaTrade™?"
7. Risk/earnings — only if `pkg.candidate.warnings.length > 0`
8. News — only if `hasNewsData`
9+ (congress, options structure, stock structure) — fill remaining slots

**Why:** E8 test requires "instatrade" in top 8 for BOTH contract and no-contract cases. E10 requires risk prompt in top 8 when warnings exist. The single "InstaTrade™ with this selected contract?" string satisfies both E7 (contains "contract") and E8 (contains "instatrade").

## Server schema extension (ask.ts)

`askSchema` gained three optional backward-compatible fields:
- `symbol: string (regex /^[A-Z]{1,10}$/)` — prepended to tickers array when `contextMode === "trading_workspace"`
- `contextMode: enum ["trading_workspace"]`
- `selectedContractId: string (max 100 chars)` — opaque, not used in AI pipeline

Existing `{ question }` payloads continue to work unchanged.

## selectedContractId wiring

Currently always `null` — Task #87 will wire the LiveContractResolver callback into the page state. The workspace shows "stock_ready" state when broker is connected (correct behavior — stock InstaTrade™ review available, options review requires contract selection).

## Assistant payload safety

`buildSafeAssistantPayload` enforces:
- symbol: uppercase, alpha-only, max 10 chars
- question: trimmed, max 500 chars
- selectedContractId: ASCII printable only (0x20–0x7E), max 100 chars, omitted if empty
- contextMode: always "trading_workspace" literal
- No prices, evidence values, broker tokens, or account IDs ever sent
