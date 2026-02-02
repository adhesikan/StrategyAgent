# VCP Trader

**A Sunfish Technologies LLC Platform**

## Overview

VCP Trader is a production-grade SaaS web application developed by Sunfish Technologies LLC for active day traders focused on identifying, tracking, and alerting on Volatility Contraction Pattern (VCP) breakouts. The platform scans the US stock market to detect VCP patterns at various stages (FORMING, READY, BREAKOUT), automatically draws resistance and stop levels, and provides real-time alerts via push notifications. It's designed as a mobile-ready Progressive Web App (PWA) with direct brokerage market data connectivity.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript, built using Vite
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack React Query for server state and caching
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom design tokens for trading UI aesthetics
- **Charts**: TradingView lightweight-charts for price/candle visualization
- **PWA Support**: Service worker and Web Push API for mobile app experience

### Backend Architecture
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript with ES modules
- **API Design**: RESTful endpoints under `/api/*` prefix
- **Database ORM**: Drizzle ORM with PostgreSQL
- **Schema Validation**: Zod for runtime type validation, drizzle-zod for schema-to-type integration
- **Build System**: Custom esbuild script for server bundling, Vite for client

### Data Storage
- **Primary Database**: PostgreSQL (configured via `DATABASE_URL` environment variable)
- **Schema Location**: `shared/schema.ts` - contains all table definitions
- **Key Tables**: users, symbols, candles, scan_results, alerts, watchlists, broker_connections, push_subscriptions
- **Migrations**: Managed via Drizzle Kit (`drizzle-kit push`)

### Project Structure
```
├── client/           # React frontend application
│   ├── src/
│   │   ├── components/   # UI components (app-specific and shadcn/ui)
│   │   ├── pages/        # Route page components
│   │   ├── hooks/        # Custom React hooks
│   │   └── lib/          # Utilities and providers
├── server/           # Express backend
│   ├── index.ts      # Server entry point
│   ├── routes.ts     # API route definitions
│   ├── storage.ts    # Data access layer interface
│   └── vite.ts       # Vite dev server integration
├── shared/           # Shared code between client and server
│   └── schema.ts     # Database schema and Zod types
```

### Key Design Patterns
- **Storage Interface Pattern**: `IStorage` interface in `storage.ts` abstracts data access, allowing swap between in-memory and database implementations
- **Path Aliases**: `@/` maps to client/src, `@shared/` maps to shared directory
- **Type Sharing**: Schema types are shared between frontend and backend via `@shared/schema`
- **API Communication**: Client uses fetch wrapper with React Query for all API calls

## Authentication & Authorization

### Email/Password Authentication (Portable)
- **Authentication**: Email/password with bcrypt hashing (works on any platform)
- **Session Storage**: PostgreSQL-backed sessions via `connect-pg-simple`
- **User Roles**: `user` (default) and `admin` roles
- **Auth Files Location**: `server/replit_integrations/auth/`
- **Client Hook**: `client/src/hooks/use-auth.ts` for React components
- **Auth Pages**: `client/src/pages/auth.tsx` - login/register forms

### Auth API Endpoints
- `POST /api/auth/register` - Create new user account
- `POST /api/auth/login` - Authenticate and create session
- `POST /api/auth/logout` - Destroy session
- `GET /api/auth/user` - Get current authenticated user

### Role-Based Access Control
- **Public Routes**: Market stats, scan results (read), chart data, alerts (read)
- **Authenticated Routes**: Push subscription, user profile
- **Admin-Only Routes**: Scan run, alerts CRUD, watchlists CRUD, broker connections, backtest

### Deployment Requirements
- `SESSION_SECRET` environment variable required
- `DATABASE_URL` environment variable for PostgreSQL connection
- `LEGAL_VERSION` environment variable (e.g., "2026-01-01") for legal acceptance tracking
- `SUPPORT_EMAIL` environment variable for legal page contact info

