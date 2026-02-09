# VCP Trader

## Overview
VCP Trader is a production-grade SaaS web application designed for active day traders. It identifies, tracks, and alerts on Volatility Contraction Pattern (VCP) breakouts in the US stock market, providing real-time notifications. The platform automatically draws resistance and stop levels, supports direct brokerage market data connectivity, and functions as a mobile-ready Progressive Web App (PWA). Its core purpose is to automate the detection of VCP patterns (FORMING, READY, BREAKOUT stages) to empower traders with timely, actionable insights.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
The frontend is a React 18 application with TypeScript, built using Vite. It uses Wouter for routing, TanStack React Query for server state, shadcn/ui (built on Radix UI) for components, and Tailwind CSS for styling. TradingView lightweight-charts are used for price visualization. PWA capabilities are enabled via a service worker and Web Push API.

### Backend
The backend is built with Node.js and Express.js, written in TypeScript. It features RESTful API endpoints and uses Drizzle ORM with PostgreSQL for data persistence. Zod is employed for schema validation. The build system uses custom esbuild scripts for the server and Vite for the client.

### Data Storage
PostgreSQL serves as the primary database, managed by Drizzle ORM. The schema (`shared/schema.ts`) includes tables for users, symbols, candles, scan results, alerts, watchlists, broker connections, push subscriptions, and Auto Agent tables (agent_policies, agent_decisions, agent_state). Database migrations are automatically applied during the build process via Drizzle Kit (`script/build.ts` runs `drizzle-kit push` before building).

### Project Structure
The project is organized into `client/` for the React frontend, `server/` for the Express backend, and `shared/` for code shared between both, including database schemas.

### Key Design Patterns
A Storage Interface Pattern abstracts data access. Path aliases (`@/`, `@shared/`) streamline imports. Type sharing between frontend and backend is achieved via `@shared/schema`. Client-server communication is handled through a `fetch` wrapper with React Query.

### Trade Status System
Centralized in `client/src/lib/trade-status.ts`. Computes actionability of scan results based on price proximity to resistance/entry level:
- **AWAITING_BREAKOUT**: Price below resistance entry point
- **IN_ENTRY_ZONE**: Price within 3% above resistance (actionable — InstaTrade enabled)
- **EXTENDED**: Price more than 3% above resistance (not actionable)
Exports: `getTradeStatus()`, `getDistanceToEntry()`, `getDistanceAboveEntry()`, `getTradeStatusDisplay()`, `isActionable()`. Used by both `scanner.tsx` and `scanner-table.tsx` to ensure consistent gating of InstaTrade buttons and status badge rendering. Top Picks ranking penalizes extended/far-away setups and boosts actionable ones.

### Centralized Broker Service API
A provider adapter pattern (`server/broker/`) normalizes brokerage data across providers. Each provider (e.g., `server/broker/providers/tradier.ts`) implements a `BrokerProvider` interface with `getStatus`, `getAccounts`, `getPositions`, and `getOrders` methods. The central service (`server/broker/index.ts`) adds an in-memory cache with 5-15s TTLs to avoid rate limits. Endpoints:
- `GET /api/broker/accounts` — normalized accounts `[{id, name, type, buyingPower, equity, currency}]`
- `GET /api/broker/positions` — normalized positions `[{symbol, qty, avgPrice, marketPrice, unrealizedPnl}]`
- `GET /api/broker/orders` — recent orders `[{id, symbol, side, qty, status, createdAt}]`
- Legacy `GET /api/broker/status` unchanged for backward compatibility.

### Authentication & Authorization
The system uses email/password authentication with bcrypt hashing and PostgreSQL-backed sessions. It supports `user` and `admin` roles, enforcing role-based access control for different API routes.

### Options Scanner
The Options Scanner (`server/engines/options-scanner/`) provides a modular options scanning engine with strategy-based candidate discovery. Three core strategies generate proper multi-leg structures:
- **Long Options**: Generates Long Call or Long Put single-leg candidates
- **Wheel Strategy**: Generates either Covered Call or Cash-Secured Put recommendations
- **Credit Spreads**: Generates either Bull Put Spread or Bear Call Spread two-leg structures
Each `OptionCandidate` includes: legs[] (with side/strike/expiration per leg), strategyVariant, dte, premiumPct, maxProfit, maxLoss, breakeven, pop (probability of profit), stockPrice. Scan results are persisted in the `options_scans` table for history. API endpoints:
- `GET /api/options/strategies` — list of available strategy definitions
- `POST /api/options/scan` — run a scan `{universeId, strategyKey, riskProfileId, scanPreferences?}`, returns ranked candidates. `scanPreferences` accepts `{dteMin, dteMax, deltaMin, deltaMax, minPremiumPct}` for user-configurable scan parameters.
- `GET /api/options/scans?limit=20` — recent scan history
All options endpoints require authentication and `optionsScanner` entitlement. The UI page at `/app/options` features:
- Card view and List view toggle with key metrics (Premium, IV, Delta, Theta, PoP, Premium %)
- Collapsible Scan Preferences panel with sliders for DTE range, Delta range, Min Premium %
- Multi-leg display showing individual legs for spread strategies
- Strategy variant badges (Covered Call, Cash-Secured Put, Bull Put Spread, Bear Call Spread)
- Fetches user's platform universes for the universe dropdown with ticker counts
- Fetches risk profile and displays a summary card with "Edit" link
- Checks broker status; disables "Run Scan" if broker not connected

