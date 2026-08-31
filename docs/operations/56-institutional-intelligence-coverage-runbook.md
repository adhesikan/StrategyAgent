# 56 — Institutional Intelligence Coverage Report and Runbook

## Purpose and evidence boundary

This is the code-grounded operational trace for Institutional Intelligence. It is
not a production coverage measurement. This workspace has no production Railway
database access, so every production percentage in this document is
**CURRENTLY_UNMEASURED**. Do not turn a local result, an historical example, or
a source-code threshold into a production percentage.

The read-only analyzer below is the approved way to produce a current evidence
record in the Railway application shell. It does not ingest SEC data, alter
mappings, rebuild derived data, or change feature flags.

## End-to-end materialization trace

1. **SEC acquisition and parsing.** The ingestion service obtains the SEC bulk
   dataset, parses submission, cover-page, and information-table records, and
   keeps 13F-HR/13F-HR/A holdings rather than notice filings. It is gated by
   `INSTITUTIONAL_13F_INGESTION_ENABLED` and `SEC_USER_AGENT`, is protected by
   PostgreSQL advisory lock `774_412_003`, and uses idempotent filing/holding
   inserts.  
   Source: `server/services/institutional/ingestion-service.ts`;
   `docs/operations/06-institutional-13f-pipeline.md`.
2. **Effective filing selection.** Originals and amendments are retained for
   auditability. For a filer and reporting period, the newest filing is marked
   effective and the other filings are marked ineffective. Aggregate reads join
   holdings to `isEffective=true`; amendments therefore supersede rather than
   double count originals.  
   Source: `server/services/institutional/ingestion-service.ts`
   (`updateEffectivenessForFiler`, `recomputeAggregateForSymbol`).
3. **Shared resolver and enrichment.** Batch mapping resolution is applied to
   holdings. Symbol analytics consume only reliable mapping evidence; enrichment
   carries `reliably_mapped`, `unmapped`, or `ambiguous`, metadata resolution,
   classification status, and sector/industry/theme membership.  
   Source: `server/services/institutional/ingestion-service.ts`;
   `server/services/institutional/analytics/types.ts`.
4. **Aggregate and trend.** For each mapped symbol and quarter, current and
   immediately preceding effective holdings are supplied to the aggregation
   engine, persisted as a quarterly aggregate, and classified as a trend.
   Rebuilds proceed oldest-first and do not compare across a missing calendar
   quarter.  
   Source: `server/services/institutional/ingestion-service.ts`;
   `server/services/institutional/aggregation-engine.ts`;
   `server/services/institutional/trend-classifier.ts`.
5. **Signals and discovery.** The signal engine precomputes
   `institutional_symbol_signals`; Opportunity Intelligence/ranking reads that
   evidence. Multibagger computes its institutional dimension from
   `institutionalDiscovery` evidence alongside growth, fundamentals, valuation,
   runway, optionality, and risk—missing inputs remain unavailable.  
   Source: `server/services/institutional/signal-engine.ts`;
   `server/services/opportunity-ranking-engine.ts`;
   `server/services/multibagger/engine.ts`;
   `server/services/multibagger/types.ts`.
6. **Application UI.** The signed-in app exposes the same institutional domain
   adapter at `/api/institutional/v1`, while Research/Opportunity UI renders
   institutional evidence and its freshness. This is separate from the
   externally keyed `/api/v1` surface.  
   Source: `server/routes.ts`; `client/src/pages/opportunity-workspace.tsx`;
   `client/src/pages/market-research-hub.tsx`.
7. **External read API.** The Bearer-key adapter materializes fund, stock,
   trend-ranking, and rotation results without reusing application-specific
   routes. Multibagger materializes a deterministic candidate profile and
   screener with its institutional component.  
   Source: `server/routes/institutional-api-v1.ts`;
   `server/routes/multibagger-api-v1.ts`.

## Ranked root-cause categories