### Railway Deployment
- **Configuration Files**: `railway.json` and `railway.toml` for build and deploy settings
- **Build Command**: `npm run build`
- **Start Command**: `npm run db:push --force && node scripts/migrate.js && npm run start`
- **Database**: Automatically pushes schema changes to PostgreSQL when the app starts
- **Environment Variables Required on Railway**:
  - `DATABASE_URL` - PostgreSQL connection string
  - `SESSION_SECRET` - Random secret for session encryption
  - `LEGAL_VERSION` - Current legal policy version date
  - `SUPPORT_EMAIL` - Support contact email
  - `APP_URL` - Full app URL for OAuth callbacks (e.g., `https://your-app.railway.app`) - Required for SnapTrade brokerage OAuth flow

## External Dependencies

### Database
- **PostgreSQL**: Primary data store, connection via `DATABASE_URL` environment variable

### Stripe Integration (TODO)
- **Status**: Pending - user will provide API keys later
- **Purpose**: Subscription-based access to trade signals
- **Required Keys**: `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`

### Brokerage Integrations
The app connects to multiple brokerage providers for market data:
- Tradier (commission-free trading)
- Alpaca (API-first stock trading)
- Interactive Brokers (professional trading)
- Charles Schwab (full-service)
- Polygon.io (market data only)

**Broker Connection Persistence**: Broker connections are stored in the PostgreSQL database with encrypted tokens (AES-256-GCM). Connections survive Railway deployments and server restarts. On server startup, the app:
1. Restores all active broker connections from the database
2. Validates token expiry and marks expired connections as disconnected
3. Users with expired tokens will need to re-authenticate

**Security**: Broker credentials are encrypted with `BROKER_TOKEN_KEY` environment variable before storage. Never stored in plaintext.

### SnapTrade Integration (Direct Brokerage Trading)
- **Purpose**: OAuth-based brokerage connections for direct order execution via InstaTrade
- **SDK**: `snaptrade-typescript-sdk` for API communication
- **Supported Brokers**: 20+ brokerages including Alpaca, Interactive Brokers, TD Ameritrade, Schwab, Fidelity, Robinhood, and more
- **Required Environment Variables**:
  - `SNAPTRADE_CLIENT_ID` - SnapTrade application client ID
  - `SNAPTRADE_CONSUMER_KEY` - SnapTrade consumer/API key

**SnapTrade OAuth Flow**:
1. User clicks "Connect Brokerage" in Settings
2. App registers user with SnapTrade (or retrieves existing credentials)
3. User redirected to SnapTrade portal for broker authentication
4. Callback syncs accounts to `snaptradeConnections` table
5. User can place orders directly from InstaTrade dialog

**SnapTrade API Endpoints**:
- `GET /api/snaptrade/status` - Check if SnapTrade is configured
- `POST /api/snaptrade/register` - Register user with SnapTrade
- `POST /api/snaptrade/auth-link` - Generate OAuth redirect link
- `GET /api/snaptrade/connections` - List user's connected accounts
- `POST /api/snaptrade/sync` - Sync accounts after OAuth callback
- `GET /api/snaptrade/holdings/:accountId` - Fetch account holdings
- `GET /api/snaptrade/balance/:accountId` - Fetch account balance
- `POST /api/snaptrade/orders` - Place a trade order
- `GET /api/snaptrade/brokers` - List supported brokers
- `DELETE /api/snaptrade/connections/:authId` - Disconnect a brokerage

**Security**: SnapTrade user secrets are encrypted at rest using AES-256-GCM (same as broker tokens). Account ownership is validated before order placement.

### Dual Execution Methods (InstaTrade)
InstaTrade supports two execution methods, selectable per trade:
1. **AlgoPilotX Webhook**: Sends trade setup to external automation platform
2. **SnapTrade Direct**: Places limit order directly with connected brokerage

### Push Notifications
- Web Push API with VAPID keys for real-time alert delivery