### Trade Ticket v2 (InstaTrade)
The Trade Ticket (`client/src/components/trade-ticket.tsx`) is a Sheet-based drawer that replaces the old InstaTrade dialog for direct broker orders. It provides:
- **Simple Mode** (default): Market/Limit entry type with quick price buttons (MID, MID±0.02, NAT), contract quantity, account selection
- **Advanced Mode** (toggle): TIF (DAY/GTC), stop type (stop vs stop-limit)
- **Exit Plan (Bracket/TradeGuard)**: Optional target + stop loss. For credit strategies: target=50% profit, stop=2x credit. For debit: target=50% gain, stop=50% loss.
- **Preview API**: `POST /api/trade/preview` fetches live bid/ask/mid/last from broker, computes suggested limit/target/stop
- **Place API**: `POST /api/trade/place` places entry order via broker, persists to `trade_orders` table, optionally creates a `managed_exits` record for server-side exit monitoring
- **AlgoPilotX path**: Unchanged — still uses the Dialog for automation endpoint signals
DB tables: `trade_orders` (entry order details, status, fill info, strategy metadata), `managed_exits` (target/stop, status, exit order tracking)

### Exit Manager (TradeGuard)
The Exit Manager (`server/exit-manager.ts`) is a server-side cron worker that monitors managed exits during market hours (9:30 AM - 4:00 PM ET). Every 30 seconds, it:
1. Fetches all active managed exits from the database
2. Gets live option quotes via the broker service
3. Checks if target or stop price conditions are met
4. Places a market close order when triggered and updates the managed exit status
Supports both buy-to-close (for debit strategies) and sell-to-close (for credit strategies) exit logic.

### Automated Scanning and Price Tracking
The platform includes an automated multi-strategy scanning system (`server/scheduled-scan-service.ts`) that runs at scheduled times, incorporating holiday awareness. It detects various VCP-related strategies (e.g., Momentum Breakout, Open Drive, Gap Force) and ingests opportunities into an Outcome Report. Extended hours price tracking (4:00 AM - 8:00 PM ET) updates max/min prices for active opportunities every 5 minutes to determine outcomes.

### Smart Panel (Context Panel)
The app uses a 3-column layout: [Sidebar] [Smart Panel] [Main Content]. The Smart Panel (`client/src/components/smart-panel.tsx`) is a 280px collapsible side panel between the navigation sidebar and main content area. It provides at-a-glance context:
1. **Next Best Action** — dynamic guidance (Connect Broker → Set Risk Profile → Create Universe → Run Scan)
2. **Top Pick** — single highest-score active opportunity
3. **Broker Status** — connected/disconnected with provider name
4. **Risk Profile Summary** — mode, risk/trade %, max deploy %, protections status
5. **Quick Actions** — contextual agent pause/resume, scanner shortcut
Collapse state is persisted to localStorage (`vcp_smart_panel_collapsed`). Auto-collapses on screens < 1280px. Hidden on mobile (< 768px).

### UI/UX
The UI utilizes Radix UI primitives for accessibility and a custom Tailwind CSS design system tailored for trading aesthetics. Lucide React provides icons.

## External Dependencies

### Database
- **PostgreSQL**: Primary database for all application data.

### Brokerage Integrations
The application connects to multiple brokerage providers for market data and direct trading. Broker connections are stored encrypted in PostgreSQL. The `broker_connections` table includes a `preferred_account_id` column so users with multiple brokerage accounts can select which account to use for trading. This preference is surfaced via `GET /api/broker/status` (includes `preferredAccountId`) and updated via `PATCH /api/broker/preferred-account`. The Settings > Broker tab shows an account picker when multiple accounts exist, and a dialog prompts account selection after a new broker connection is established. Scanner pages auto-select the preferred account for trade tickets.
- **Tradier**: OAuth-based integration for market data and trading. Provider implementation in `server/broker/providers/tradier.ts`.
- **TradeStation**: OAuth-based integration (Authorization Code flow) for market data and trading via TradeStation v3 API. Provider implementation in `server/broker/providers/tradestation.ts`. Supports automatic token refresh via refresh_token grant. OAuth scopes include `openid offline_access profile MarketData ReadAccount Trade Matrix OptionSpreads`. Affiliate signup link: `https://getstarted2.tradestation.com/intro?offer=ALGOAGRB` (shown only when disconnected).
- **SnapTrade**: OAuth-based integration for direct order execution with 20+ brokerages. Utilizes `snaptrade-typescript-sdk`. Supports dual execution methods (AlgoPilotX Webhook or SnapTrade Direct).

### Push Notifications
- **Web Push API**: Used for real-time alert delivery.

### News & Research
- **Stock News API**: Provides compliance-safe news headlines by ticker symbol, with in-memory caching and rate limiting.

### Maintenance Mode
Set `MAINTENANCE_MODE=true` to put the app into maintenance mode. This blocks all routes except `/`, `/health`, `/login`, `/register`, `/status`, `/pricing`, `/terms`, `/legal`, and static assets. API requests receive a 503 JSON response; browser requests see a styled maintenance page. Set `MAINTENANCE_MODE=false` (or remove) to resume normal operation. In Railway: Settings > Variables > add `MAINTENANCE_MODE` with value `true` or `false`, then redeploy.

### Health Check
`GET /health` always returns `{"ok":true,"app":"vcptrader"}` (200), even during maintenance mode. Use this for uptime monitoring and Railway health checks.

### Environment Variables
Key environment variables required for deployment include `DATABASE_URL`, `SESSION_SECRET`, `LEGAL_VERSION`, `SUPPORT_EMAIL`, `APP_URL`, `BROKER_TOKEN_KEY`, `TRADIER_CLIENT_ID`, `TRADIER_CLIENT_SECRET`, `TRADESTATION_CLIENT_ID`, `TRADESTATION_CLIENT_SECRET`, `SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CONSUMER_KEY`, `STOCKNEWSAPI_TOKEN`, and `MAINTENANCE_MODE`.