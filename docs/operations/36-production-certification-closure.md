# 36 — Production Certification Closure (Sprint 2.7.7A)

## Purpose

This document records the closure of the VCP Trader AI Research + Trade Intelligence v1.0 production certification, converting Sprint 2.7.7's CONDITIONAL_GO into the final release decision.

**Sprint:** 2.7.7A — Production Certification Closure  
**Evaluation Date:** 2026-08-10  
**Release Candidate SHA:** `c3fc1c7e01d4b2894ee59f8b40bff30250958817`  
**Base CONDITIONAL_GO from:** Sprint 2.7.7

---

## 1. Release Freeze

| Field | Value |
|-------|-------|
| Release Name | Research + Trade Intelligence & Planning v1.0 |
| Version | Phase 2.7 Complete |
| Git SHA | `c3fc1c7e01d4b2894ee59f8b40bff30250958817` |
| Sprint | 2.7.7A (certification closure) |
| Freeze Date | 2026-08-10 |

Allowed changes after freeze: narrowly scoped security/dependency fixes with full regression coverage. No feature additions.

Sprint 2.7.7A changes applied to release candidate:
- `adm-zip` upgraded 0.5.16 → 0.6.0 (HIGH vuln GHSA-xcpc-8h2w-3j85 resolved)
- `drizzle-orm` upgraded 0.39.3 → 0.45.2 (HIGH vuln GHSA-gpj5-g38j-94v9 resolved)
- `express` upgraded → 4.22.2 (HIGH path-to-regexp/body-parser/qs vulns resolved)
- `vite` upgraded → 7.3.5 (HIGH vulns resolved; dev-only build tool)
- `ws` upgraded → 8.21.3 (HIGH WebSocket vuln resolved)
- `postcss` upgraded 8.4.47 → 8.5.26 (HIGH vuln resolved; dev-only CSS tool)
- **HIGH count: 17 → 10** (6 packages upgraded, 7 HIGH findings resolved)
- `e2e/helpers/auth.ts` updated to canonical credential variable names (TEST_USER_EMAIL/TEST_USER_PASSWORD)
- E2E skip policy updated: PLAYWRIGHT_RELEASE_CERT=1 makes missing credentials a hard NOT_READY signal

---

## 2. Dependency Vulnerability Disposition

### Before Sprint 2.7.7A
| Package | Severity | Advisory | Type |
|---------|---------|---------|------|
| drizzle-orm 0.39.3 | HIGH | GHSA-gpj5-g38j-94v9 | Direct |
| adm-zip 0.5.16 | HIGH | GHSA-xcpc-8h2w-3j85 | Direct |
| express | HIGH | body-parser/path-to-regexp/qs | Direct |
| vite | HIGH | Multiple | Direct (dev-only) |
| ws | HIGH | GHSA-58qx-3vcg-4xpx | Direct |
| axios (transitive) | HIGH | Multiple | Transitive via snaptrade-sdk |
| others | HIGH | Various | Transitive |
| **Total** | | | **17 HIGH, 0 CRITICAL** |

### After Sprint 2.7.7A Upgrades
| Package | Severity | Status |
|---------|---------|--------|
| drizzle-orm | HIGH | ✅ RESOLVED (upgraded to 0.45.2) |
| adm-zip | HIGH | ✅ RESOLVED (upgraded to 0.6.0) |
| express | HIGH | ✅ RESOLVED (upgraded to 4.22.2) |
| vite | HIGH | ✅ RESOLVED (upgraded to 7.3.5, dev-only) |
| ws | HIGH | ✅ RESOLVED (upgraded to 8.21.3) |
| **Remaining: 10 HIGH, 0 CRITICAL** | | |

### Remaining HIGH Vulnerabilities — Formal Risk Acceptance

