---
name: Broker Sync (Sprint 2.4.2)
description: Broker synchronization architecture — routes, idempotency pattern, concurrent guard, logging rules, and test traps.
---

## Architecture

- `server/services/broker-sync-service.ts` — core sync; in-memory per-portfolio state; `runningSyncs` Set for concurrent guard
- `server/routes/broker-sync.ts` — 5 routes under `/api/portfolio/broker/`
- `client/src/pages/portfolio-connect.tsx` — Connection Center at `/portfolio/connect`
- `portfolios.sourceAccountId` (text) holds provider name ("tradier" | "tradestation") for broker-linked portfolios
- No new DB tables needed; `portfolioSourceTypeEnum` already had "broker"

## Idempotency pattern

`syncPortfolioFromBroker`: delete all existing positions → normalize → insert fresh. Never upsert-by-symbol — delete-then-insert is the idempotent pattern. Confirmed by test order assertion (deleteIdx < insertIdx).

## Concurrent guard

`runningSyncs.add(portfolioId)` at start, `runningSyncs.delete(portfolioId)` in `finally`. Routes return 409 if `isPortfolioSyncRunning(portfolioId)`. Never lock across users — per-portfolio only.

## Structured log rules

- Events: `broker_sync_started`, `broker_sync_completed`, `broker_sync_failed`
- `userId: "[redacted]"` — never log real userId
- Never log: `accessToken`, `refreshToken`, `accountId` (account number), raw credentials
- Tests check `'"[redacted]"'` present in service source

## Disconnect behavior

`DELETE /api/portfolio/broker/disconnect/:portfolioId`:
- Sets `portfolios.sourceType = "manual"`, `sourceAccountId = null`
- Sets `portfolioPositions.sourceType = "manual"` (update, not delete)
- Keeps all positions — never deletes on disconnect
- Does NOT revoke broker OAuth token (separate user action in settings)

## Test traps

- "password" and "api key" appear in the connect page's security notice ("No passwords or API keys are stored") — tests must check for exposure patterns (e.g. `type="password"`, `accesstoken:`) not the bare words.
- Route chains `db\n  .update(portfolioPositions)` across lines — test must use `.update(portfolioPositions)` not `db.update(...)`.

## Scheduler interface

`runBrokerSync(userId)` is exported but NOT wired to any cron yet. Future scheduler calls this to sync all broker portfolios for a user.

**Why:** Fire-and-forget per portfolio (no await) inside runBrokerSync so one portfolio failure doesn't block others.

## Platform health

`checkBrokerSync()` in platform-health.ts uses `getBrokerSyncHealth()` from the service. Status: DEGRADED if any failed/needs_reauth; DISABLED if no portfolios linked.
