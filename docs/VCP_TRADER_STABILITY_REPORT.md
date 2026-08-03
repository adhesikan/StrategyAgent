# VCP Trader — Steps 1–9 Stability & User-Flow Audit Report

**Date:** 2026-08-03
**Scope:** Command Center → Ask AI → MCP tools → structured analysis/candidates → Trade Builder handoff.
**Constraints honored:** no new product features, no UI redesign, no scanner/execution changes, nothing committed or deployed.

---

## 1. Inventory (summary)

- **Authenticated routes:** `/home` (AI Command Center), `/ideas`, `/ask`, `/scanner`, `/trade/:ticker` (Trade Builder), `/instatrade`, `/opportunity-radar`, `/trade-setups`, `/goal-mode`, `/income-mode`, `/market-intel`, `/journal`, `/settings/*`, plus admin-only `/automation`, `/execution`, `/opportunities`, `/admin/*` (gated in `client/src/App.tsx`).
- **Ask AI orchestration:** `POST /api/ask` (`server/routes/ask.ts`, authenticated). Deterministic intent classifier routes best-trade / income / growth / news / trade-idea before any generic LLM answer; `Analyze <SYM>` routes to the MCP `scan_vcp` analysis path; educational questions fall through to the rule-based/LLM educational answer.
- **MCP:** `server/mcp/{client,tools,config}.ts`. 17-tool allowlist; the AI itself may only invoke `get_quote`, `get_market_history`, `get_news`, `scan_vcp` — all other tools are backend-orchestrated. `MCP_ENABLED=true` + `MCP_BASE_URL` + `MCP_SERVICE_TOKEN` required; bearer token is backend-only. All MCP output passes `scrubUntrusted` before reaching the client or LLM.
- **Options-context boundary:** opaque 32-byte token, SHA-256-hashed at rest, 5-minute TTL (`server/services/options-context.ts`). Broker OAuth tokens never leave the backend.
- **Internal APIs:** internal market/scanner/options endpoints authenticated via `VCP_INTERNAL_API_KEY` (+ `X-Options-Context` where applicable); reads are stored-data reads (no scan-on-read).
- **Trade Builder handoff:** `POST /api/trade/prepare-ticket` (authenticated) returns a prefill draft only; the client navigates only on explicit click; InstaTrade confirmation (button + option acknowledgment checkbox) is the sole submit path. No order-placement write path was added.

## 2. Validation results

| Check | Result |
| --- | --- |
| Project test suites (16 files) | **281 + 7 = 288 tests, all passing** |
| `npm run build` | **PASS** (client + server bundle clean) |
| `npm run check` (tsc) | 48 pre-existing errors, **none in Steps 1–9 code** (see §3) |

**Fix made during audit:** `server/trading/brokers/rithmic/config.test.ts` was a script-style file with no vitest suites (failed the collected run); converted to a proper `describe`/`test` suite — 7 tests now pass. No production code changed.

Note: `vitest` must be run as `npx vitest run --root . --exclude "**/.cache/**"`; the default root resolves to `client/` and an unfiltered run sweeps cached third-party packages.

## 3. `npm run check` classification

All 48 errors are **unrelated legacy issues** outside the Steps 1–9 surface:
`server/storage.ts` (18), `server/routes/agent.ts` (12), `shared/plans.ts` (3), `server/strategies/vcpMultiday.ts` (3), `server/routes.ts` (3, Map-iteration target flags), `server/services/best-trade-finder.ts` (2), plus 1 each in `futuresWorker.ts`, `classicPullback.ts`, `index.ts`, `algopilotx.ts`, `agent-worker.ts`, `pages/scanner.tsx`, `pages/agent.tsx`. Zero errors in ask/MCP/opportunity-search/prepare-ticket/trade-detail/command-center files. No new errors were introduced.

## 4. Audit-area classification