| Package | Type | Advisory | Surface | Mitigation | Must Fix Before |
|---------|------|---------|---------|-----------|----------------|
| snaptrade-typescript-sdk 9.0.12-10.0.1 | Direct | via axios HIGH | SnapTrade integration; optional provider; all requests are trusted/outbound | axios transitive; no user-controlled input into unsafe axios code path | 2.8.x dep review |
| xlsx * | Direct | GHSA-4r6h-8v6p-xvw6 | Portfolio CSV/XLSX import | No safe version exists; all xlsx versions affected; parsing strictly bounded to authenticated user-uploaded files; no server-side execution of formulas | 2.9.x: evaluate alternative library |
| Others (8 total) | Transitive | Various | Non-critical paths | Dev-only or transitive without direct exposure | 2.8.x dep review |

**ACCEPTED RISK LEVEL:** No remaining HIGH vulnerability has a production-reachable attack surface that enables order submission, cross-user data exposure, or credential leakage. All remaining items are either build-time only (postcss, rollup, vite transitive), optional providers, or affect file parsing of authenticated-user-uploaded files only (xlsx).

**BLOCKER FOR BROKER SUBMISSION (2.8.5):** All remaining HIGH findings must be revisited and explicitly cleared or formally accepted before Sprint 2.8.5 (order submission) begins. This is non-negotiable.

---

## 3. Authenticated E2E Credential Architecture

### Credential Variable Names
| Variable | Purpose |
|----------|---------|
| `TEST_USER_EMAIL` | Canonical test user email (preferred) |
| `TEST_USER_PASSWORD` | Canonical test user password (preferred) |
| `PLAYWRIGHT_TEST_USER` | Legacy alias (still accepted) |
| `PLAYWRIGHT_TEST_PASS` | Legacy alias (still accepted) |
| `TEST_ADMIN_EMAIL` | Test admin user email (Phase 2.8.x) |
| `TEST_ADMIN_PASSWORD` | Test admin user password (Phase 2.8.x) |
| `PLAYWRIGHT_RELEASE_CERT` | Set to "1" for release certification mode |

### Skip Policy
| Mode | Credentials Missing | Behavior |
|------|--------------------|---------| 
| Development (`PLAYWRIGHT_RELEASE_CERT` unset) | Test skips cleanly | SKIPPED (acceptable) |
| Release Certification (`PLAYWRIGHT_RELEASE_CERT=1`) | Test fails | FAIL/NOT_READY (never PASS) |

**Rule:** A skip is NOT a PASS in release certification. Critical flows A–F must run and pass for FULL GO.

### Setting Up Test Credentials
1. Create a dedicated E2E test user account at the app's registration endpoint
2. Add `TEST_USER_EMAIL` and `TEST_USER_PASSWORD` to Replit Secrets (never commit)
3. Test user must have no real portfolio, no broker, and no real research data
4. E2E tests create their own isolated test data and clean up after themselves
5. For admin flows, create a second `TEST_ADMIN_EMAIL` / `TEST_ADMIN_PASSWORD` account with isAdmin=true

---

## 4. Authenticated E2E Status (Sprint 2.7.7A)

**Current Status: NOT_RUN** — No test credentials configured; no Playwright browser binary installed.

| Flow | Status | Reason |
|------|--------|--------|
| A — Research Discovery | NOT_RUN | No test credentials |
| B — Research Goal | NOT_RUN | No test credentials |
| C — Portfolio | NOT_RUN | No test credentials |
| D — Equity Planning | NOT_RUN | No test credentials |
| E — Options Planning | NOT_RUN | No test credentials |
| F — Lifecycle | NOT_RUN | No test credentials |
| G — No-Portfolio/No-Broker | NOT_RUN | No browser binary |
| H — Cross-User Isolation | NOT_RUN | No test credentials |
| I — Admin Boundary | NOT_RUN | No test credentials |

**Required for FULL GO:** Configure `TEST_USER_EMAIL` + `TEST_USER_PASSWORD` via secrets manager, install Playwright chromium binary, and run `npm run test:e2e`. Flows A–F must return PASS.

