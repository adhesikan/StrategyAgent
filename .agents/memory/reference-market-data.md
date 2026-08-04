---
name: Reference market data for non-broker surfaces
description: How non-broker surfaces must source real market data instead of synthetic mocks
---

- Non-broker surfaces (Trade Builder fallback, Radar/Best Picks) must pull real data through the reference-snapshot module in the daily-market-data service, never invent hash/hardcoded prices.
  **Why:** users saw fabricated quotes (e.g. GOOGL at a hardcoded $155.90 vs real ~$342) presented as market data; compliance copy also forbids implying such numbers are real.
  **How to apply:** single-symbol paths may use the gated Twelve Data realtime quote (1 credit, bounded 4s wait); multi-symbol scans must use stored daily bars ONLY (zero credits — the 7/min credit cap makes per-symbol /quote calls in scans a stall/DoS risk). Everything goes through canAccessTwelveDataBackedAnalysis; on denial, fall back to the existing educational/mock path with honest labels.
- Deterministic LLM-explanation flows in ask.ts must hard-disable model tools (`mcpTools = []`), not just add prompt rules — prompt-only containment failed review.
- Provenance labels must distinguish "delayed reference data (real prior-session prices)" from synthetic educational examples; expose a referenceQuoteCount so the UI can label from data, not guesses.
