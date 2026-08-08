# 05 — Scanner & Ranking

## Scanner Lifecycle

```
Schedule trigger (every OPPORTUNITY_SCAN_INTERVAL_MINUTES, default 240)
  → Advisory lock (key: 774_412_002) — prevents concurrent scans
  → MCP scan_vcp tool call → candidates
  → Candidate qualification (VCP pattern validation)
  → Opportunity Ranking Engine
  → Persist to opportunity_scan_snapshots
  → Fire-and-forget: runIntelligencePrecomputation()
  → Fire-and-forget: writeOpportunityHistory()
```

### Default Schedule
- Every 4 hours (240 minutes)
- Configurable: `OPPORTUNITY_SCAN_INTERVAL_MINUTES` (30–1440)

### Candidate Qualification
- VCP contraction sequences validated
- Entry trigger price sanitized (`sanitizeTriggerPrice`)
- ORB5/ORB15/GAP_AND_GO patterns expire after ET session ends
- `resistance_price` used as fallback trigger price

### Why Repeated Tickers Can Appear
A symbol can appear in both `topGrowth` and `watchlist` if it meets both criteria. This is expected.

---

## Opportunity Ranking Engine

### Input
- Qualified VCP candidates from scanner
- Institutional signals (if ingestion enabled)
- Previous ranking (for change detection)
- Market regime

### Scoring Components
| Component | Weight |
|-----------|--------|
| Technical | 40% |
| Institutional | 20% |
| Fundamental | 15% |
| Risk | 15% |
| Regime | 10% |

### Output
- `topGrowth`: ranked trade candidates (growth focus)
- `topIncome`: ranked trade candidates (income/dividend focus)
- `watchlist`: symbols approaching but not yet ready
- `approaching`: symbols near entry criteria
- `changes[]`: lifecycle changes vs previous ranking

### In-Memory State
`getLatestRanking()` returns the most recent ranking from memory. **This is lost on server restart.** Sector/theme intelligence snapshots are persisted to PostgreSQL and survive restart.

---

## Change Intelligence

Triggered after each ranking cycle. Computes a deterministic 8-state comparison:
- `new`, `upgraded`, `downgraded`, `moved`, `graduated`, `lost`, `unchanged`, `returning`

Available via:
- `GET /api/opportunities/changes` — dashboard panel
- Workspace `WhyItChangedPanel` on `/opportunities/:symbol`

---

## Intelligence Precomputation

Runs fire-and-forget after each ranking. Calls `runIntelligencePrecomputation()`:
1. Loads symbol sectors from `market_data_symbols` (LEFT JOIN `symbols`)
2. Loads institutional signals from `institutional_symbol_signals`
3. Computes sector snapshot → persists to `sector_intelligence_snapshots`
4. Computes theme snapshot → persists to `theme_intelligence_snapshots`

---

## Troubleshooting Scanner/Ranking

| Symptom | Diagnostic | Fix |
|---------|-----------|-----|
| Dashboard empty | GET /api/opportunities/latest → null | Wait for first scan; check scanner logs |
| Ranking lost after restart | Expected — in-memory | Wait for next scan or trigger one |
| Scanner never runs | Check OPPORTUNITY_SCAN_INTERVAL_MINUTES | Restart server to re-arm timer |
| MCP failure | `source: "mock"` in logs | Check MCP_ENABLED and MCP_BASE_URL |
| Old opportunities showing | `hasData: true` but stale `generatedAt` | Scanner may be stuck; check advisory lock |
| Sector snapshots = 0 | GET /api/admin/intelligence/diagnostics | Run symbol enrichment then rebuild |

---

## Stale Data Thresholds

| Signal | DEGRADED if |
|--------|------------|
| Ranking | generatedAt older than 2× scan interval |
| Sector snapshots | Sector rows = 0 while theme rows > 0 |
| Theme snapshots | Theme rows = 0 while ranking exists |
| Market data | No ingestion in 3+ calendar days |
