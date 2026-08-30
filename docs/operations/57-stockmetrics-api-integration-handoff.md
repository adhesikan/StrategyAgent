# 57 — StockMetrics API Integration Handoff

## Authority and connection

This handoff documents the implemented external adapters, not internal or
session-authenticated application endpoints. The live base URL is the deployed
host plus `/api/v1`, for example:

```text
https://<strategyagent-railway-public-domain>/api/v1
```

Use `Authorization: Bearer <api-key>`. Institutional endpoints require
`institutional:read`; Multibagger endpoints require `multibagger:read`.
Dedicated API keys—not browser session cookies—are accepted. Never place a key
in a URL, documentation example, or source control. The live contract is also
available, without credentials, from `GET /api/v1/openapi.json`.

Source: `server/routes.ts`; `server/routes/institutional-api-v1.ts`;
`server/routes/multibagger-api-v1.ts`;
`server/openapi/institutional-api-v1.ts`.

## Envelopes, errors, availability, and freshness

Successful data responses are:

```json
{ "data": {}, "meta": { "dataAsOf": null, "modelVersion": "...", "source": "...", "requestId": "...", "limitations": [] } }
```

Failures are:

```json
{ "error": { "code": "INVALID_QUERY", "message": "...", "requestId": "..." } }
```

`X-Request-Id` is supplied on responses. The versioned API is metered and the
published contract specifies rate-limit headers and `429`/`Retry-After`. Common
statuses are `400` invalid path/query, `401` missing/invalid key, `403`
insufficient scope, `404 DATA_UNAVAILABLE`, `429` rate limit, and `500`; stock
analytics may return `503 UPSTREAM_ERROR`.

`quarter=latest` or `YYYY-Q1`…`YYYY-Q4`; default `positionType=COMMON_EQUITY`.
`PUT` and `CALL` are independent—not merged into common equity. `dataAsOf` is a
quarter-end/reporting evidence date. SEC Form 13F is delayed and reflects
reported, not real-time, holdings. A JSON `null` is unavailable/not comparable,
not zero. In particular, a zero holder count is definitive only when Stock View
availability is `NO_REPORTED_POSITION`.

## Exact routes and parameters

All routes below use **GET**.

| Route (append to base URL) | Scope | Parameters |
|---|---|---|
| `/health` | none | none |
| `/openapi.json` | none | none |
| `/institutional/funds/{managerId}` | `institutional:read` | `managerId` 1–10 digits; `quarter`, `positionType`, `topN` (1–100, default 20) |
| `/institutional/funds/{managerId}/analytics` | `institutional:read` | Exact alias of prior fund route and parameters |
| `/institutional/stocks/{symbol}` | `institutional:read` | `symbol`; `quarter`, `positionType`, optional `cohort`, `topN` (1–100, default 20) |
| `/institutional/stocks/{symbol}/trend` | `institutional:read` | `symbol`; `quarter`, `positionType`, optional `cohort`, `historyQuarters` (1–8, default 8) |
| `/institutional/trends/accumulation` | `institutional:read` | Common ranking parameters below |
| `/institutional/trends/reduction` | `institutional:read` | Common ranking parameters below |
| `/institutional/trends/new-positions` | `institutional:read` | Common ranking parameters below |
| `/institutional/trends/exits` | `institutional:read` | Common ranking parameters below |
| `/institutional/rotation/sectors` | `institutional:read` | `quarter`, `positionType`, optional `cohort` |
| `/institutional/rotation/industries` | `institutional:read` | `quarter`, `positionType`, optional `cohort` |
| `/institutional/rotation/themes` | `institutional:read` | `quarter`, `positionType`, optional `cohort` |
| `/multibagger/{symbol}` | `multibagger:read` | `symbol` |
| `/multibagger/screener` | `multibagger:read` | Multibagger screener parameters below |

`symbol` is 1–10 uppercase letters/digits/periods/hyphens. Cohort values are
`hedge_fund`, `pension`, `sovereign`, `endowment`, `asset_manager`,
`quantitative`, `technology_specialist`, `healthcare_specialist`, `concentrated`,
and `broad_diversified`.

**Common ranking parameters:** `quarter`, `positionType`, `cohort`, optional
`sector`, `industry`, `theme`, `marketCapMin`, `marketCapMax`, `minManagers`,
`minReportedValue`; `sortBy` one of `netHolderIncrease`, `newHolderCount`,
`increasedHolderCount`, `aggregateShareIncreasePct`,
`aggregateShareIncrease`, `reportedValue` (default `netHolderIncrease`);
`sortDirection=asc|desc` (default `desc`); `limit` 1–100 (default 50);
zero-based `offset` 0–100000 (default 0). `marketCapMin` cannot exceed
`marketCapMax`.

