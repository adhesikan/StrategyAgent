# Strategy Agent

## Overview
Strategy Agent is an AI-powered strategy analysis and trade setup generation platform, built as a remix of the VCP Trader codebase. It presents existing broker connections, market data, charting, and execution infrastructure through a simplified AI-agent-driven interface. Users can ask for strategy-based trade setups using natural language, review structured setup cards with entry/stop/target/reasoning, and optionally execute via InstaTrade™. The app maintains compliance-safe framing throughout — all outputs are positioned as software-generated analysis, not investment advice.

### AI-First Navigation (3 items)
- **Agent** (`/home`) — Main dashboard: natural language prompt input, AI-powered setup generation, InstaTrade™ integration, live orders panel with SSE-based real-time updates
- **Setups** (`/trade-setups`) — Setup history with status tracking
- **Settings** (`/settings`) — Account, broker connections, & configuration

### Agent Architecture
- `server/agent/prompt-interpreter.ts` — Deterministic NLP parser converting natural language to structured request objects
- `server/agent/strategy-engine.ts` — Wraps existing strategy plugins to produce normalized TradeSetup objects
- `server/routes/agent.ts` — API routes for setup generation, custom strategies, conditions CRUD, and activity logging
- `client/src/components/trade-setup-card.tsx` — Reusable setup card component with compliance microcopy

### Analysis Conditions System
- 14 built-in conditions organized by category (Volume, Trend, Momentum, Pattern, Risk, Price Level, Volatility)
- Users can toggle built-in conditions on/off and adjust threshold values before generating setups
- Users can create custom conditions (saved to DB) with configurable type, operator, and value
- Active conditions are sent with each generate request; the server evaluates each condition against the resulting setup
- Setup results show pass/fail badges for each applied condition and warnings for failed conditions
- Built-in conditions endpoint: `GET /api/agent/built-in-conditions`
- User conditions CRUD: `GET/POST /api/agent/conditions`, `PATCH/DELETE /api/agent/conditions/:id`

### New Database Models
- `custom_strategies` — User-uploaded strategy definitions with validation status
- `trade_setup_history` — Generated setup history with status tracking
- `prompt_request_logs` — Audit trail of parsed prompts
- `activity_logs` — Activity event log
- `analysis_conditions` — User-created analysis conditions with type, operator, value, category, and enabled state

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
The frontend is a React 18 application with TypeScript and Vite, using Wouter for routing, TanStack React Query for server state management, shadcn/ui for accessible components, and Tailwind CSS for styling. TradingView lightweight-charts are used for price visualization, and PWA capabilities are enabled via a service worker and Web Push API.

### Backend
The backend is built with Node.js and Express.js in TypeScript, providing RESTful API endpoints. It uses Drizzle ORM with PostgreSQL for data persistence and Zod for schema validation. Custom esbuild scripts manage the build process.

### Data Storage
PostgreSQL serves as the primary database, managed by Drizzle ORM, with automatic migration application during builds.

### Project Structure
The project is modularized into `client/` for the React frontend, `server/` for the Express backend, and `shared/` for common code and type sharing.

### Key Design Patterns
A Storage Interface Pattern abstracts data access. Path aliases streamline imports, and type sharing between frontend and backend is achieved via `@shared/schema`. Client-server communication is handled through a `fetch` wrapper integrated with React Query.

