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

### Centralized Broker Service API
A provider adapter pattern (`server/broker/`) normalizes brokerage data across providers. Each provider (e.g., `server/broker/providers/tradier.ts`) implements a `BrokerProvider` interface with `getStatus`, `getAccounts`, `getPositions`, and `getOrders` methods. The central service (`server/broker/index.ts`) adds an in-memory cache with 5-15s TTLs to avoid rate limits. Endpoints:
- `GET /api/broker/accounts` — normalized accounts `[{id, name, type, buyingPower, equity, currency}]`
- `GET /api/broker/positions` — normalized positions `[{symbol, qty, avgPrice, marketPrice, unrealizedPnl}]`
- `GET /api/broker/orders` — recent orders `[{id, symbol, side, qty, status, createdAt}]`
- Legacy `GET /api/broker/status` unchanged for backward compatibility.

### Authentication & Authorization
The system uses email/password authentication with bcrypt hashing and PostgreSQL-backed sessions. It supports `user` and `admin` roles, enforcing role-based access control for different API routes.

### Options Scanner
The Options Scanner (`server/engines/options-scanner/`) provides a modular options scanning engine with strategy-based candidate discovery. The engine stub supports multiple strategies (Wheel, Credit Spreads, MWFS, Iron Condor, Covered Calls) and universe selections (S&P 500, Nasdaq 100, High IV, Watchlist). Scan results are persisted in the `options_scans` table for history. API endpoints:
- `GET /api/options/strategies` — list of available strategy definitions
- `POST /api/options/scan` — run a scan `{universeId, strategyKey}`, returns ranked candidates
- `GET /api/options/scans?limit=20` — recent scan history
All options endpoints require authentication and `optionsScanner` entitlement. The UI page at `/app/options` provides universe dropdown, strategy tabs, run scan button, and results table.

### Automated Scanning and Price Tracking
The platform includes an automated multi-strategy scanning system (`server/scheduled-scan-service.ts`) that runs at scheduled times, incorporating holiday awareness. It detects various VCP-related strategies (e.g., Momentum Breakout, Open Drive, Gap Force) and ingests opportunities into an Outcome Report. Extended hours price tracking (4:00 AM - 8:00 PM ET) updates max/min prices for active opportunities every 5 minutes to determine outcomes.

### UI/UX
The UI utilizes Radix UI primitives for accessibility and a custom Tailwind CSS design system tailored for trading aesthetics. Lucide React provides icons.

## External Dependencies

### Database
- **PostgreSQL**: Primary database for all application data.

### Brokerage Integrations
The application connects to multiple brokerage providers for market data and direct trading. Broker connections are stored encrypted in PostgreSQL.
- **Tradier**: OAuth-based integration for market data access.
- **TradeStation**: OAuth-based integration for market data access.
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