Ranking is by likely leverage on coverage, based on the dependency chain—not a
measured production attribution. **All production percentages: CURRENTLY_UNMEASURED.**

| Rank | Category | Why it removes or degrades downstream evidence | Production share |
|---:|---|---|---|
| 1 | Unresolved/ambiguous/conflicting CUSIP-to-symbol identity | A holding cannot safely enter symbol aggregates, stock views, rankings, or a symbol-level signal. | **CURRENTLY_UNMEASURED** |
| 2 | Incomplete effective-filing ingestion | Missing current/prior filings lowers manager and holding coverage and prevents comparable changes. | **CURRENTLY_UNMEASURED** |
| 3 | Missing adjacent comparable quarter | Change, persistence, and trend fields become null/insufficient even when current holdings exist. | **CURRENTLY_UNMEASURED** |
| 4 | Classification/metadata gaps | A mapped symbol may be absent from sector, industry, theme filtering or rotation. | **CURRENTLY_UNMEASURED** |
| 5 | Derived-materialization lag/failure | Aggregates, signals, and snapshots may be absent or stale after otherwise valid source/mapping data. | **CURRENTLY_UNMEASURED** |
| 6 | Position eligibility/type semantics | PUT/CALL remain separate and PRN/non-share rows are not common-equity aggregate evidence. | **CURRENTLY_UNMEASURED** |

## Read-only coverage analyzer

Run only in the deployed **Railway application shell**, with its existing runtime
environment. First verify the target; then use this exact dry-run command:

```bash
test "$RAILWAY_ENVIRONMENT_NAME" = "production" && npx tsx scripts/analyze-institutional-coverage.ts
```

Do not paste, print, or override `DATABASE_URL`, and do not set
`EXTERNAL_DATABASE_URL`. The script itself rejects a missing `DATABASE_URL` and
rejects `EXTERNAL_DATABASE_URL`; it opens a read-only transaction and its query
is checked to permit only `SELECT`/`WITH`.

Output is JSON containing:

- `allHistory` and `latestQuarter`: eligible CUSIPs, holding rows, known
  reported USD value, null-value counts, and resolver-trusted identity totals;
- `latestCanonicalFilingQuarter`, newest-quarter eligibility diagnostics, and
  the complete row/CUSIP-level `funnel`;
- `materializedCoverage.current` and `materializedCoverage.projected`: fully
  materialized CUSIP, eligible holding-row, and known-USD-value counts and
  percentages. These persisted-materialization measures are distinct from
  `trustedIdentityCoverage`, which describes potential resolver-backed identity
  coverage;
- deterministic CUSIP classifications:
  `TRUSTED`, `AMBIGUOUS`, `CONFLICTING`, `UNSUPPORTED`, or
  `INSUFFICIENT_NO_REFERENCE`, all produced through the shared resolver;
- `rootCauseRanking`: unusable categories ranked by known reported USD value,
  then affected holding rows;
- `materialization` and `plan.downstream`: deterministic mapping/holding scope,
  deduplicated aggregate symbol-period and signal-symbol targets, their
  expected/present/missing counts and percentages, insert/update summaries,
  current sector/theme snapshot-family row counts, and refresh scope;
- `holdingCountReconciled`, `holdingCountMismatchCusips`, and
  `holdingCountContractVersion`: the planner's stale-row self-check and the
  versioned canonical effective-holding contract used again inside APPLY;
- `plan`: sorted evidence classifications plus a deterministic SHA-256
  `planHash`, with mode `REMEDIATION_PLAN`.

The analyzer classifies persisted evidence only; it never guesses an issuer.
Only already-trusted resolver outcomes with stale/unmapped holding rows are
listed as deterministic mapping promotions. Every trusted identity also
contributes its expected aggregate and signal targets, so missing derived rows
remain actionable after holding mappings are current. Ambiguous, conflicting,
unsupported, and insufficient populations never project an identity or
coverage gain. Known reported-value totals exclude null values and report null
counts separately; null is never coerced into numeric zero. A
`REMEDIATION_PLAN` and its projected metrics are evidence for review, not by
themselves authorization to write.  
Source: `scripts/analyze-institutional-coverage.ts`;
`server/services/institutional/institutional-coverage-analyzer.ts`.