### News & Research (Stock News API)
The platform includes a compliance-safe news research feature for looking up recent headlines:

**Configuration**:
- **API Provider**: Stock News API (stocknewsapi.com)
- **Required Secret**: `STOCKNEWSAPI_TOKEN` environment variable
- **Service File**: `server/news-service.ts`

**Features**:
- Search headlines by ticker symbol
- In-memory caching with 60-second TTL to reduce API calls
- Per-IP rate limiting (30 requests per 5 minutes)
- Compliance-safe: Shows factual data only (headline, source, date, URL)
- No sentiment analysis, interpretations, or recommendations

**API Endpoints**:
- `GET /api/news?ticker=AAPL&items=10` - Fetch headlines for a ticker
- `GET /api/news/status` - Check if news service is configured

**Security**: API token is server-side only and never exposed to the client.

**UI Location**: Learn > News & Research (`/learn/news`)

### Scheduled Scan Service
The platform includes an automated multi-strategy scanning system that ensures all trading opportunities are tracked in the Outcome Report:

**Configuration**:
- **Holiday Awareness**: Skips major US market holidays (New Year's Day, MLK Day, Presidents Day, Good Friday, Memorial Day, Juneteenth, Independence Day, Labor Day, Thanksgiving, Christmas)
- **Service File**: `server/scheduled-scan-service.ts`

**Scheduled Scan Times** (all times Eastern):
| Time | Strategies | Purpose |
|------|-----------|---------|
| 9:45 AM | Momentum Breakout, Power Breakout | Swing/position strategies at market open |
| 10:00 AM | Open Drive (5m/15m), Gap Force | Early morning momentum plays |
| 11:00 AM | Institutional Reclaim, Volume Surge | Mid-morning setups |

**Strategy Classification Logic**:
- **Momentum Breakout / Power Breakout**: Volatility contraction pattern with breakout, ready, or forming stages
- **Open Drive (5m/15m)**: Opening Range Breakout - strong moves from open with high volume
- **Gap Force**: Stocks gapping up >2% that continue higher with volume
- **Institutional Reclaim**: Price near or above VWAP proxy with volume support
- **Volume Surge**: Stocks with >2x average volume indicating unusual activity

**Scanning Coverage**:
- Uses 100-symbol LARGE_CAP_UNIVERSE for consistent coverage
- Requires an active brokerage connection for market data
- Manual trigger runs all strategies at once

**Behavior**:
1. Checks if current day is a trading day (not weekend, not holiday)
2. Scans each strategy group at its scheduled time
3. Auto-ingests opportunities into the Outcome Report for tracking
4. Logs all activity for monitoring

**Admin API**:
- `POST /api/scheduled-scan/run` - Manually trigger all strategy scans (admin only)

### Extended Hours Price Tracking
The platform supports extended hours price tracking for the Opportunity Outcome Report:

**Coverage Window**: 4:00 AM - 8:00 PM ET
- Pre-market: 4:00 AM - 9:30 AM ET
- Regular hours: 9:30 AM - 4:00 PM ET
- After-hours: 4:00 PM - 8:00 PM ET

**Behavior**:
1. Runs every 5 minutes during trading window
2. Fetches latest quotes for all active opportunities
3. Updates max/min prices to track resistance breaks and stop hits
4. Opportunity resolver uses these prices to determine outcomes (BROKE_RESISTANCE, INVALIDATED, EXPIRED)

**Note**: Automation/webhooks remain restricted to regular market hours (9:30 AM - 4:00 PM ET) while price tracking covers extended hours.

### UI Dependencies
- Radix UI primitives for accessible components
- TradingView lightweight-charts for financial charting
- Lucide React for icons

### Key NPM Packages
- `drizzle-orm` / `drizzle-kit`: Database ORM and migrations
- `@tanstack/react-query`: Server state management
- `lightweight-charts`: TradingView charting library
- `web-push`: Push notification delivery
- `node-cron`: Scheduled scanner jobs
- `zod`: Schema validation