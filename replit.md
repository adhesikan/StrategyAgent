# VCP Trader

## Overview
VCP Trader is a production-grade SaaS web application for active day traders, specializing in identifying, tracking, and alerting on Volatility Contraction Pattern (VCP) breakouts in the US stock market. It provides real-time notifications, automatically draws resistance and stop levels, supports direct brokerage market data connectivity, and functions as a mobile-ready Progressive Web App (PWA). The platform's core purpose is to automate the detection of VCP patterns (FORMING, READY, BREAKOUT stages) to deliver timely, actionable insights.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
The frontend is a React 18 application with TypeScript, built using Vite. It uses Wouter for routing, TanStack React Query for server state, shadcn/ui (built on Radix UI) for components, and Tailwind CSS for styling. TradingView lightweight-charts are used for price visualization, and PWA capabilities are enabled via a service worker and Web Push API. The UI employs a 3-column layout with a collapsible Smart Panel for contextual information and uses Radix UI primitives for accessibility.

### Backend
The backend is built with Node.js and Express.js, written in TypeScript, featuring RESTful API endpoints. It uses Drizzle ORM with PostgreSQL for data persistence and Zod for schema validation. The build system uses custom esbuild scripts.

### Data Storage
PostgreSQL is the primary database, managed by Drizzle ORM. Database migrations are automatically applied during the build process.

### Project Structure
The project is organized into `client/` for the React frontend, `server/` for the Express backend, and `shared/` for common code, including database schemas.

### Key Design Patterns
A Storage Interface Pattern abstracts data access. Path aliases streamline imports, and type sharing between frontend and backend is achieved via `@shared/schema`. Client-server communication is handled through a `fetch` wrapper with React Query.

### Centralized Strategy Scoring
All pattern score calculations are centralized in the strategy modules under `server/strategies/`. The `classifyQuote()` function in `server/strategies/index.ts` is the single entry point for scoring any strategy from quote data. It handles both `Strategy` types (VCP, VCP_MULTIDAY, CLASSIC_PULLBACK) and `StrategyPlugin` types (ORB, GAP_AND_GO, VWAP_RECLAIM, HIGH_RVOL, etc.). When candles are available, plugin strategies use their full `scan()` method; otherwise, a quote-based fallback with qualifying criteria is used. Chart data (`processChartData`) does not compute its own `patternScore` - the UI always uses the score from the scan result.

### Trade Status System
A centralized system computes the actionability of scan results based on price proximity to resistance/entry levels, categorizing them as `AWAITING_BREAKOUT`, `IN_ENTRY_ZONE`, or `EXTENDED`.

### Centralized Broker Service API
A provider adapter pattern normalizes brokerage data across providers, including an in-memory cache to manage rate limits. It provides endpoints for accounts, positions, orders, and sandbox token management.

### Paper Trading
Tradier paper trading is supported using a separate sandbox API token, allowing users to simulate trades without real capital.

### Authentication & Authorization
The system uses email/password authentication with bcrypt hashing and PostgreSQL-backed sessions, supporting `user` and `admin` roles with role-based access control.

### Options Scanner
A modular options scanning engine provides strategy-based candidate discovery for Long Options, Wheel Strategy, and Credit Spreads. Scan results are persisted, and the API offers endpoints for strategies, scanning, and scan history. The UI supports viewing and configuring scan preferences.

### Futures Trading Module (Mock + Rithmic)
The Futures module offers a complete futures trading experience with streaming market data, pattern scanning, order execution, and automated agent support. It uses a modular adapter pattern (`IFuturesBrokerAdapter`) with an adapter factory (`server/trading/futures/adapterFactory.ts`) that selects between mock and real data feeds. The `MockFuturesAdapter` is the default and automatic fallback. Setting `FUTURES_FEED=rithmic` activates the `RithmicProtocolAdapter` which connects to Rithmic R|Protocol API via WebSocket for live market data and order execution. An automated importer (`scripts/import-rithmic-api.ts`) extracts uploaded Rithmic API zip files and copies proto definitions to `server/trading/brokers/rithmic/proto/`. If Rithmic initialization fails for any reason, the system automatically falls back to mock. The Rithmic adapter includes a tick-to-bar aggregation fallback: when native time bar subscriptions fail (e.g., code 1015 on test servers), it automatically builds 1-minute OHLCV bars from incoming tick data, ensuring bars are always available when ticks flow. The fallback auto-deactivates if native bars start arriving. Front-month contract resolution queries Rithmic for correct trading symbols (e.g., MESH6) with computed symbol fallback. The mock adapter supports market, limit, and stop order types with OCO-linked bracket orders. The Auto Agent supports configurable trade sizing (contracts or dollar amount), entry/exit time windows in Eastern Time, and bracket orders with take profit (limit) and stop loss (stop) exits.

