# Institutional 13F — Railway Cron Setup

Sprint 2.2.5 converts the institutional data pipeline from a single long-blocking
process into a **resumable daily background job** that processes a bounded chunk
of accessions per invocation and exits cleanly.

## Overview

| Metric | Value |
|--------|-------|
| Cron schedule | `0 6 * * *` (06:00 UTC daily) |
| Command | `npx tsx scripts/run-institutional-daily.ts` |
| Target duration | ~12 minutes per invocation (300 new accessions default) |
| Total accessions (2026-Q1) | ~9,364 |
| Days to completion | ~31 at default rate (fully configurable) |
| Parallelism | Sequential; advisory lock prevents overlap |

## Setup on Railway

### 1. Create a Cron Service

In your Railway project, create a new **Cron** service (not a web service):

```
Name:     institutional-ingestion-cron
Command:  npx tsx scripts/run-institutional-daily.ts
Schedule: 0 6 * * *
```

Point it to the same source repository / Docker image as the main app.

### 2. Required Environment Variables

Copy these from your main web service to the Cron service:

```bash
# Must be true to enable ingestion (default: true — set to false to disable)
INSTITUTIONAL_13F_INGESTION_ENABLED=true

# Identifies your app to the SEC (required by SEC robots.txt)
# Format: "AppName/1.0 (contact@example.com)"
SEC_USER_AGENT="YourAppName/1.0 (admin@yourapp.com)"

# Database
DATABASE_URL=<your-postgres-connection-string>

# Ingestion tuning (optional — all have defaults)
INSTITUTIONAL_13F_INGESTION_ENABLED=true    # set to false to disable
INSTITUTIONAL_ACCESSIONS_PER_RUN=300        # default 300, range 50–2000
INSTITUTIONAL_STALE_RUN_THRESHOLD_MINUTES=30 # default 30, range 10–120

# Logging (match main service)
LOG_LEVEL=info
NODE_ENV=production
```

### 3. Activate the Feature Flag (After First READY Quarter)

Once the status script shows `READY` for at least one quarter:

```bash
# In your main web service env vars:
INSTITUTIONAL_INTELLIGENCE_ENABLED=true
```

Do **not** set this before data is ingested — the UI will show "data unavailable."

## Monitoring

### Check Pipeline Status

Run the status script from your local environment (or a Railway one-off job):

```bash
DATABASE_URL="..." npx tsx scripts/institutional-ingestion-status.ts
```

Expected output:
```
┌─────────────────────────────────────────────────────────────────────────┐
│ Institutional 13F Pipeline Status            (2026-08-07 06:12 UTC)     │
├────────────┬──────────┬──────────┬──────────┬────────┬─────────────────┤
│ Quarter    │ State    │ Progress │ Filings  │Holdings│ Last Run        │
├────────────┼──────────┼──────────┼──────────┼────────┼─────────────────┤
│ 2026-Q1    │ PARTIAL  │  32%     │ 2,987    │ 1.06M  │ 2026-08-07      │
│ 2025-Q4    │ READY    │ 100%     │ 9,364    │ 3.33M  │ 2026-07-28      │
└────────────┴──────────┴──────────┴──────────┴────────┴─────────────────┘
  Data ready: ✓ Yes
  Quarters ready: 1/2
  Next scheduled run: 2026-08-08
```

### Admin API Endpoint

When logged in as admin:

```
GET /api/admin/institutional/pipeline-status
Authorization: Bearer <admin-jwt>
```

Returns:
```json
{
  "schedulerEnabled": true,
  "ingestionConfigured": true,
  "institutionalDataReady": true,
  "lastRun": "2026-08-07T06:12:00Z",
  "nextExpectedRun": "2026-08-08T06:12:00Z",
  "quarters": [
    {
      "quarter": "2026-Q1",
      "state": "PARTIAL",
      "stateLabel": "In Progress",
      "progressPercent": 32,
      "storedFilings": 2987,
      "storedHoldings": 1062385,
      "resumable": true,
      "ready": false
    }
  ]
}
```

### Railway Logs

Key log events emitted by the daily job:

| Event | Meaning |
|-------|---------|
| `institutional_daily_job_started` | Job began, logs chunkSize |
| `institutional_daily_job_skipped` | Not configured — check env vars |
| `institutional_daily_stale_run_cleaned` | Cleaned N stale running runs |
| `institutional_daily_quarter_starting` | Starting a quarter ingestion |
| `institutional_13f_chunk_complete` | Chunk limit reached, clean stop |
| `institutional_13f_ingestion_aborted` | Abort signal fired (should not happen with chunk mode) |
| `institutional_refresh_no_work` | All quarters READY — nothing to do |
| `institutional_daily_job_completed` | Job done, logs total duration |

