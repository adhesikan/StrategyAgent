# StockMetrics External API Consumer Demo

This is a deliberately small, independent website that proves an external consumer can use StockMetrics public API v1 over HTTP. It has:

- a browser UI for institutional accumulation, single-stock analytics, and the Multibagger candidate screen;
- a Node-only backend proxy that owns the API key and forwards only the approved read paths; and
- no imports from StockMetrics server services, database code, MCP tools, or the main application UI.

The browser calls only `/api/demo/...`. It never sees `STOCKMETRICS_API_KEY`, constructs an upstream URL, or sends a privileged `Authorization` header.

## Run locally

Requirements: Node.js 20 or newer.

```bash
cd examples/external-api-consumer-demo
export STOCKMETRICS_API_BASE_URL=https://your-stockmetrics-host.example
export STOCKMETRICS_API_KEY=sm_test_replace-with-a-server-side-key
npm start
```

Open `http://localhost:4178`. `PORT` can be set to use another local port. The example value above is intentionally not a real credential; create a dedicated API client/key with the scopes described below and keep it in your process environment or secret manager.

Run the focused tests:

```bash
npm test
```

## Architecture and authentication boundary

```text
Browser
  │  same-origin GET /api/demo/...
  ▼
Demo backend proxy
  │  adds Authorization: Bearer <STOCKMETRICS_API_KEY>
  │  validates path, symbol, filters, and pagination
  ▼
StockMetrics public API v1
```

The proxy requires a server-side `STOCKMETRICS_API_BASE_URL` and `STOCKMETRICS_API_KEY`. The key should be a least-privilege key with:

- `institutional:read` for accumulation and stock views; or
- `multibagger:read` for the candidate screener and symbol detail.

Because the public API key is treated like a password, use a separate key for this demo, do not put it in HTML/JavaScript, URLs, source control, client-side storage, or error messages. The proxy logs only safe request/error metadata and never logs the key or upstream response body.

## Proxy endpoints

The demo's routes map to the public API as follows:

| Demo route | Public API route | Purpose |
| --- | --- | --- |
| `GET /api/demo/institutional/accumulation` | `GET /api/v1/institutional/trends/accumulation` | Server-ranked accumulation page |
| `GET /api/demo/institutional/stocks/:symbol` | `GET /api/v1/institutional/stocks/:symbol` | Holder counts and ranked holder changes |
| `GET /api/demo/institutional/stocks/:symbol/trend` | `GET /api/v1/institutional/stocks/:symbol/trend` | Multi-quarter trend |
| `GET /api/demo/multibagger/screener` | `GET /api/v1/multibagger/screener` | Server-screened candidate page |
| `GET /api/demo/multibagger/:symbol` | `GET /api/v1/multibagger/:symbol` | Server-provided candidate detail |

Accumulation supports the public `quarter`, `positionType`, `cohort`, `sector`, `industry`, `theme`, market-cap, manager/value minimums, sort, `limit`, and `offset` filters. Stock routes support `quarter`, `positionType`, `cohort`, `topN`, and `historyQuarters`. The Multibagger screen supports its public score, profile, classification, market-cap, sector/industry/theme, institutional-trend, revenue-growth, `limit`, and `offset` filters. Symbols are normalized and validated before forwarding.

The proxy preserves safe upstream HTTP `400`, `401`, `403`, `404`, `429`, and `500` statuses and machine-readable error codes. It returns dedicated safe errors for missing configuration (`DEMO_NOT_CONFIGURED`), timeouts (`UPSTREAM_TIMEOUT`), network failures (`UPSTREAM_NETWORK_ERROR`), invalid JSON (`UPSTREAM_INVALID_JSON`), unsupported paths/queries, and unsupported methods. Upstream messages and response bodies are never copied into error payloads.

## Alternate API environments

Point the demo at any compatible StockMetrics API environment by changing only `STOCKMETRICS_API_BASE_URL`, for example:

```bash
STOCKMETRICS_API_BASE_URL=https://staging-stockmetrics.example \
STOCKMETRICS_API_KEY=sm_test_your_staging_key \
npm start
```

The browser code does not change between local, staging, or production-like API hosts. A production deployment should provide the two environment values through its server-side secret/configuration system.

## Replacing the UI

The proxy is intentionally a narrow contract. A different frontend can replace `public/index.html`, `public/app.js`, and `public/styles.css` while continuing to call the same `/api/demo/...` routes. Keep the backend boundary in place; do not move the StockMetrics key into the replacement browser bundle. A frontend may use the response `meta.requestId`, `meta.dataAsOf`, `meta.limitations`, and `dataQuality` fields to render traceability and freshness disclosures.

## Form 13F limitations

Institutional views use SEC Form 13F reported holdings. 13F data is delayed, reflects reportable holdings as filed by institutions, and is not a real-time position feed. Filing dates, amendments, mapping gaps, unavailable values, and quarter-to-quarter comparability can affect results. A null value means the source value is unavailable; it is not zero. The demo preserves this language and does not convert an analytics response into a recommendation.

Multibagger Discovery is a deterministic, versioned candidate profile screen. It reports available evidence and limitations; it does not provide investment advice or certainty about future outcomes. Missing or insufficient inputs remain unavailable rather than being inferred.