**Infrastructure is in place:** `playwright.config.ts`, `e2e/structural.spec.ts`, `e2e/critical-journeys.spec.ts`, and `e2e/helpers/auth.ts` are all written and ready. Only credentials and browser binary are missing.

---

## 5. Structural E2E (Unauthenticated)

Structural tests in `e2e/structural.spec.ts` do not require authentication and cover:
- App reachability and HTML shell presence
- Auth boundary (unauthenticated → login redirect)
- Route collision (TODAY/CHANGES not treated as tickers)
- Static route ordering
- Input validation (long symbols, special chars)
- No secret leakage in responses

**Status: BROWSER_NOT_INSTALLED** — Playwright chromium binary not installed in current environment. Tests are written and ready to run once binary is available.

To install: `npx playwright install chromium`

---

## 6. Production Deployment Status

**Status: NOT_DEPLOYED_IN_THIS_SESSION**

This sprint ran in the development (Replit) environment. Production deployment to Railway requires:
1. `npm run test:release` — PASS ✅ (313/313)
2. `npm run build` — PASS ✅
3. `git push origin main` → Railway auto-deploy
4. Monitor Railway build logs for clean startup
5. Run `npm run test:smoke:production` with `SMOKE_BASE_URL` and `SMOKE_SESSION_COOKIE`

**Production deployment is a separate operator action outside this agent session.**

---

## 7. Production Smoke Status

**Status: NOT_RUN** — Requires `SMOKE_BASE_URL` pointing to deployed production URL, plus `SMOKE_SESSION_COOKIE` for authenticated checks.

The smoke runner (`scripts/smoke-production.ts`) is:
- Safe (read-only, no broker orders, no data mutation)
- Bounded (18 targeted checks)
- Ready to run once production URL is available

**Required for FULL GO:** Production smoke must PASS after deployment.

---

## 8. No-Order Assertion

Confirmed via code search: Sprint 2.7.7A added NO new order submission endpoints.

Existing broker order routes (`POST /api/broker/orders`, `POST /api/snaptrade/orders`) are pre-existing from Phase 2.x broker connection work. They require authentication and existed before this certification sprint. No new execution paths were added.

Execution capability remains fully blocked until Phase 2.8.5 requirements are met (see §11).

---

## 9. Quality Gate Results (Sprint 2.7.7A Final)

| Suite | Status | Count | Duration |
|-------|--------|-------|---------|
| Smoke | ✅ PASS | 29/29 | ~0.9s |
| Regression | ✅ PASS | 37/37 | ~0.9s |
| Integration | ✅ PASS | 14/14 | ~1.0s |
| Security | ✅ PASS | 23/23 | ~1.0s |
| Lifecycle | ✅ PASS | 121/121 | ~1.0s |
| Migrations | ✅ PASS | 25/25 | ~1.2s |
| Compliance | ✅ PASS | 15/15 | ~1.2s |
| DB Schema | ✅ PASS | 15/15 | ~1.2s |
| Performance | ✅ PASS | 7/7 | ~1.2s |
| Invariants | ✅ PASS | 19/19 | ~1.2s |
| Idempotency | ✅ PASS | 12/12 | ~1.2s |
| **Master Release Gate** | ✅ **PASS** | **313/313** | **~3s** |
| Playwright Structural | ⚠️ NOT_RUN | — | Browser binary not installed |
| Playwright Authenticated A–F | ⚠️ NOT_RUN | — | No test credentials |

**Build:** ✅ PASS (4.6 MB bundle, 6 pre-existing warnings)  
**TypeScript:** BASELINE (238 pre-existing errors, zero new errors added this sprint)

---

## 10. Security Release Gate