## Tuning

### Increase Throughput

After implementing batch existence checks (reduces per-accession DB overhead):
- Increase `INSTITUTIONAL_ACCESSIONS_PER_RUN` to 500–1000
- Monitor duration stays under 15 minutes

### Emergency Stop

1. Disable the Railway Cron service, or
2. Set `INSTITUTIONAL_13F_INGESTION_ENABLED=false` on the Cron service env vars

In-flight runs will finish their current accession and exit at the next chunk-limit check.

### Force Re-Run a Quarter

```bash
DATABASE_URL="..." npx tsx scripts/run-institutional-backfill.ts --force
```

Or via admin API (POST to trigger endpoint if wired in your admin routes).

## State Machine

Each quarter progresses through these states:

```
NOT_STARTED → PARTIAL → READY
```

- **NOT_STARTED**: No prior runs with data for this quarter.
- **PARTIAL**: Has runs, but `storedFilings < totalAccessions * 95%` or no aggregates.
  - The daily job calls `runInstitutionalIngestion({ force: true })` to resume.
- **READY**: Aggregates computed with coverage, ≥ 95% accessions ingested.
  - The daily job skips READY quarters entirely.

The state machine is pure (no DB calls) and lives in `server/services/institutional/quarter-state.ts`.

## Deployment Checklist

- [ ] Run `scripts/migrate-institutional.sql` against production DB (`psql "$DATABASE_URL" -f scripts/migrate-institutional.sql`)
- [ ] Set `INSTITUTIONAL_13F_INGESTION_ENABLED=true` on Cron service
- [ ] Set `SEC_USER_AGENT` on Cron service (required by SEC)
- [ ] Set `DATABASE_URL` on Cron service
- [ ] Deploy Cron service with schedule `0 6 * * *`
- [ ] Verify first run completes in < 15 minutes in Railway logs
- [ ] Wait for first READY quarter (check status script)
- [ ] Set `INSTITUTIONAL_INTELLIGENCE_ENABLED=true` on main web service
- [ ] Verify Research Package → Institutional tab shows data

## Existing-data production repair

Use this flow only when SEC filings and holdings already exist but reliable
CUSIP mappings, aggregates, signals, or sector/theme snapshots are missing.
It does not ingest or backfill SEC data and it does not change the public
feature flag. If source identity is unresolved within the four-symbol repair
scope, preflight fetches only the bounded authoritative SEC filing documents
needed by the existing source-provenance reconciler.

### Production architecture and execution boundary

This project does **not** use a Replit production database:

- Replit is the development environment.
- GitHub is the source repository.
- Railway runs the production application.
- Railway PostgreSQL is the production database.

Run every command in this section only from the Railway application shell after
the repair commit has been deployed there. The scripts use the runtime
`DATABASE_URL` through `server/db.ts`; do not paste, print, replace, or override
that value on the command line. Do not create a Replit production database or
copy production data into Replit.

The repair and validation commands fail closed if `DATABASE_URL` is absent or
`EXTERNAL_DATABASE_URL` is present. This prevents the application's normal
external-database preference from redirecting a repair away from Railway's
runtime database.

Before continuing in the Railway shell, verify the runtime identifies itself as
production without overriding the value:

```bash
test "$RAILWAY_ENVIRONMENT_NAME" = "production"
```

If that command exits nonzero, stop and correct the Railway service environment.

### 1. Keep the public feature disabled

Confirm `INSTITUTIONAL_INTELLIGENCE_ENABLED=false`. The repair command refuses
write mode while the public feature is enabled.

### 2. Run the read-only plan

```bash
npx tsx scripts/repair-institutional-production-data.ts
```

Review the database identity, schema result, duplicate/orphan checks, all four
expected CUSIP traces, mapping status counts, rows to update, aggregate scope,
blocking issues, snapshot preview, and the SHA-256 `planHash`. Dry-run uses
SELECT statements only and prints an explicit `GO` or `NO-GO`.

The data-quality block reports current values rather than requiring stale exact
counts. Compare them with the last known scale (approximately 1,394 filings,
562k holdings, 970 effective managers, and 41 historical quarters). The command
fails closed when effective filings/holdings/managers are absent, fewer than two
historical quarters exist, or reliable mapping coverage is above the near-zero
pre-repair threshold. It also reports exact mapping, holding, aggregate, signal,
sector, and theme rows that the reviewed plan would write or rebuild.

