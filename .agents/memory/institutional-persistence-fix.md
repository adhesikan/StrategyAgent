---
name: Institutional persistence abort + resumability fix
description: Root cause, fix, and contract for the 20-min timeout truncation bug in the 13F persistence pipeline
---

## The Bug
`ingestFromDescriptor` and `ingestQuarter` had `if (signal.aborted) break` inside the accession loop, but then continued to return `status: "completed"` because they checked `parseResult.status`, not whether the loop was aborted. Result: only ~570 / 9,716 filings stored, run marked "completed", next quarter skipped because the outer orchestrator also checked the already-aborted signal.

## The Fix
- Both functions now track `abortedEarly` boolean; return `status: "partial" + abortedByTimeout: true` when aborted.
- The outer orchestrator loop in `runInstitutionalIngestion` checks `controller.signal.aborted` at each iteration — so once the signal fires, no further descriptors start. That's intentional. The `abortedByTimeout: true` in the run record tells operators to re-run.

**Why:** `parseResult.status === "success"` even when the persistence loop was cut short — the parse itself succeeded, only the DB writes were incomplete.

## Resumable Skip (Orchestrator Level)
Before processing each descriptor, `runInstitutionalIngestion` queries `institutionalIngestionRuns` for `status=completed AND filingCount>0 AND holdingCount>0`. If found, the descriptor is skipped (logged as `institutional_13f_quarter_skipped_completed`). This makes re-runs safe: partial runs pick up where they left off via the accession-level idempotency check.

**How to apply:** Pass `force: true` to override the skip (e.g. after a mapping refresh or schema migration). `--force` flag exists in `run-institutional-backfill.ts`.

## Idempotency Within the Accession Loop
An accession is complete only when its persisted holding count exactly matches the bounded validation pass's expected count. A filing row by itself is not proof of completion. Mismatched accessions are made non-effective, their partial holdings are deleted, and the accession is replayed from the validated source; effectiveness is finalized only at the accession-complete boundary.

**Why:** A process crash can commit some batches and leave the filing row behind. Existence-only skipping would permanently misclassify that partial accession as complete.

**How to apply:** DRY_RUN and APPLY must use the same count-based completion rule. Holding counts must be aggregated in the database; never load a quarter's holdings merely to decide resumability.

## Cancellation Boundary
A single signal must reach archive download, entry streams, readline, serial batch consumption, persistence sub-batches, mapping pages, and materialization. Cancellation closes active streams, stops before the next database write, leaves the active accession non-effective, and releases the advisory lock in `finally`.

**Why:** Checking cancellation only between accessions can leave decompression running, continue batch writes, or misclassify an interrupted run.

**How to apply:** Preserve `CANCELLED` as its own failure code; never collapse it into source-unavailable or parse-failed classifications.

## PERSISTENCE_COUNT_MISMATCH
Raised when: `holdingCount === 0 AND eligibleCommonStockRows > 1000 AND totalAccessions > 0 AND !abortedEarly AND NOT all-existing`. Stored as `errorCode: "PERSISTENCE_COUNT_MISMATCH"` in the run record. Threshold: `MIN_ELIGIBLE_FOR_MISMATCH_CHECK = 1000`.

## Progress Logging
`logPersistenceProgress` fires every `PROGRESS_LOG_INTERVAL = 100` accessions as `institutional_13f_persistence_progress` event. Includes `elapsedSeconds`, `rowsPerSecond`, processed/total counts. Prevents silent 20-minute gaps.

## New Fields on QuarterIngestionResult
- `skippedExistingFilings: number` — required; 0 for early-exit paths
- `abortedByTimeout?: boolean`
- `persistenceCountMismatch?: boolean`
- `errorCode?: string`

## Verification Script
`scripts/verify-institutional-ingestion.ts --quarter YYYYQN` — read-only; prints count waterfall + PASS/WARNING/FAIL verdict. Never writes. Exit 0 = PASS.

## Test Coverage
`server/services/institutional/__tests__/ingestion-persistence.test.ts` — 15 tests covering abort, skip, force, errorCode propagation, sequential descriptors, advisory lock, idempotent re-run, false-completed prevention.
