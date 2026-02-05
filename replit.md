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

### Authentication & Authorization
The system uses email/password authentication with bcrypt hashing and PostgreSQL-backed sessions. It supports `user` and `admin` roles, enforcing role-based access control for different API routes.

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

### Environment Variables
Key environment variables required for deployment include `DATABASE_URL`, `SESSION_SECRET`, `LEGAL_VERSION`, `SUPPORT_EMAIL`, `APP_URL`, `BROKER_TOKEN_KEY`, `TRADIER_CLIENT_ID`, `TRADIER_CLIENT_SECRET`, `TRADESTATION_CLIENT_ID`, `TRADESTATION_CLIENT_SECRET`, `SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CONSUMER_KEY`, and `STOCKNEWSAPI_TOKEN`.