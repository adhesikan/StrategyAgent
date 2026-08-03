# VCP Trader — Trading Platform UAT Checklist

Manual user-acceptance scenarios for the integrated Steps 1–9 experience:
Command Center → Ask AI → MCP tools → structured analysis/candidates → Trade Builder handoff.

**Environment prerequisites (all scenarios):**
- Logged-in user account (non-admin unless noted).
- For "live MCP" expectations: `MCP_ENABLED=true` with valid `MCP_BASE_URL` / `MCP_SERVICE_TOKEN`. In dev these are typically unset, so MCP-backed sections gracefully degrade (banners/warnings, `source: "card"` fallbacks) — that is expected, not a failure.
- Backend telemetry: watch server logs for `[ask]`, `[mcp]`, `[opportunity-search]`, `[prepare-ticket]` lines. No credentials, broker tokens, or options-context tokens may ever appear in logs.

Legend: fill **Pass/Fail** and **Notes** per scenario.

---

## 1. Analyze MU (single-symbol VCP analysis)
- **Prerequisites:** logged in; MCP enabled for full data (without MCP a scan-failed/degraded card is expected).
- **Actions:** open `/home`, type `Analyze MU` into the Ask box, submit.
- **Expected UI:** deterministic route to a rich VCP analysis card (not generic prose): stage, pattern score, pivot with actionable semantics, contraction structure, majorHigh labeled as historical context, improvement conditions if not actionable, confidence framed as data quality. Disclaimer says AI-generated analysis, not advice.
- **Expected backend/MCP:** one `scan_vcp` MCP call (or explicit scan-failed handling); no order/write endpoints touched.
- **Pass/Fail:** ______  **Notes:** ______

## 2. Find best setups
- **Prerequisites:** logged in.
- **Actions:** ask `Find the best setups right now`.
- **Expected UI:** ranked opportunity cards with specific symbols and reasons; no fallback to educational prose when the search succeeds; a no-results state (not fabricated candidates) if nothing qualifies.
- **Expected backend/MCP:** deterministic opportunity-search route (`scan_opportunities` / scanner APIs), not the generic LLM path.
- **Pass/Fail:** ______  **Notes:** ______

## 3. Find bullish trades
- **Prerequisites:** logged in.
- **Actions:** ask `Find 3 bullish trades`.
- **Expected UI:** up to 3 bullish candidates; each card shows reasons, warnings, risk estimate where available; count respected.
- **Expected backend/MCP:** bullish-filtered deterministic search.
- **Pass/Fail:** ______  **Notes:** ______

## 4. Risk-limited trade
- **Prerequisites:** logged in.
- **Actions:** ask `Find a trade with maximum loss of $300`.
- **Expected UI:** candidates whose stated max loss ≤ $300 (defined-risk structures); the constraint is echoed in the answer; no candidate silently exceeding the cap.
- **Expected backend/MCP:** max-risk filter passed to the search pipeline (`maxRiskDollars`).
- **Pass/Fail:** ______  **Notes:** ______

## 5. Estimated options without broker
- **Prerequisites:** logged in, **no** broker connected.
- **Actions:** ask `Find an options trade under $500`.
- **Expected UI:** cards clearly labeled *estimated* (no live premiums/Greeks invented); broker-connect CTA present; "Prepare in Trade Builder" is **not** offered on estimated options.
- **Expected backend/MCP:** no options-context token minted; no live chain fetch attempted for this user.
- **Pass/Fail:** ______  **Notes:** ______

## 6. Live options with broker
- **Prerequisites:** logged in with a connected broker that supports options data; MCP enabled.
- **Actions:** same prompt as scenario 5.
- **Expected UI:** cards labeled *live* with real contract legs (strikes, expirations, mids, option symbols), net debit/credit, max loss/profit, breakeven; "Prepare in Trade Builder" offered.
- **Expected backend/MCP:** options-context token minted (5-min TTL, opaque); MCP receives the token, never broker OAuth tokens; MCP output scrubbed before reaching the client.
- **Pass/Fail:** ______  **Notes:** ______

## 7. Income without holdings
- **Prerequisites:** logged in, no positions/holdings.
- **Actions:** ask `Find income opportunities`.
- **Expected UI:** cash-secured-put style candidates or a clear explanation of what's possible without holdings; no covered-call suggestions against shares the user doesn't own.
- **Pass/Fail:** ______  **Notes:** ______

## 8. Income with holdings
- **Prerequisites:** logged in with broker connected and ≥100 shares of at least one liquid symbol.
- **Actions:** ask `Find income opportunities`.
- **Expected UI:** covered-call candidates against actual holdings appear alongside CSPs; position sizes respect share counts.
- **Expected backend/MCP:** positions read via broker integration server-side only.
- **Pass/Fail:** ______  **Notes:** ______

## 9. NO_TRADE outcome
- **Prerequisites:** logged in.
- **Actions:** ask for a setup on a symbol/condition unlikely to qualify (e.g., a low-liquidity name or extreme risk cap like `Find a trade with maximum loss of $5`).
- **Expected UI:** explicit NO_TRADE / no-results card with the reason; **no** fabricated candidate; app remains usable.
- **Pass/Fail:** ______  **Notes:** ______

## 10. Stock Trade Builder handoff
- **Prerequisites:** a qualified stock candidate card (with risk estimate/stop) from scenarios 2–4.
- **Actions:** click **Prepare in Trade Builder**. Review the Trade Builder page. Click **Send to InstaTrade™**. Review the ticket. Do **not** confirm.
- **Expected UI:** navigation happens only on your click; banner states the prefill source (ticket service vs card values) and that nothing is sent until you confirm; entry/stop/target/quantity prefilled and all editable; no order exists anywhere because you never confirmed.
- **Expected backend/MCP:** one POST `/api/trade/prepare-ticket` (auth required); zero order-placement calls.
- **Pass/Fail:** ______  **Notes:** ______

## 11. Option Trade Builder handoff
- **Prerequisites:** a *live* option candidate (scenario 6).
- **Actions:** click **Prepare in Trade Builder**; verify legs; open the option ticket; check the acknowledgment checkbox exists; do not confirm.
- **Expected UI:** real legs/strikes/expirations/mids from the card (never invented); credit structures routed as credit (not mislabeled debit spreads); explicit acknowledgment + confirm required; abandoning the flow submits nothing.
- **Pass/Fail:** ______  **Notes:** ______

## 12. Dependency failure
- **Prerequisites:** dev/staging where you can disable a dependency (unset `MCP_ENABLED`, break the options provider, or block OpenAI).
- **Actions:** repeat scenarios 1, 2, and 5.
- **Expected UI:** clear degraded states — scan-failed cards, card-value fallbacks with warnings, or "try again later" messaging. The app never crashes, never spins forever, and never fabricates data to fill the gap.
- **Expected backend:** errors logged without credentials; failed handoffs return errors and submit nothing.
- **Pass/Fail:** ______  **Notes:** ______