## Population security-reference enrichment (OpenFIGI)

The population planner is separate from ingestion and schema migration. It starts
only with the complete eligible **effective** 13F CUSIP population (not a ticker
universe), aggregates holding rows and known reported USD values, and creates a
stable SHA-256, bounded action artifact. It reports aggregate before/projected
coverage and explicit outcomes without ticker-by-ticker diagnostics. Null
reported values remain unavailable and are excluded from value totals.

OpenFIGI v3 is approved only for exact `ID_CUSIP` mapping requests. The CUSIP
comes from SEC source rows; it is not represented as OpenFIGI-owned data. We
persist only modeled/published FIGI symbology metadata needed by this product,
not proprietary third-party response payloads, and do not redistribute provider
payloads. There is no fuzzy, issuer-name, or ticker inference. Task #189's
shared resolver remains authoritative: reviewed evidence precedes exact evidence,
and local/provider disagreement is retained as conflicting rather than promoted.

`OPENFIGI_API_KEY` is optional. The client reports only whether it is operating
in `KEYED` or `UNAUTHENTICATED` mode, never the key. It proactively enforces
OpenFIGI's documented Mapping API tiers: 25 requests per minute with at most 10
jobs per request when unauthenticated, or 25 requests per 6 seconds with at
most 100 jobs per request when keyed. The client honors shared cooldowns,
`Retry-After`/`ratelimit-reset`, and bounded retry behavior as
`rate_limited`, `provider_failed`, or `partial`; these states never become an
identity. The future-ingestion integration is implemented but disabled by
default with `INSTITUTIONAL_SECURITY_REFERENCE_ENABLED=false`; when enabled it
runs after persistence and before reconciliation, bounded by
`INSTITUTIONAL_SECURITY_REFERENCE_MAX_CUSIPS`. This planner does not alter that
gate or ingestion behavior.

Default and `--dry-run` behavior are read/provider reads only:

```bash
npx tsx scripts/enrich-institutional-security-references.ts --dry-run
```

The exact Railway production read-only dry-run command is:

```bash
test "$RAILWAY_ENVIRONMENT_NAME" = "production" && npx tsx scripts/enrich-institutional-security-references.ts --dry-run
```

Before selecting a provider chunk, the planner reads the persisted OpenFIGI
lookup state and normalized current candidate-history counts in the same
read-only transaction. Selection priority is deterministic: never-processed
CUSIPs first, then retryable `PROVIDER_FAILED`, `RATE_LIMITED`, or partial
observations, with CUSIP order used within each class. Existing
`AMBIGUOUS`, `UNSUPPORTED`, `NO_REFERENCE_AVAILABLE`, and `CONFLICTING`
outcomes are terminal skips by default; use `--refresh-terminal` only when a
separately reviewed refresh is intended. Reviewed and rejected local evidence
always remains protected. The JSON `selection` block reports terminal skips,
retryable outcomes, and `never_processed` independently from the exact
`plannedLookups` action count.

The JSON output intentionally contains aggregate counts, the plan hash, safe
execution-tier metadata, and dry-run continuation cursors only; it contains
neither credentials nor raw provider payloads. Apply is never
automatic. It needs all of the following: a newly generated matching
`--plan-hash`, an explicit `--max-cusips` bound, environment value
`INSTITUTIONAL_SECURITY_REFERENCE_APPLY_ENABLED=true`, and, when
`NODE_ENV=production`, Railway identity `RAILWAY_ENVIRONMENT_NAME=production`.
For example, after review, use:

```bash
INSTITUTIONAL_SECURITY_REFERENCE_APPLY_ENABLED=true \
npx tsx scripts/enrich-institutional-security-references.ts --apply \
  --max-cusips 100 --plan-hash <FRESH_PLAN_HASH>
```