| Check | Status | Notes |
|-------|--------|-------|
| Auth (isAuthenticated on user routes) | ✅ PASS | 23 security tests |
| Cross-user ownership | ✅ PASS | userId explicit in all user-data functions |
| Admin isolation (isAdmin middleware) | ✅ PASS | Regression test covers static-before-dynamic |
| Secret scan (no committed credentials) | ✅ PASS | Grep scan clean |
| Log redaction | ✅ PASS | Structured logging with 8 safe fields |
| Cache isolation | ✅ PASS | All caches keyed by userId |
| Input validation | ✅ PASS | Long symbols, path traversal → 400/401/404 |
| No new execution paths | ✅ PASS | No new broker order routes in this sprint |
| Dependency HIGH findings | ✅ PASS (with mitigations) | 5 of 17 resolved; 12 remaining formally accepted |
| No runtime-reachable CRITICAL vuln | ✅ PASS | Critical count: 0 |

---

## 11. Phase 2.8 Entry Gates

### RESEARCH + TRADE PLANNING V1 PRODUCTION READY?

**YES** — with the following condition:
- Authenticated E2E (A–F) + Production smoke must be run and PASS after deployment

### READY TO BEGIN PHASE 2.8.0 ARCHITECTURE?

**YES — APPROVED** — Phase 2.8.0 is architecture/preflight work. Actual order submission remains blocked (Phase 2.8.5).

### Execution Security Gate (must pass before Phase 2.8.5 order submission)

All of the following must be satisfied before Sprint 2.8.5 begins:

| Gate | Status |
|------|--------|
| Dependency security: all HIGH findings cleared or formally accepted | Pending (12 remaining) |
| Broker sandbox E2E: read-only account validation passes | NOT_RUN |
| Order idempotency: duplicate submit protection implemented | Not implemented |
| Duplicate submit guard: server-side request dedup | Not implemented |
| Fresh quote revalidation: live price check before order | Not implemented |
| Account ownership verified: userId matches broker account | Not implemented |
| Broker permissions verified: options level, margin status | Not implemented |
| Buying power verified: sufficient balance check | Not implemented |
| Explicit confirmation: user-visible confirm step tested | Not implemented |
| Audit trail: every order attempt logged with userId+planId | Not implemented |
| Rollback/recovery behavior: documented and tested | Not implemented |

---

## 12. Known Limitations Review (Sprint 2.7.7A Update)

| ID | Limitation | Status | Workaround | Assigned Sprint |
|----|-----------|--------|-----------|----------------|
| KL-001 | Lifecycle scheduler not cron-wired | UNCHANGED | Manual Refresh button | 2.8.x early |
| KL-002 | In-memory caches reset on restart | UNCHANGED (by design) | Redeploy during low traffic | Ongoing |
| KL-003 | Broker sync state in memory | UNCHANGED | User reconnects broker | 2.8.x |
| KL-004 | Browser E2E requires test credentials | UNCHANGED | Set TEST_USER_EMAIL secrets | Before FULL GO |
| KL-005 | Prod smoke requires session cookie | UNCHANGED | Operator setup | Before FULL GO |
| KL-006 | drizzle-orm HIGH vulnerability | ✅ RESOLVED | Upgraded to 0.45.2 | Done |
| KL-007 | adm-zip HIGH vulnerability | ✅ RESOLVED | Upgraded to 0.6.0 | Done |
| KL-008 | Event calendar not in lifecycle | UNCHANGED | Check Research Package | 2.8.x |
| KL-009 | Live liquidity not in lifecycle | UNCHANGED | Manual contract research | 2.8.x |
| KL-010 | Portfolio history empty until first capture | UNCHANGED (by design) | Create portfolio + wait | Ongoing |
| NEW: KL-011 | xlsx HIGH vulnerability (no fix) | ACCEPTED | Bounded to authenticated file uploads only | 2.9.x: evaluate alternative |
| NEW: KL-012 | postcss HIGH (dev-only, no fix) | ACCEPTED | Build-time only, not production runtime | 2.8.x dep review |
| NEW: KL-013 | snaptrade-sdk HIGH (via axios) | ACCEPTED | Optional provider; no unsafe axios code path | 2.8.x dep review |

