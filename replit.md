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

### Futures Trading Module (Mock Mode)
The Futures module offers a complete mock futures trading experience with streaming market data, pattern scanning, order execution, and automated agent support. It uses a modular adapter pattern allowing for easy integration with real brokers. It includes a worker for processing commands, managing market state, and simulating orders, with features like order rate limiting and position limits.

### Trade Ticket v2 (InstaTrade)
A Sheet-based drawer replaces the old InstaTrade dialog for direct broker orders, offering simple and advanced modes, exit plan (bracket/TradeGuard) options, and API endpoints for trade preview and placement.

### Exit Manager (TradeGuard)
A server-side cron worker monitors managed exits during market hours, fetching live quotes, checking conditions, and placing market close orders when triggers are met.

### Automated Scanning and Price Tracking
The platform includes an automated multi-strategy scanning system that runs at scheduled times, detecting VCP-related strategies and ingesting opportunities. Extended hours price tracking updates prices to determine outcomes.

## External Dependencies

### Database
- **PostgreSQL**: Primary database for all application data.

### Brokerage Integrations
The application connects to multiple brokerage providers, storing encrypted connections and allowing users to select a preferred trading account.
- **Tradier**: OAuth-based integration for market data and trading.
- **TradeStation**: OAuth-based integration (Authorization Code flow) for market data and trading via TradeStation v3 API, with automatic token refresh.
- **SnapTrade**: OAuth-based integration for direct order execution with 20+ brokerages, supporting dual execution methods.

### Push Notifications
- **Web Push API**: Used for real-time alert delivery.

### News & Research
- **Stock News API**: Provides compliance-safe news headlines by ticker symbol with caching and rate limiting.