Stop if any blocking issue is reported. In particular, do not proceed when an
expected CUSIP points at a different symbol, an existing holding has a conflicting
symbol, source provenance is unavailable, ambiguous, or confirms ingestion or
persistence duplication within the AAPL/NVDA/MSFT/COST repair scope, or one of
those four symbols is absent.

If an older dry run reports `DUPLICATE_HOLDING_GROUPS_PRESENT`, do not delete or
deduplicate holdings. Deploy the corrected preflight and run the dedicated
SELECT-only classifier from the Railway application shell:

```bash
npx tsx scripts/classify-institutional-holding-duplicates.ts
```

The current repair detector groups by accession, CUSIP, class title, and
put/call. The classifier separates materially distinct SEC lines from groups
whose stored material is identical but whose source identity is unresolved. It
also reports equity/PUT/CALL groups that the current key correctly keeps separate
and explains the conditional AAPL/NVDA/MSFT/COST aggregate impact. The SEC bulk
`INFOTABLE_SK` source-row identifier is not currently persisted, so stored rows
alone cannot prove duplicate source rows or an actual overcount.

The production classification completed on August 30, 2026 found 60,413 legacy
key groups: 60,365 materially distinct groups and 48 identical-stored-material
groups with unresolved source identity. AAPL, NVDA, MSFT, and COST had 64, 68,
68, and 50 flagged groups respectively; every target group was materially
distinct, with zero source-identity-unresolved target groups. Therefore:

- `DUPLICATE_CHECK_FALSE_POSITIVE_CONFIRMED` is the documented root cause for
  the old global blocker.
- Global materially distinct and source-identity-unresolved counts remain
  visible as data-quality warnings.
- Only source-identity-unresolved, aggregate-eligible rows inside the explicit
  repair scope block the controlled repair.
- No parser, ingestion, or database duplication claim is supported for the 48
  unresolved groups.

Future SEC ingestion should preserve `INFOTABLE_SK`, or an equivalent stable
source-row identifier, so exact source duplication can be determined. That
schema/data migration is intentionally outside this repair.

When the repair-scope query reports unresolved aggregate-eligible groups,
the repair preflight automatically reuses the existing production source
diagnostic service. It fetches only the required SEC filing index and
Information Table documents, sequentially by full accession, and includes
the resulting body-free provenance evidence and digest in the plan hash.
APPLY reruns that same reconciliation under the existing repeatable-read
transaction before any write.

Each finding includes safe `sourceDocument` evidence before reconciliation:
the index/document URLs, selected filename, HTTP status, Content-Type, byte
length, root/signature, validator stage, and structured rejection code. It
never prints a response body. `SOURCE_UNAVAILABLE` with a rejection code means
provenance remains blocked, not that holdings may be removed. In particular,
`WRONG_DOCUMENT_SELECTED` points to filing-index selection; XML/transport
codes identify the next bounded investigation. `SOURCE_ROWS_CONFIRM_MULTIPLE`
means the SEC source itself contains the multiple matching rows and those rows
must remain preserved.
`SOURCE_ROWS_CONFIRM_MULTIPLE` is distinct from
`INGESTION_OR_PERSISTENCE_DUPLICATION_CONFIRMED`; unavailable or non-exact
source matches block the repair. The production reconciliation on August 30,
2026 classified all 30 scoped groups as `SOURCE_ROWS_CONFIRM_MULTIPLE`, so all
source rows must be preserved and aggregated. Future ingestion should persist
the SEC `INFOTABLE_SK` whenever available, together with the source document
filename and stable row ordinal.

### 3. Explicitly apply the reviewed plan

Copy the hash from the immediately preceding dry-run:

```bash
npx tsx scripts/repair-institutional-production-data.ts \
  --apply \
  --environment production \
  --confirm REPAIR_INSTITUTIONAL_PRODUCTION_DATA \
  --plan-hash <DRY_RUN_PLAN_HASH> \
  --database-name <DATABASE_NAME_FROM_DRY_RUN> \
  --checkpoint-file /tmp/institutional-repair-checkpoint.json
```

Write mode uses a dedicated transaction-scoped PostgreSQL advisory lock. It
re-runs the preflight under `REPEATABLE READ` and aborts if the plan hash changed.
Only `mapped_symbol` and `mapping_status` are updated on effective holdings, and
only from exact/reviewed mapping references. Raw CUSIP, issuer, class, value,
shares, put/call, PRN type, filing identity, and historical filings are untouched.