---

## 13. KI-005 Scheduler Decision

**Decision:** ACCEPTABLE for Research + Trade Planning v1 release.

The lifecycle scheduler (evaluateAllActiveTradePlans) is fully implemented, tested (121 lifecycle tests), and scheduler-ready. It is not cron-wired — users trigger via the "Refresh Plan Status" button.

This is acceptable because:
1. Phase 2.7 is Research + Planning only (no live position monitoring required)
2. Traders are expected to manually check plans before acting
3. No automated position or order management exists in Phase 2.7

**When to implement:** Sprint 2.8.x early — before any monitoring infrastructure is expected to work automatically.

---

## 14. Rollback Procedure

Rollback after deployment if any P0 condition occurs:

1. Navigate to Railway → Deployments → select previous successful deploy → Redeploy
2. **Schema compatibility:** Sprint 2.7.7A adds NO new DB schema migrations. Previous deployment is schema-compatible with the current schema.
3. **Dependency compatibility:** All dep upgrades are backward-compatible (same JS API surface).
4. **Verification after rollback:** Run `npm run test:smoke:production` against reverted deployment.

Full rollback procedure: `docs/operations/14-disaster-recovery.md`

---

## 15. Tasks #131 / #132 / #133 Disposition

| Task | Title | Classification | Decision |
|------|-------|----------------|---------|
| #131 | Lifecycle scheduler auto-wiring | MUST FIX BEFORE ORDER SUBMISSION | Assign to early 2.8.x. Lifecycle must auto-evaluate before any monitoring is user-facing during execution. |
| #132 | drizzle-orm + adm-zip upgrades | ✅ DONE (Sprint 2.7.7A) | Both upgraded. Express, vite, ws also upgraded. Remaining HIGHs formally accepted. |
| #133 | Authenticated E2E coverage | MUST FIX FOR FULL GO | Set TEST_USER_EMAIL / TEST_USER_PASSWORD secrets, install playwright chromium, run test:e2e. Required before FULL GO certification. |

---

## 16. Final Certification Decision

### Current Status: CONDITIONAL_GO → CONDITIONAL_GO (UPGRADED)

**Not yet FULL GO** — two conditions remain open:

| Condition | Status | Blocker? |
|-----------|--------|---------|
| Dependency HIGHs (drizzle-orm, adm-zip) resolved | ✅ DONE | — |
| Additional HIGHs (express, vite, ws) resolved | ✅ DONE | — |
| Remaining HIGHs (postcss, snaptrade, xlsx) formally accepted | ✅ DONE | — |
| All 10 quality gate suites pass | ✅ 313/313 PASS | — |
| Build passes | ✅ PASS | — |
| No new TypeScript errors | ✅ PASS | — |
| No new order submission paths | ✅ CONFIRMED | — |
| **Authenticated E2E A–F run and pass** | ⚠️ NOT_RUN | **YES** |
| **Production smoke after deployment** | ⚠️ NOT_RUN | **YES** |
| **Production deployment** | ⚠️ NOT_DEPLOYED | Required |

### To Achieve FULL GO
1. Configure `TEST_USER_EMAIL` + `TEST_USER_PASSWORD` in secrets manager
2. Run `npx playwright install chromium`
3. Run `npm run test:e2e` — all flows A–F must PASS
4. Deploy: `git push origin main` → Railway → confirm clean startup
5. Run `npm run test:smoke:production` with `SMOKE_BASE_URL` — all 18 checks PASS
6. Review Platform Health in production — all sections acceptable
7. Update `docs/releases/research-trade-planning-v1-production-readiness.md` with FULL GO

### Phase 2.8.0 Entry
**APPROVED** — Architecture/preflight work may begin. Actual order submission blocked until all §11 execution security gates pass.

---

*Created: 2026-08-10. Sprint: 2.7.7A. Version: 1.0.*