| Area | Status | Evidence |
| --- | --- | --- |
| Internal API contracts (auth, schema, filters, null fields, no scan-on-read, provider errors, no sensitive fields) | **PASS** | `server/routes/internal-scanner.test.ts`, `internal-market.test.ts`, `internal-options.test.ts` |
| MCP client/orchestration (allowlist, scrubbing, disabled/unavailable, malformed payloads) | **PASS** | `server/mcp/mcp.test.ts`, `server/routes/opportunity-search-mcp.test.ts` |
| Ask AI deterministic routing (analyze, setups, bullish, VCP, momentum, max-loss, options-under-$X, income) | **PASS_WITH_LIMITATIONS** | Covered at handler level (`analysis-scan.test.ts`, `opportunity-search*.test.ts`); no end-to-end HTTP test of every intent through `/api/ask`; educational fallback lightly tested |
| Structured response audit (vcpAnalysis, vcpScanFailed, candidates, estimated/live options, NO_TRADE, no-results, missing/null fields) | **PASS** | `client/src/lib/vcp-analysis.test.ts`, `opportunity-search.test.ts`, server MCP suites |
| Command Center | **PASS_WITH_LIMITATIONS** | Logic covered by `command-center.test.ts`; no mounted-page/browser integration test (load, mobile layout, panel failure isolation → manual) |
| Ask AI presentation (majorHigh labeling, pivot semantics, contraction sequence, estimated/live distinction, no fake premiums, confidence = data quality) | **PASS** | `vcp-analysis.test.ts`, `opportunity-search.test.ts` |
| Trade Builder handoff (prefill, eligibility, editable values, stale-source warning, explicit confirm, no auto-execution) | **PASS** | `prepare-ticket.test.ts` (9), `opportunity-search.test.ts` handoff block; architect-reviewed; failed handoff returns an error and submits nothing |
| Security (MCP/internal/broker tokens backend-only, options-context opacity, no new write path, logs credential-free) | **PASS_WITH_LIMITATIONS** | `options-context.test.ts`, `mcp.test.ts`, internal API auth tests; **no dedicated admin-endpoint auth test exists** (manual verification advised) |
| Failure injection (MCP down, scanner failure, null setup, options provider down, expired context, malformed MCP payload) | **PASS** | Covered across MCP/opportunity/internal suites; app degrades with warnings, never fabricates data |
| OpenAI-unavailable behavior | **MANUAL_TEST_REQUIRED** | No automated test; deterministic routes don't depend on OpenAI, but the educational path should be spot-checked (UAT §12) |
| Live-broker option flows, live MCP field names | **MANUAL_TEST_REQUIRED** | Dev has `MCP_ENABLED` unset and no broker sandbox; UAT §6, §8, §11; existing project tasks already track live-MCP verification |

## 5. Manual tests required

See `docs/TRADING_PLATFORM_UAT.md` (12 scenarios). The ones that genuinely require a human/live environment:
- Live MCP end-to-end (`Analyze MU`, scanner field names) — already tracked as project tasks.
- Live options with a connected broker (scenarios 6, 8, 11) — **requires a broker account**; cannot be validated in dev.
- Mobile layout and market-panel failure isolation on `/home`.
- OpenAI-unavailable educational fallback.

## 6. Broker requirement

Live-option candidates, income-with-holdings, and the option handoff's live-leg prefill can only be fully validated with a connected broker (Tradier/TradeStation/SnapTrade) in a sandbox or real account. Everything else validates without one.

## 7. Recommendation

**CONDITIONAL_GO** for beginning the Investment Intelligence domain.

The Steps 1–9 surface is stable: 288 automated tests pass, the build is clean, all type errors are pre-existing legacy debt outside this surface, security boundaries (MCP token, options-context, scrubbing, explicit-confirm) are enforced and tested, and failure modes degrade without fabricating data.

Conditions before relying on the integrated flow in production:
1. Complete the live-MCP verification tasks already in the queue (Analyze MU end-to-end; scanner field-name parity).
2. Run UAT scenarios 6/8/11 once a broker sandbox is available.
3. Spot-check admin-endpoint auth and the OpenAI-unavailable educational path (no automated coverage today).

Nothing was committed, pushed, or deployed.
