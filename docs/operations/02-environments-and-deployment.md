# 02 — Environments & Deployment

## Environments

| Environment | Host | Start command |
|-------------|------|---------------|
| Development | Replit | `npm run dev` (tsx + vite HMR) |
| Production  | Railway | `npx tsx script/migrate.ts && npm run start` |

`npm run start` = `NODE_ENV=production node dist/index.cjs`

---

## Railway Build Pipeline

```
GitHub push → Railway build trigger
  → npm ci
  → npm run build   (vite client + esbuild server → dist/)
  → Migration:  npx tsx script/migrate.ts
  → Start:      node dist/index.cjs
```

**Important:** `script/migrate.ts` runs `drizzle-kit push --force` against `DATABASE_URL`. This creates/alters tables defined in `shared/schema.ts`. Additionally, `server/index.ts` `runStartupMigrations()` runs `CREATE TABLE IF NOT EXISTS` for tables added inline (sector/theme snapshots). Both paths are idempotent.

---

## Required Environment Variables

### Core (required)
| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Express session signing key |
| `AUTH_JWT_SECRET` | JWT signing for auth tokens |

### Market Data
| Variable | Purpose | Required |
|----------|---------|---------|
| `TWELVE_DATA_API_KEY` | Twelve Data API key | Required for market data |
| `TWELVE_DATA_ENABLED` | Enable Twelve Data (`true`) | Optional (defaults based on key) |
| `TWELVE_DATA_LICENSE_MODE` | License tier | Optional |

### MCP Service
| Variable | Purpose | Required |
|----------|---------|---------|
| `MCP_ENABLED` | Enable MCP (`true`) | Optional |
| `MCP_BASE_URL` | MCP service base URL | Required if enabled |
| `MCP_SERVICE_TOKEN` | Bearer token for MCP | Required if enabled |

### Institutional 13F
| Variable | Purpose |
|----------|---------|
| `INSTITUTIONAL_13F_INGESTION_ENABLED` | Enable background ingestion (`true`) |
| `INSTITUTIONAL_INTELLIGENCE_ENABLED` | Enable signals UI (`true`) |
| `SEC_USER_AGENT` | Required by SEC EDGAR (`org name email`) |

### Broker Integrations (all optional)
| Variable | Purpose |
|----------|---------|
| `TRADIER_CLIENT_ID` / `TRADIER_CLIENT_SECRET` | Tradier OAuth |
| `TRADESTATION_CLIENT_ID` / `TRADESTATION_CLIENT_SECRET` | TradeStation OAuth |
| `RITHMIC_USER_ID` / `RITHMIC_PASSWORD` | Rithmic futures |
| `BROKER_TOKEN_KEY` | Broker token encryption key |

### Feature Flags
| Variable | Default | Purpose |
|----------|---------|---------|
| `MCP_ENABLED` | `false` | Enable MCP tool layer |
| `INSTITUTIONAL_13F_INGESTION_ENABLED` | unset (disabled) | Background 13F ingestion |
| `INSTITUTIONAL_INTELLIGENCE_ENABLED` | `true` | Show institutional signals in UI |
| `MARKET_HISTORY_DATABASE_FIRST` | `true` | Use DB for history (set `false` to emergency fallback) |
| `TRADER_BRAIN_ENABLED` | `false` | Enable TraderBrain AI analysis mode |
| `OPPORTUNITY_SCAN_INTERVAL_MINUTES` | `240` | Scanner interval (30–1440) |

### Other
| Variable | Purpose |
|----------|---------|
| `VCP_INTERNAL_API_KEY` | Internal VCP API authentication |
| `RESEND_API_KEY` | Transactional email via Resend |
| `RESEND_WEBHOOK_SECRET` | Resend webhook signature verification |
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` | Stripe billing |
| `SNAPTRADE_CLIENT_ID` / `SNAPTRADE_CONSUMER_KEY` | SnapTrade broker aggregation |

**DO NOT put secret values in documentation. Reference variable names only.**

---

## Post-Deployment Verification

```bash
# Health check
curl $PROD_URL/api/intelligence/briefing | jq .

# Platform health (admin session required)
curl -b "session=..." $PROD_URL/api/admin/platform-health | jq .health.database.status

# Smoke tests
curl $PROD_URL/api/opportunities/today | jq .count
curl $PROD_URL/api/intelligence/sectors | jq .count
curl $PROD_URL/api/intelligence/themes | jq .count
```

---

## Rollback

Railway supports instant rollback to any previous deployment from the Railway dashboard. See [14-disaster-recovery.md](14-disaster-recovery.md) for the rollback procedure.
