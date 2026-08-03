---
name: MCP Sprint-2 tool quirks
description: Argument names and data-mode gotchas for the deployed vcp-trader-mcp multi-strategy tools.
---
- `calculate_position_risk` requires `symbol` and only sizes with `maxRiskDollars` — `riskBudget`/`riskBudgetDollars` are silently ignored (warnings say "No account size or risk budget supplied").
- `build_trade_candidate` takes `{ symbol, strategy }` with the MCP's slug strategy ids (e.g. `momentum_breakout`), not VCP Trader's real ids (`VCP`).
- The MCP service can run in mock mode: setups come back with `source: "mock"` and mock basis strings. Check `source` before treating results as production data.
- Dev environment does not set `MCP_ENABLED`; force `MCP_ENABLED=true npx tsx <script>` for one-off live probes. The Ask AI orchestrator falls back to stored detections when MCP is disabled or failing.
**Why:** these were discovered by live probing; wrong arg names fail silently (no sizing) rather than erroring.
**How to apply:** any new MCP orchestration code or verification scripts touching these tools.
