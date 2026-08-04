---
name: Portfolio Context Trust Boundary
description: Sprint 4D — how the opaque portfolio context token flows and what safe fields reach the client.
---

# Portfolio Context Trust Boundary (Sprint 4D)

## The rule
- Server mints a short-lived opaque token via `issuePortfolioContext(userId)`.
- Token is passed **only** to MCP tool args (`portfolioContextToken`). Never to OpenAI, never to browser.
- MCP may call back to `GET /api/internal/portfolio/context` (bearer key + `X-Portfolio-Context` header) to fetch safe fields.
- Server also computes `SafePortfolioAwareness` independently via `computePortfolioAwareness()` and includes it in `res.json({ portfolioAwareness })` — this is what the client sees.
- Token is revoked immediately after the MCP call completes (try/finally pattern).

**Why:** Broker OAuth tokens, account IDs, and raw balances must never reach the LLM or the browser. The opaque token is the only credential that crosses the process boundary.

## How to apply
- `server/services/portfolio-context.ts` — mint/resolve/revoke (same store pattern as options-context.ts).
- `server/routes/internal-portfolio.ts` — internal endpoint + `computePortfolioAwareness` (pure, exported).
- `server/routes/ask.ts` — mint before recommend/rank MCP calls; revoke in finally/after; include `portfolioAwareness` in res.json.
- `client/src/lib/portfolio-awareness.ts` — client-side type mirror (no IDs, no balances).
- `client/src/components/portfolio-fit-card.tsx` — renders safe derived fields only.

## Safe fields (SafePortfolioAwareness)
existingPosition (shares+unrealizedPnl), verifiedShares, duplicateExposure, concentrationWarning (pct+level), cashSufficiency, buyingPowerSufficiency, existingOptionExposure, sizingAdjustment, contextFreshness.
Never: account ID, equity dollar amount, buyingPower dollar amount, broker token, userId.

## 502 vs 200 for broker failures
`Promise.allSettled` — only return 502 when BOTH getPositions and getAccounts fail. One succeeds → partial awareness with 200.
