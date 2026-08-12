---
name: Session persistence crash fix
description: Defect-6B root cause and fix — POST /session crashed Railway process because trade_planning_sessions never auto-created and handler had no try/catch.
---

## The rule

`trade_planning_sessions` is NEVER created by migrations scripts automatically on Railway. The canonical idempotent creator is `ensureTradePlanTables()` in `server/services/trade-plan-service.ts`.

**Why:** `migrations/028_trade_planning_sessions.sql` exists but no startup mechanism runs it. `runStartupMigrations()` in `server/index.ts` only handles inline `db.execute()` calls for specific tables. `ensureTradePlanTables()` runs on every startup (called from `server/routes.ts` line ~295) and logs `trade_plan_tables_ready` — it is the safe place to add table creation for trade-planning domain tables.

## How to apply

- Any new table in the trade planning domain (sessions, plans, versions, activity) MUST be added to `ensureTradePlanTables()` with `CREATE TABLE IF NOT EXISTS`.
- New columns for existing tables must use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` inside `ensureTradePlanTables()` (NOT in a separate migration file that nobody runs).
- CHECK constraints must use a DO $$ block with an `information_schema.table_constraints` guard.
- The POST handler for session creation MUST wrap `createPlanningSession` in try/catch, returning `500 { message, code: "SESSION_PERSISTENCE_FAILED" }`.

## Why GET endpoints masked the missing table

All GET handlers called `getLatestSessionForSymbol(userId, symbol).catch(() => null)` — the catch silently absorbed the missing-table error. Only the POST (INSERT) handler was the first to actually write to the table and had no safety net.

## Process survival contract

`server/index.ts` must have `process.on("unhandledRejection")` and `process.on("uncaughtException")` handlers that:
- Log structured JSON to console.error
- Do NOT call `process.exit()` — comments mentioning "process.exit" are fine; actual calls are forbidden in those handlers.

## Test file

`server/routes/__tests__/session-persistence.test.ts` — §DB1–§DB25 (62 tests). Add to `test:release` suite.