### Novice-Friendly App Shell (Goal Mode / Income Mode / Market Intel)
The authenticated app uses a primary 7-item nav: **Home, Goal Mode, Trade Finder, Income Mode, Market Intel, History, Settings** (admin items appended for admin role). `/home` is a dashboard with 4 large action cards (Grow / Income / Find Trade / Markets) plus a `BrokerStatusStrip` (broker, data mode, market status, risk profile) and a `ComplianceFooter`. `/goal-mode` runs a 6-step wizard (capital → goal → risk → activity → instruments → broker) that produces a `GoalRealityCheck` and `CandidateScenarioCard` results; `Prepare Order` always opens an `OrderReviewModal` requiring an explicit acknowledgment checkbox before any submission (no auto-submit). `/income-mode` is a focused covered-call/CSP/defined-risk form. `/market-intel` is a 5-section scaffold (Morning Briefing, Why It's Moving, Watchlist Impact, Congress Flow, Top Catalysts) with TODO hooks for the news + congress feeds. `/trade-finder` aliases the existing AgentPage with the heading renamed to "Advanced Trade Builder" and 4 novice prompt chips. `/history` aliases TradeSetupsPage. Backward-compat: `/agent` and `/trade-setups` still resolve. Settings labels were simplified: Risk Profile → My Limits, Universes → Watchlists, Trade Prefs → Trading Preferences, Scanner → Opportunity Filters, Data Providers → Connect Your Broker. `tradeSetupHistory` schema gained `sourceMode`, `userCapital`, `monthlyTarget`, `maxRiskPerTrade`, `allowedInstruments`, `activityLevel`, `goalType`, `realityCheckText`, `complianceAcknowledged`, `orderReviewedAt`, `userConfirmedOrder`. Reusable components live in `client/src/components/trading-shell.tsx` and `client/src/components/goal-mode-shell.tsx`.

### Trading System Setup (Persona-Based Onboarding)
A 7-step persona-driven onboarding wizard guides users through setup, computing a trader persona (label, strategy bundle, risk defaults) from inputs. System profiles are versioned and stored, with agent-worker integrating profile settings as policy overrides. Admin disclaimer logs provide a compliance audit trail.

### Wizard Settings Backend Enforcement
Onboarding wizard selections (traderType, positionSizing, safetyLimits, automationMode) are fully enforced by the backend, controlling asset classes, calculating trade quantity, setting maximum trade/loss limits, and overriding agent policy modes. A Day Trader EOD Close mechanism automatically closes equity positions at market close.

### Centralized Strategy Scoring & Trade Status
All pattern score calculations are centralized in strategy modules, with a single entry point for various strategies and plugin types. A centralized system categorizes scan results as `AWAITING_BREAKOUT`, `IN_ENTRY_ZONE`, or `EXTENDED` based on price proximity.

### Centralized Broker Service API
A provider adapter pattern normalizes brokerage data across different providers, including an in-memory cache for rate limit management, offering endpoints for accounts, positions, and orders.

### Paper Trading
Tradier paper trading and TradeStation's sim environment are supported, routing simulated trades to respective sandbox APIs.

### Authentication & Authorization
The system uses email/password authentication with bcrypt hashing and PostgreSQL-backed sessions, supporting `user` and `admin` roles with role-based access control. Users can manage profiles, change passwords, and delete accounts.

### Admin User Management
An admin dashboard provides full user administration, including stats, searchable user lists, user details, and role management. Compliance acceptance logs are recorded for user disclaimers and consents.

### Futures Trading Module
The Futures module offers a complete trading experience with streaming market data, pattern scanning, and order execution. It uses a modular adapter pattern with an adapter factory for selecting between mock, Rithmic, and TradeStation data feeds. The Auto Agent supports configurable trade sizing, entry/exit windows, and bracket orders.

### Trade Autopilot
The `/automation` page consolidates all automation features, offering a Mode Selector (ALERTS/ASSISTED/AUTONOMOUS), Auto Agent Setup, Broker Connection status, Scan Schedule configuration, and Safety Controls. Users can enable/disable specific scan time windows and strategies.

### Automated Options Trading
The Auto Agent supports automated options trading, evaluating equity opportunities through the options scanner engine and filtering candidates by policy-defined options criteria.

### Trade Ticket v2 (InstaTrade™)
A sheet-based drawer for direct broker orders, offering simple and advanced modes, exit plan options (bracket/TradeGuard), and API endpoints for trade preview and placement.

### Exit Manager (TradeGuard)
A server-side cron worker monitors managed exits during market hours, fetching live quotes, checking conditions, and placing market close orders when triggers are met.

### Automated Scanning and Price Tracking
The platform includes an automated multi-strategy scanning system that runs at scheduled times. Users can customize scan windows and active strategies via the Trade Autopilot's Scan Schedule. The Command Center displays "Today's Top Picks" with sorting, filtering, and charting.

### External Trade Alerts (Strategy Fundamentals)
A webhook-based alert ingestion system receives trade signals from external providers for autonomous execution, processing them against user policies.

### Command Center Advanced Filters & Presets
The Command Center's "Today's Top Picks" section features an expandable advanced filter panel for filtering results by various criteria. Users can save, load, and manage named filter presets.

## External Dependencies

### Database
- **PostgreSQL**: Primary database for all application data.

### Brokerage Integrations
The application connects to multiple brokerage providers, storing encrypted connections and allowing users to select a preferred trading account.
- **Tradier**: OAuth-based integration for market data and trading.
- **TradeStation**: OAuth-based integration for market data and trading via TradeStation v3 API.
- **SnapTrade**: OAuth-based integration for direct order execution with 20+ brokerages.

### Push Notifications
- **Web Push API**: Used for real-time alert delivery.

### Partner Dashboard (AlgoPilotX Branding)
A standalone partner dashboard allows newsletter subscribers to automate trade execution from external signals. The UI dynamically displays the partner name (e.g., "Strategy Fundamentals Auto Agent") with "Powered by AlgoPilotX" branding. Key branding separation:
- **Signal Provider**: Partner newsletter provides trade signals (content).
- **Automation Provider**: AlgoPilotX (Sunfish Technologies LLC) provides the automation software only.
- The `/api/partner/me` endpoint returns dynamic branding fields: `agentTitle`, `poweredBy`, `signalsLabel`, `executionLabel`.
- The `/api/partner/context` endpoint provides pre-auth partner branding resolution (supports `?partner=slug` query parameter).
- All disclaimers, consent text, and legal copy on the partner dashboard reflect the signal-source vs. automation-tool separation.
- Fallback when no partner: "Newsletter Auto Agent — Powered by AlgoPilotX".
- Disclaimer version bumped to `v1.1.0` for partner consent text changes.

### Partner Subscription
- **Stripe**: Manages partner subscriptions via Checkout and Billing Portal, syncing subscription statuses from Stripe to `partner_users`.

### News & Research
- **Stock News API**: Provides compliance-safe news headlines by ticker symbol with caching and rate limiting.
### Strategy Agent — Probability Engine & Instrument Selector (April 2026)
The Agent now scores every generated setup with a 5-factor weighted Probability Engine (technical 30 / realtime 25 / news 15 / analyst 15 / risk 15) and assigns an A+/A/B/C grade. An Instrument Selector then recommends stock vs option (long call/put or debit spread) based on bias, conviction, and user trade preferences, with an alternative vehicle toggle.
- New tables: `setup_scores`, `instrument_recommendations`, `option_candidates`, `trade_outcomes`, `user_trade_preferences`.
- New services: `probability-engine.ts`, `instrument-selector.ts`, `options-evaluator.ts`, `execution-guardrails.ts`.
- New endpoints: `GET/PUT /api/user/trade-preferences`, `GET/POST/PATCH /api/trade-outcomes`, `POST /api/trade/place-option` (mock execution).
- Execution guardrails block trades that violate stored preferences (allowed instruments, defined-risk-only, min score, min R/R) on both equity and option place endpoints, with a clear `GUARDRAIL_BLOCKED` response code.
- Settings now has a "Trade Prefs" tab; Trade Setups page filters by grade, instrument, executed status, and minimum score.