**Multibagger screener parameters:** optional `minOverallScore` (0–100),
`profile` (`fiveX`, `tenX`, `twentyFiveX`, `hundredX`), `marketCapMin`,
`marketCapMax`, `sector`, `industry`, `theme`, `institutionalTrend`
(`ACCELERATING_ACCUMULATION`, `ACCUMULATION`, `STABLE`, `DISTRIBUTION`,
`ACCELERATING_DISTRIBUTION`), `minInstitutionalScore` (0–100),
`minRevenueGrowth` (-100–10000), `limit` 1–100 (default 25), and `offset`
0–100000 (default 0). Missing values fail closed when a corresponding screener
filter is requested.

## Data contracts

### Stock View: `/institutional/stocks/{symbol}`

This resource is `{data: StockAnalytics, meta}` when analytics source data is
loaded and calculated. Its exact top-level `data` fields are:

| Group | Exact fields / nested contract |
|---|---|
| Identity, time, version | `symbol`, `availability`, `quarter: {year, quarter, label, periodEndDate}`, `dataAsOf`, `modelVersion: {name, version}` |
| Holder/activity totals | `reportingManagerCount`, `reportedHolderCount`, `previousReportedHolderCount`, `holderCountChange`, `newlyReportedHolderCount`, `increasedReportedHolderCount`, `unchangedReportedHolderCount`, `reducedReportedHolderCount`, `noLongerReportedHolderCount`, `managerChangeCounts: {new, increased, unchanged, reduced, exited}` |
| Reported measures | `aggregateReportedShares`, `previousAggregateReportedShares`, `aggregateReportedShareChange`, `aggregateReportedShareChangePct`, `aggregateReportedValueDollars`, `averagePortfolioWeight`, `medianPortfolioWeight` |
| Mapping coverage | `mappingCoverage: {candidateHoldingCount, reliablyMappedHoldingCount, unmappedHoldingCount, ambiguousHoldingCount, classificationUnavailableHoldingCount, coveragePercent}` |
| Holder detail rows | Each row in `topReportedHolders`, `largestNewlyReportedPositions`, `largestReportedShareIncreases`, `largestReportedShareReductions`, and `noLongerReportedPositions` is `{managerId, managerName, cusip, cusips, symbol, issuerName, reportedShares, previousReportedShares, reportedShareChange, reportedShareChangePct, reportedValueDollars, portfolioWeight, changeType}`. `cusip` is nullable; `cusips` is the canonical retained list because one manager can report multiple CUSIPs resolving to the symbol. |
| Breadth | `breadth` is nullable; when present it is `{scope, totalEntityCount, increasingEntityCount, decreasingEntityCount, newEntityCount, exitedEntityCount, breadthRatio, direction}`. |
| Trend | `trend` is nullable; when present it is `{direction, currentQuarter, comparisonQuarter, observations, confidence}`. |
| Quality and disclosure | `dataQuality: {status, coveragePercent, warnings}`. Envelope `meta` is `{quarter, dataAsOf, modelVersion, source, requestId, limitations}`; its limitations include the delayed/reported-positions disclosure. |

There is **no accumulation-score field and no separate external accumulation-score
endpoint** in the implemented `/api/v1` adapter. The internal scoring exports do
not add an accumulation score to `StockAnalytics`; consumers needing
cross-symbol discovery use the ranking routes described below.

#### Per-availability behavior (Stock View)

| `availability` | Actual HTTP behavior | Envelope | Numeric/null semantics | Consumer action |
|---|---|---|---|---|
| `AVAILABLE` | `200` when the repository supplies source data and the calculation has reliable identity, complete mapping/aggregate status, and adjacent comparison evidence. | `{data: StockAnalytics, meta}` | Read reported totals and comparison fields normally; individual nullable values still mean unavailable. | Render the full Stock View with quarter/date and disclosures. |
| `PARTIAL` | `200` StockAnalytics. It is calculated where candidate mapping coverage is below 100% or the canonical aggregate coverage is not `complete`. | `{data: StockAnalytics, meta}` | Some totals may be present, but coverage/quality qualifies them; null comparisons are not zero. | Render as partial; display `mappingCoverage`, `dataQuality`, and warnings; do not fill gaps. |
| `INSUFFICIENT_HISTORY` | `200` StockAnalytics. It is calculated when current evidence is otherwise usable but no adjacent prior quarter, or no complete comparison, exists. | `{data: StockAnalytics, meta}` | Current values may be numeric; prior/change/trend evidence can be null. | Render current-quarter evidence only and label history/comparison unavailable. |
| `UNMAPPED` | `200` StockAnalytics. It is calculated when target-specific candidates exist without reliable identity, or candidate holdings exist but none are reliably mapped. | `{data: StockAnalytics, meta}` | Do not interpret zero holders/totals as absence; mapping-related derived values may be null/empty. | Render unmapped state and coverage/warnings; route mapping remediation internally, not a zero-position message. |
| `UNSUPPORTED` | `200` StockAnalytics. It is calculated when no reliable identity and no candidate holdings exist. | `{data: StockAnalytics, meta}` | No numeric conclusion about ownership follows from this state. | Render unsupported/not-covered; do not offer ownership conclusions. |
| `NO_REPORTED_POSITION` | `200` StockAnalytics. It is calculated only after identity/mapping/partial checks when the resulting reporting-manager count is zero. | `{data: StockAnalytics, meta}` | Zero reported holder count is definitive **only in this state**; nullable measures remain unavailable rather than zero. | Render “no reported position” for the selected quarter/type and retain 13F limitations. |
| `UPSTREAM_ERROR` | **Not emitted as a `200 StockAnalytics` response by this external route's current error boundary.** A thrown stock-source retrieval error is translated to `503`. The enum exists in the domain contract, but this adapter does not return a success payload carrying it. | `503 {error:{code:"UPSTREAM_ERROR",message,requestId}}` | No analytics payload exists; infer no numeric value. | Retry with backoff or surface source unavailable; retain `requestId`. |