The four verified mappings are inserted or promoted idempotently. Mapping,
aggregate, and signal writes are constrained to AAPL, NVDA, MSFT, and COST so
the dry-run counts and plan hash cover the full write scope. Heuristic, probable,
ambiguous, unmapped, and rejected references are never promoted.
Aggregates are rebuilt oldest-first. A quarter is compared only with its
immediately preceding calendar quarter; gaps do not silently compare non-adjacent
periods. Put/call and PRN rows remain excluded by the aggregation engine. Signals
follow the aggregate's recorded comparable predecessor.

Sector/theme rebuilding restores the latest valid opportunity snapshot from
PostgreSQL when the one-off repair process has no in-memory ranking. If no valid
persisted snapshot exists, the checkpoint records that stage as `blocked`; it
never claims success. Run a normal Opportunity Engine scan so it persists a valid
snapshot, then resume from snapshots:

```bash
npx tsx scripts/repair-institutional-production-data.ts \
  --from-stage snapshots
```

Copy the fresh hash and database name from that resume-scoped dry-run, then run:

```bash
npx tsx scripts/repair-institutional-production-data.ts \
  --apply \
  --environment production \
  --confirm REPAIR_INSTITUTIONAL_PRODUCTION_DATA \
  --plan-hash <FRESH_DRY_RUN_PLAN_HASH> \
  --database-name <DATABASE_NAME_FROM_DRY_RUN> \
  --checkpoint-file /tmp/institutional-repair-checkpoint.json \
  --from-stage snapshots
```

Always run a fresh dry-run with the same `--from-stage` before a resume because
mapped and aggregate state changes after completed stages. Resume also verifies
the existing checkpoint's database identity, post-mapping plan hash, and all
prior stage completion records. Do not point `--from-stage` at a new or unrelated
file.

### 4. Validate without writes

```bash
npx tsx scripts/audit-institutional-production-data.ts
```

### Global coverage analysis (read-only)

```bash
npx tsx scripts/analyze-institutional-coverage.ts
```

This separate generic analyzer is not the four-symbol repair tool. A guarded
generic executor exists, but it was not run as part of this implementation.
Only the dry-run command is published here; the APPLY invocation is
intentionally omitted. Any future APPLY requires a separately reviewed, fresh
production artifact and exact production database/schema identity,
confirmation phrase, and plan hash. It also takes an advisory lock and rechecks
the plan inside its transaction. Its output distinguishes `allHistory` from
`latestQuarter`: `latestCanonicalFilingQuarter` is anchored to the newest
canonical effective filing quarter before holding eligibility filters.
`newestFilingQuarterEligibleRows` may therefore be zero (for example, where
that quarter contains only options or PRN rows), and
`newestFilingQuarterHasNoEligibleRows` is an explicit diagnostic rather than a
claim that an older quarter is current. `materialization.quarters` and
aggregate targets cover every canonical historical period for each trusted
identity. Missing aggregate and signal targets remain actionable even when the
holding mapping is already current.

`trustedIdentityCoverage` is potential resolver-backed identity coverage; it is
not the same as persisted holding materialization. `materializedCoverage`
reports current and projected fully materialized CUSIPs, rows, and known USD
value percentages. The plan also reports expected/present/missing aggregate
and signal targets, insert/update counts, current snapshot-family row counts,
refresh scope, and value-weighted root-cause ranking.

SQL rollback applies only before the source-repair transaction commits. Once
mapping/holding updates commit, they remain durable. If an aggregate, signal,
or snapshot rebuild then fails, run this dry-run command again: missing derived
targets will produce a new deterministic hash-bound idempotent plan. Do not
claim or attempt SQL rollback for a post-commit derived rebuild failure.

The production-data audit reports mapping coverage, holder/manager counts,
comparable quarters, activity counts, aggregate freshness, signal status, and
sector/theme snapshot freshness for AAPL, NVDA, MSFT, and COST.

### Recovery and rollback

- Before the mapping transaction commits, any failure rolls back the entire
  mapping stage automatically.
- After mapping commits, downstream stages are derived and idempotent. Fix the
  reported cause, run a fresh dry-run, and resume from the failed stage.
- Do not manually reverse mapped rows based only on a checkpoint count. If a
  verified mapping itself was wrong, disable the public feature, restore the
  affected database from the Railway backup/checkpoint, then rerun validation.
- Do not run SEC backfill as a repair shortcut: it is unnecessary and can make
  incident diagnosis harder.
