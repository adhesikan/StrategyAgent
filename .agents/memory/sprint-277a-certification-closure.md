---
name: Sprint 2.7.7A — Production Certification Closure
description: Dep upgrades (6 packages, 7 HIGHs resolved); E2E canonical credential names; CONDITIONAL_GO→UPGRADED; Phase 2.8.0 APPROVED
---

## Final Dep Audit State
HIGH: 17 → 10 (after Sprint 2.7.7A upgrades)
Critical: 0

## Packages Upgraded (all pass test:release 313/313)
- drizzle-orm: 0.39.3 → 0.45.2 (GHSA-gpj5-g38j-94v9 SQL injection — RESOLVED)
- adm-zip: 0.5.16 → 0.6.0 (GHSA-xcpc-8h2w-3j85 memory exhaustion — RESOLVED)
- express: ^4.21.2 → 4.22.2 (path-to-regexp/body-parser/qs HIGHs — RESOLVED)
- vite: ^7.3.0 → 7.3.5 (multiple HIGHs — RESOLVED; dev-only)
- ws: ^8.18.0 → 8.21.3 (GHSA-58qx-3vcg-4xpx — RESOLVED)
- postcss: ^8.4.47 → 8.5.26 (multiple HIGHs — RESOLVED; dev-only)

## Remaining Direct HIGH (Formally Accepted)
- xlsx * — no fix available; bounded to authenticated file uploads; plan 2.9.x alternative
- snaptrade-typescript-sdk 9.0.x — via axios; optional provider; no unsafe code path

## E2E Credential Canonical Names (Sprint 2.7.7A)
- TEST_USER_EMAIL (preferred, new canonical)
- TEST_USER_PASSWORD (preferred, new canonical)
- PLAYWRIGHT_TEST_USER / PLAYWRIGHT_TEST_PASS (legacy aliases, still accepted)
- PLAYWRIGHT_RELEASE_CERT=1 → certification mode; missing credentials = FAIL not SKIP
- TEST_ADMIN_EMAIL / TEST_ADMIN_PASSWORD → for admin boundary tests (Phase 2.8.x)

## E2E Skip Policy
- Development: SKIPPED = acceptable
- PLAYWRIGHT_RELEASE_CERT=1: SKIPPED = NOT_READY (certification gate fails)

## Certification Decision
CONDITIONAL_GO (UPGRADED). Remaining for FULL GO:
1. Configure TEST_USER_EMAIL + TEST_USER_PASSWORD via secrets
2. Run npx playwright install chromium
3. Run npm run test:e2e — flows A–F must PASS
4. Deploy to Railway, run npm run test:smoke:production

## Phase 2.8 Entry
Phase 2.8.0 APPROVED (architecture/preflight only).
Order submission (2.8.5) blocked — 11 execution security gates not yet implemented.

## Why:
Certification sprint must not count E2E skips as PASS. PLAYWRIGHT_RELEASE_CERT=1 surfaces this explicitly. Dep upgrades reduce runtime attack surface before broker execution phase.