`404 {error:{code:"DATA_UNAVAILABLE",...}}` is also **not** an availability
value. It occurs when `getStockInstitutionalAnalytics` returns `null`—for
example, no source result for the requested valid symbol/quarter/options.
It has no `StockAnalytics` payload, so do not translate it into `UNSUPPORTED`,
`UNMAPPED`, or `NO_REPORTED_POSITION`. Invalid symbols return `400
INVALID_SYMBOL` before this decision.  
Source: `server/routes/institutional-api-v1.ts`;
`server/services/institutional/analytics/stock-analytics.ts`;
`server/services/institutional/analytics/types.ts`.

### Trends, rankings, and rotation

Stock trend returns ordered `quarters`, a classification
(`ACCELERATING_ACCUMULATION`, `ACCUMULATION`, `STABLE`, `DISTRIBUTION`,
`ACCELERATING_DISTRIBUTION`, `INSUFFICIENT_DATA`), quality, and model version.
Each quarter provides holder activity, aggregate shares/value, nullable
`breadthChange`, `shareTrend`, `persistence`, `increaseReductionBalance`, and
`hasComparablePriorQuarter`.

The four trend-ranking routes are the external institutional discovery surface:
they return an `InstitutionalRanking` with mode, current/previous quarter,
sorted paged items, tracked/comparable manager counts, quality, and model
version. There is **no standalone external “Institutional Discovery” route**.
Use these descriptive accumulation/reduction/new-position/exit rankings for
cross-symbol discovery; do not represent them as recommendations.

Rotation returns `kind` (`SECTOR`, `INDUSTRY`, or `THEME`), current/previous
quarter, quality/model version, and classifications. A classification has
reported value/shares, manager/activity changes, and optional `classificationId`
for theme identity.

### Multibagger candidate and screener

`/multibagger/{symbol}` returns a deterministic, versioned research candidate
profile: `overallScore`, four optional-upside `profiles`, seven
`componentScores` (including `institutional`), supporting/limiting factors,
data quality, `dataAsOf`, market cap, revenue growth, sector, industry, and
themes. Null scores/inputs stay null. This is a screen, not advice or a claim
of future outcomes.

`/multibagger/screener` returns `candidates`, `totalCount`, `limit`, `offset`,
`dataAsOf`, and `modelVersion`, ordered by overall score descending then symbol.
The Multibagger institutional component is the other externally exposed
Institutional Discovery representation; it is embedded in the candidate
response rather than a standalone discovery endpoint.

## Production readiness

Before integrating against production: use a provisioned least-privilege API key
with the appropriate scope, point only at the deployed host, retain
`requestId`, handle all error envelopes and rate limits, display/report
`dataAsOf`, availability, quality, and limitations, and test null paths.
Do not infer zero values, real-time positions, investment advice, or a missing
endpoint. Confirm the current machine contract at `/api/v1/openapi.json` before
generating a client.

## STOCKMETRICS INTEGRATION HANDOFF

| Capability | Method | /api/v1 Route | Auth | Response Contract | Production Ready |
|---|---|---|---|---|---|
| Stock View | GET | `/institutional/stocks/{symbol}` | Bearer, `institutional:read` | `{data: StockAnalytics, meta}` | Yes; data-dependent availability applies |
| Stock trend | GET | `/institutional/stocks/{symbol}/trend` | Bearer, `institutional:read` | `{data: StockTrend, meta}` | Yes; history may be insufficient |
| Institutional Discovery | GET | `/institutional/trends/{accumulation\|reduction\|new-positions\|exits}` | Bearer, `institutional:read` | `{data: InstitutionalRanking, meta}` | Yes; no standalone discovery endpoint |
| Rotation | GET | `/institutional/rotation/{sectors\|industries\|themes}` | Bearer, `institutional:read` | `{data: Rotation, meta}` | Yes; materialization-dependent |
| Multibagger Discovery | GET | `/multibagger/{symbol}` | Bearer, `multibagger:read` | `{data: MultibaggerCandidate, meta}` | Yes; unavailable components remain null |
| Multibagger screener | GET | `/multibagger/screener` | Bearer, `multibagger:read` | `{data: MultibaggerScreener, meta}` | Yes; filters fail closed |