The `--max-cusips` bound applies before OpenFIGI requests and also bounds the
exact hash-bound persistence action set. Only that bounded action set is persisted, including bounded negative,
ambiguous, and provider-failure observations/candidate history. Persistence is
upsert-based, so a safe rerun recovers a partial execution; a partial failure
reports only completed aggregate action counts and exits nonzero. Apply remains
unexecuted and out of scope for this runbook; do not execute it from Replit or
against production without separate operational approval.

### Guarded executor boundary

A guarded generic executor is implemented, but it was **not run** during this
work. The APPLY example above is documentation only. Any separately reviewed
production execution requires a
fresh plan artifact generated on Railway, exact expected production database
and schema identity, the exact confirmation phrase, and the matching supplied
SHA-256 hash. The executor also acquires its advisory lock and re-reads and
re-hashes the plan inside a repeatable-read transaction before bounded writes.
The canonical effective-holding population is selected through one shared
ranked-filing contract: one effective filing per filer/reporting period, then
null put/call, non-PRN, positive-share holdings. APPLY validates the live stale
row count before the mapping upsert and retains the returned-row assertion
after the update. A count mismatch therefore fails before mutation; any later
transaction error is rolled back by the database transaction boundary.

For resumable Railway dry-run measurement, `--cursor` is an exclusive
normalized CUSIP and `--max-cusips` is the provider-call bound:

```bash
npx tsx scripts/enrich-institutional-security-references.ts --dry-run --cursor 037833100 --max-cusips 100
```

Dry-run JSON additionally supplies safe OpenFIGI execution metadata and the
continuation cursor. It reports `not_processed` separately from `partial`, and
separately counts cursor and limit skips. `attemptedOutcomes` contains requested
provider work only and its counts reconcile exactly to `plannedLookups`. The
plan hash binds the full population, exact cursor/chunk, and provider result
set. Cursor mode is dry-run-only.

SQL rollback protects failures before the source mapping/holding transaction
commits. Once that transaction commits, its deterministic source repair is
durable. If a post-commit aggregate, signal, or sector/theme snapshot rebuild
fails, run the published dry-run again. Persisted source state and missing
derived targets will produce a new hash-bound, idempotent recovery plan; a
post-commit failure must not be described as rolled back.  
Source: `server/services/institutional/institutional-coverage-analyzer.ts`;
`server/services/institutional/institutional-coverage-postgres-adapter.ts`.

## Downstream completeness and null/zero semantics

| Layer | Completeness/status to inspect | What an absence means |
|---|---|---|
| Ingestion quarter | `NOT_STARTED`, `PARTIAL`, `READY`; READY requires aggregates and coverage | Not evidence of zero holdings. |
| Aggregate | `complete`, `partial`, `insufficient` coverage status | Partial/insufficient cannot be promoted to complete evidence. |
| Stock View | `AVAILABLE`, `PARTIAL`, `INSUFFICIENT_HISTORY`, `UNMAPPED`, `UNSUPPORTED`, `NO_REPORTED_POSITION`, `UPSTREAM_ERROR` | A numeric zero is definitive **only** for `NO_REPORTED_POSITION`. |
| Trend/ranking/rotation | `dataQuality.status`, `coveragePercent`, warnings, quarter and previous quarter | Null change/value fields mean unavailable or non-comparable inputs, not zero. |
| Signal/Multibagger | component availability, confidence, warnings, `unavailableComponents` | A null component score remains unavailable; it is never a zero score. |

All 13F values are reported holdings and delayed. `dataAsOf`/quarter-end is the
evidence date, not a real-time market timestamp. Theme exposures can overlap and
need not sum to 100%; sector/industry allocations are mutually exclusive.
Source: `server/services/institutional/analytics/types.ts`;
`server/openapi/institutional-api-v1.ts`.