### Automation Center
A unified "Automation Center" at `/automation` consolidates all automation systems under a single interface with 4 sections: Mode Selector (ALERTS/ASSISTED/AUTONOMOUS), Engine Selector (BUILT_IN/ALGOPILOTX), Broker Connection status, and Safety Controls (kill switch, daily loss limit, max position size). The `user_settings` table stores `automationMode`, `automationEngine`, `selectedAlgopilotxEndpointId`, and `automationStatus` (ARMED/PAUSED/DISABLED). AUTONOMOUS mode requires a compliance acknowledgement gate before activation. The Command Center displays live automation status badges and a dynamic setup checklist. AlgoPilotX integration uses webhook endpoints abstracted as "Automation Profiles" with connection testing. The execution page (`/execution`) provides profile management and the built-in Auto Agent panel.

### Trade Ticket v2 (InstaTrade™)
A Sheet-based drawer for direct broker orders, offering simple and advanced modes, exit plan (bracket/TradeGuard) options, and API endpoints for trade preview and placement. InstaTrade™ is a trademarked feature name and must always display with the ™ symbol in all user-facing text throughout the application. The Command Center chart drawer opens InstaTrade™ directly instead of linking to separate pages.

### Exit Manager (TradeGuard)
A server-side cron worker monitors managed exits during market hours, fetching live quotes, checking conditions, and placing market close orders when triggers are met.

### Automated Scanning and Price Tracking
The platform includes an automated multi-strategy scanning system that runs at 5 scheduled times covering premarket through extended hours: 8:00 AM ET (premarket: Gap Force, VCP), 9:45 AM ET (swing strategies), 10:00 AM ET (early momentum), 11:00 AM ET (mid-morning), and 4:15 PM ET (extended hours: VCP, VWAP Reclaim, Volume Surge). The Command Center's "Today's Opportunities" section provides sortable columns (ticker, stage, price, pattern score), multi-criteria filtering (stage, confidence threshold, strategy), card/list view toggle with localStorage persistence, and click-to-view-chart via a Sheet drawer showing PriceChart with candles, EMAs, resistance/stop levels, and trading statistics. Market hours detection spans 8:00 AM - 4:30 PM ET. Extended hours price tracking updates prices to determine outcomes.

## External Dependencies

### Database
- **PostgreSQL**: Primary database for all application data.

### Brokerage Integrations
The application connects to multiple brokerage providers, storing encrypted connections and allowing users to select a preferred trading account. All OAuth tokens have automatic refresh support when refresh tokens are available.
- **Tradier**: OAuth-based integration for market data and trading. Access tokens expire after 24 hours and are auto-refreshed via `refreshTradierToken()` in `server/broker/index.ts`. Token expiration is stored in `accessTokenExpiresAt` on the broker connection.
- **TradeStation**: OAuth-based integration (Authorization Code flow) for market data and trading via TradeStation v3 API, with automatic token refresh (~20 min TTL).
- **SnapTrade**: OAuth-based integration for direct order execution with 20+ brokerages, supporting dual execution methods.
- **Token Health Monitoring**: The `/api/broker/token-health` endpoint reports token status (valid/expiring/expired) and the Command Center displays a notification banner when tokens need attention.

### Push Notifications
- **Web Push API**: Used for real-time alert delivery.

### News & Research
- **Stock News API**: Provides compliance-safe news headlines by ticker symbol with caching and rate limiting.