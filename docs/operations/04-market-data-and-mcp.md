# 04 — Market Data & MCP

## Twelve Data

### Endpoints Used
| Endpoint | Purpose | Credits |
|----------|---------|---------|
| `/time_series` | OHLCV daily bars | 1/request |
| `/quote` | Realtime quote | 1/request |
| `/profile` | Company sector/industry enrichment | 1/request |

### Rate Limiting
- Safety limits: 7 credits/minute, 750 credits/day (slightly below plan limits)
- Credit manager: atomic reservation in PostgreSQL (`market_data_request_log`)
- `/time_series` retries up to `TWELVE_DATA_MAX_RETRIES` (default 2) with exponential backoff
- `/quote` is cached 30s per symbol and de-duplicated in-flight

### Environment Variables
```
TWELVE_DATA_API_KEY=...   # Required
TWELVE_DATA_ENABLED=true  # Optional — defaults to true if key is set
```

### Common Failures
| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Market data health = DEGRADED | No ingestion in 3+ days | POST /api/admin/market-data/force-ingest |
| 401 from Twelve Data | Invalid API key | Check TWELVE_DATA_API_KEY |
| QUOTA error | Daily/minute limit hit | Wait for reset; check credit log |
| Sector coverage = 0% | Symbols not enriched | POST /api/admin/symbols/enrich |

---

## MCP Service

### Purpose
The VCP Trader MCP (Model Context Protocol) service provides the AI tool layer. The main app acts as an MCP client, calling tools over HTTP.

### Transport
- HTTP (not WebSocket) with bearer token authentication
- Production URL: set via `MCP_BASE_URL`
- Auth: `Authorization: Bearer $MCP_SERVICE_TOKEN`
- Health check: `GET $MCP_BASE_URL/health`

### Available Tools
| Tool | Purpose |
|------|---------|
| `get_quote` | Live market quote |
| `get_market_history` | OHLCV history for symbol |
| `get_news` | News sentiment for symbol |
| `scan_vcp` | VCP pattern scanner |
| `get_positions` | Broker position data (when connected) |

### Provider Selection
`MARKET_DATA_PROVIDER` env var controls data source within MCP. If unset, provider defaults based on what's configured.

### How to Verify MCP Is Active
```bash
curl -H "Authorization: Bearer $MCP_SERVICE_TOKEN" $MCP_BASE_URL/health
```
Expected: `{ "status": "ok" }` or similar.

In logs, look for:
```json
{ "source": "mcp" }   // real MCP data
{ "source": "mock" }  // MCP disabled or provider fallback
```

### Common Failures
| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| MCP status = DISABLED | `MCP_ENABLED` not `true` | Set `MCP_ENABLED=true` |
| HTTP 401 from MCP | Missing/wrong bearer token | Check `MCP_SERVICE_TOKEN` |
| DEGRADED — unreachable | Wrong URL or service down | Check `MCP_BASE_URL`, service logs |
| mock provider active | MCP disabled or tool returned mock | Check `MCP_ENABLED` and provider config |
| OHLCV unavailable | Twelve Data not configured in MCP | Check MCP provider settings |
