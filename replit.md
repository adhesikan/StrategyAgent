# VCP Trader

## Overview
VCP Trader is a production-grade SaaS web application designed for active day traders. Its primary purpose is to automate the detection, tracking, and real-time alerting of Volatility Contraction Pattern (VCP) breakouts in the US stock market. The platform provides timely, actionable insights by identifying VCP patterns in their FORMING, READY, and BREAKOUT stages, automatically drawing resistance and stop levels, and supporting direct brokerage market data connectivity. It functions as a mobile-ready Progressive Web App (PWA) and aims to automate trade execution through advanced features like an auto-agent and options trading capabilities. The business vision is to empower traders with sophisticated tools for automated strategy execution and risk management.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
The frontend is a React 18 application built with TypeScript and Vite. It utilizes Wouter for routing, TanStack React Query for server state management, shadcn/ui (built on Radix UI) for accessible components, and Tailwind CSS for styling. TradingView lightweight-charts are used for price visualization, and PWA capabilities are enabled via a service worker and Web Push API.

### Backend
The backend is developed with Node.js and Express.js, written in TypeScript, providing RESTful API endpoints. It uses Drizzle ORM with PostgreSQL for data persistence and Zod for schema validation. Custom esbuild scripts manage the build process.

### Data Storage
PostgreSQL serves as the primary database, managed by Drizzle ORM, with automatic migration application during builds.

### Project Structure
The project is modularized into `client/` for the React frontend, `server/` for the Express backend, and `shared/` for common code and type sharing.

### Key Design Patterns
A Storage Interface Pattern abstracts data access. Path aliases streamline imports, and type sharing between frontend and backend is achieved via `@shared/schema`. Client-server communication is handled through a `fetch` wrapper integrated with React Query.

### Centralized Strategy Scoring
All pattern score calculations are centralized in strategy modules, with `classifyQuote()` serving as the single entry point for scoring various strategies (VCP, VCP_MULTIDAY, CLASSIC_PULLBACK) and plugin types (ORB, GAP_AND_GO, VWAP_RECLAIM, HIGH_RVOL).

### Trade Status System
A centralized system computes the actionability of scan results, categorizing them as `AWAITING_BREAKOUT`, `IN_ENTRY_ZONE`, or `EXTENDED` based on price proximity to resistance/entry levels.

### Centralized Broker Service API
A provider adapter pattern normalizes brokerage data across different providers, including an in-memory cache for rate limit management. It offers endpoints for accounts, positions, and orders.

### Paper Trading
Tradier paper trading is supported using a separate sandbox API token for simulated trades.

### Authentication & Authorization
The system uses email/password authentication with bcrypt hashing and PostgreSQL-backed sessions, supporting `user` and `admin` roles with role-based access control.

### Options Scanner
A modular options scanning engine provides strategy-based candidate discovery for Long Options, Wheel Strategy, and Credit Spreads, with persisted results and configurable preferences.

### Futures Trading Module
The Futures module offers a complete trading experience with streaming market data, pattern scanning, and order execution. It uses a modular adapter pattern (`IFuturesBrokerAdapter`) with an adapter factory (`server/trading/futures/adapterFactory.ts`) for selecting between mock and real data feeds (Rithmic). Tick-to-bar aggregation ensures data availability, and front-month contract resolution is supported. The mock adapter supports market, limit, and stop orders with OCO-linked bracket orders. An Auto Agent supports configurable trade sizing, entry/exit windows, and bracket orders.

### Trade Autopilot
The `/automation` page consolidates all automation features, offering a Mode Selector (ALERTS/ASSISTED/AUTONOMOUS), Auto Agent Setup, Broker Connection status, and Safety Controls (kill switch, daily loss limit, max position size). AUTONOMOUS mode requires compliance acknowledgment.

### Automated Options Trading
The Auto Agent supports automated options trading, evaluating eligible equity opportunities through the options scanner engine and filtering candidates by policy-defined options criteria (delta, DTE, premium, OI, volume, max risk).

