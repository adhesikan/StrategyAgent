---
name: Sprint 2.7.7 — End-to-End Platform Validation & Production Readiness Gate
description: Release certification sprint; quality gate framework; schema column names; job status store API; compliance test patterns; GO decision for Phase 2.8
---

## Decision: CONDITIONAL_GO to Phase 2.8
All P0/P1 acceptance criteria pass. Two HIGH dep vulns documented with mitigations scheduled.

## Quality Gate Framework (npm run test:release)
10 test suites, all mandatory pre-deploy:
- test:smoke / test:regression / test:integration / test:security / test:lifecycle (5 original)
- test:migrations / test:compliance / test:db / test:invariants / test:idempotency (5 new)
- test:e2e (Playwright — requires PLAYWRIGHT_TEST_USER credentials; chromium binaries need install)
- test:smoke:production (tsx script, needs SMOKE_BASE_URL + SMOKE_SESSION_COOKIE)

## Critical Schema Column Facts (prevent future test failures)
- `tradePlanVersions`: version (integer, not versionNumber), researchSnapshot/planningSnapshot/structureSnapshot/riskSnapshot (not single "snapshot")
- `workspaceConversations`: researchMode (not "mode"), contextScope, contextType — no "mode" column
- `opportunityScanSnapshots`: requestFingerprint (not scanId)
- `institutional13fFilings`: filerName + filerCik (after COVERPAGE join fix) — NOT managerName/filingManagerName
- `portfolioPositions`: NO userId — ownership via portfolioId → portfolios.userId

## Job Status Store API
Uses module-level functions (NOT a class):
- markJobStarted(name, meta?)
- markJobCompleted(name, opts: {})
- markJobFailed(name, opts: { errorMessage?, errorCode?, meta? })  ← opts is object, not string
- getJobStatus(name) → { status: "running"|"completed"|"failed", ... }

## Function Name Corrections
- computeLifecycleState (NOT determineLifecycleState)
- getOpportunityIntelligence (NOT getLatestOpportunityIntelligence)
- RESEARCH_REVIEW_CHECKLIST_DISCLAIMER is in shared/trade-plan-types (NOT trade-plan-lifecycle-types)

## Compliance Test Pattern — "guaranteed"
Glossary legitimately uses "guaranteed" in negating context ("not a guaranteed fill price"). 
Rule: check labels+shortDefinition for strict forbidden phrases; for "guaranteed" in fullDefinition/caution, allow only when preceded by "not" (context guard via regex).

## npm test vs npm run test:release
`npm test` runs ALL files including .cache/ bun package tests and E2E (both pre-existing failures).
`npm run test:release` runs only the 10 targeted suites — 313 tests, 0 failures — use this as the gate.

## Documentation Created
- docs/operations/35-end-to-end-validation-and-production-readiness.md — full validation record
- docs/releases/research-trade-planning-v1-production-readiness.md — release certification artifact
- docs/operations/13-production-release-checklist.md — updated with quality gate table
- docs/operations/15-known-issues-and-backlog.md — KI-005/KI-006/KI-007 added
- docs/operations/17-sprint-change-log.md — Sprint 2.7.7 entry added

## Why:
Release certification confirms architectural separation from execution boundary is clean before Phase 2.8 adds order submission. Quality gate framework catches compliance regressions early.