### Trade Ticket v2 (InstaTrade™)
A sheet-based drawer for direct broker orders, offering simple and advanced modes, exit plan options (bracket/TradeGuard), and API endpoints for trade preview and placement. InstaTrade™ is a trademarked feature.

### Exit Manager (TradeGuard)
A server-side cron worker monitors managed exits during market hours, fetching live quotes, checking conditions, and placing market close orders when triggers are met.

### Automated Scanning and Price Tracking
The platform includes an automated multi-strategy scanning system that runs at scheduled times covering premarket through extended hours. The Command Center displays "Today's Opportunities" with sortable columns, multi-criteria filtering, and chart viewing capabilities.

### External Trade Alerts (Strategy Fundamentals)
A webhook-based alert ingestion system receives trade signals from external providers for autonomous execution. Alerts are stored in the `external_alerts` table with lifecycle statuses. The agent worker processes these alerts, evaluating them against user policies.

### Command Center Advanced Filters & Presets
The Command Center's "Today's Top Picks" section features an expandable advanced filter panel for filtering results by Risk/Reward, Trade Status, Price Range, RVOL, Change %, and result count. Users can save, load, and manage named filter presets.

## External Dependencies

### Database
-   **PostgreSQL**: Primary database for all application data.

### Brokerage Integrations
The application connects to multiple brokerage providers, storing encrypted connections and allowing users to select a preferred trading account. All OAuth tokens have automatic refresh support.
-   **Tradier**: OAuth-based integration for market data and trading.
-   **TradeStation**: OAuth-based integration for market data and trading via TradeStation v3 API.
-   **SnapTrade**: OAuth-based integration for direct order execution with 20+ brokerages.

### Partner Dashboard (Standalone Auto-Trading)
A standalone partner dashboard at `/partner/dashboard` allows newsletter subscribers to automate trade execution from external signals. Partners are registered, and subscribers are onboarded via JWT validation, creating linked user accounts and provisioning API keys. The dashboard provides broker connection, agent configuration (with tooltips on all metrics), and trade history features. A strong legal disclaimer is displayed at the bottom of the dashboard.

### Auto Mode Consent System
When a partner user switches their Agent Mode to "Auto" (autonomous execution), a confirmation dialog requires explicit acknowledgment of trading risks. Consent records (email, timestamp, client IP, user agent, consent text) are stored in the `auto_mode_consents` table and can be used for compliance reporting. The consent + mode change are saved atomically.

### Bracket Order Customization
The agent configuration supports custom bracket order pricing for both stop-loss and profit-target legs. Stop methods: From Signal, % from Entry, $ from Entry. Target methods: From Signal, % from Entry, $ from Entry, Risk:Reward Ratio. Fields are stored in `bracket_stop_method`, `bracket_stop_value`, `bracket_target_method`, `bracket_target_value` columns on `agent_settings`.

### Partner Subscription (Stripe)
Partner subscriptions are managed via Stripe Checkout and Billing Portal.
-   **Stripe Integration**: `server/stripeClient.ts` fetches credentials, and `server/webhookHandlers.ts` processes Stripe webhooks.
-   **Product**: "Auto Trading Subscription" product with a $39/month recurring price.
-   **Paywall**: The partner dashboard displays a `SubscriptionPaywall` component for unsubscribed users.
-   **Sync**: A cron job syncs subscription statuses from Stripe to `partner_users`.

### Push Notifications
-   **Web Push API**: Used for real-time alert delivery.

### Partner Broadcast Webhook
A partner-level broadcast webhook (`POST /api/partner/alerts/broadcast`) enables partners to send a single trade signal that automatically fans out to all their active subscribers. Authentication uses a partner API key (`X-API-Key` header) auto-generated during partner creation. The endpoint supports both raw text format (Strategy Fundamentals style) and structured JSON. See `PARTNER_INTEGRATION_GUIDE.md` for full integration documentation.

### News & Research
-   **Stock News API**: Provides compliance-safe news headlines by ticker symbol with caching and rate limiting.