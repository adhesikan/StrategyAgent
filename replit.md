# VCP Trader AI (engine: Strategy Agent)

## Overview
VCP Trader AI is an AI-powered stock and options intelligence platform for self-directed traders. The Strategy Agent engine generates ranked candidate scenarios from market data, news sentiment, and user-defined limits; users review them and submit reviewed orders through their connected broker via **InstaTrade™**. All output is software-generated analysis — never investment advice. The app never auto-trades.

## User Preferences
- Communication style: simple, everyday language.
- Public branding: **VCP Trader AI** (Strategy Agent retained as engine sub-brand). InstaTrade™ trademarked. Do not use TradeGuard™ — use "Risk Controls / Built-In Risk Checks / Order Guardrails / Exit Protection" instead.
- No public automation/autopilot/autonomous language. Automation routes are admin-gated only.

## Pricing & Trial Model
- **One plan**: VCP Trader AI Pro — **$99/month with a 14-day free trial**.
- Stripe checkout endpoint (`server/services/billing/stripe.ts`) already passes `trial_period_days: 14`. The `pro` planId is reused — to deploy a new price the user updates `STRIPE_PRO_MONTHLY_PRICE_ID` to a $99 recurring Stripe price.
- `shared/plans.ts` still defines `free/pro/edge/team` for backward-compat with admin/partner code, but only `pro` is shown publicly. `client/src/pages/pricing.tsx` and the home `PricingSection` are single-plan layouts.
- Authenticated `PlanSelector` / `UpgradeModal` still reference legacy tiers — pending consolidation.

## Data Modes (BrokerStatusStrip)
Three standardized modes with hover tooltips, surfaced via `client/src/components/trading-shell.tsx`:
- **Live Broker Mode** — broker connected, non-sandbox account
- **Paper Mode** — broker connected, sandbox account (id starts with `sandbox:`)
- **Simulated Examples** — no broker connected (learning fallback)

## InstaTrade™ Flow
The only execution path. Sheet-based ticket (`client/src/components/stock-trade-ticket.tsx`) with required acknowledgment checkbox before submission. Button label adapts:
- No account → `Connect Broker to Use InstaTrade™` (disabled)
- Sandbox account → `Paper Trade`
- Live account → `Send to Broker with InstaTrade™`

Server-side execution guardrails (`server/services/execution-guardrails.ts`) block trades that violate stored preferences (allowed instruments, defined-risk-only, min score, min R/R) and return `GUARDRAIL_BLOCKED`.

## App Shell & Navigation
- **Sidebar** (`client/src/components/app-sidebar.tsx`): Home, Grow (`/goal-mode`), Income (`/income-mode`), Trade (`/trade-finder`), Markets (`/market-intel`); collapsible **More** with Top Opportunities (`/opportunity-radar`), My Activity (`/history`), My Limits (`/settings/risk-profile`), Settings, **Advanced Tools** (Trade Setups, Discover, Charts, Backtest, Alerts), plus User Guide (`/guide`) and Strategy Reference (`/help`). Admin items appended for admins.
- **Mobile bottom nav** (`client/src/components/mobile-bottom-nav.tsx`): Home/Grow/Income/Trade/More.
- **Authenticated home** (`client/src/pages/home-dashboard.tsx`): hero prompt → `QuickPromptBar` (intent-based routing) → status pills → `NewHereBadge` → 4 action cards → `AiSnapshotPanel` (`GET /api/home/snapshot`) → `PopularChips` → `ComplianceFooter`.
- **Public landing** (`client/src/pages/home.tsx`): hero (CTA "Start 14-Day Trial"), trust badges (Stocks+Options · Daily AI Ideas · Paper Mode Trial · Broker-Connected Data · InstaTrade™), problem/benefits/features, single-plan pricing, FAQ (8 spec Q&As), final CTA.
- **Compliance**: full §12 disclaimer in `client/src/components/footer.tsx` (global) and `ComplianceFooter` in `trading-shell.tsx` (in-app).

## User Guide
`/guide` (`client/src/pages/user-guide.tsx`) — 16 sections with sticky sidebar TOC + live search. Reusable `<HelpLink section="..." />` (`client/src/components/help-link.tsx`) renders a `?` icon next to titles on Grow, Income, Trade, Markets, Opportunity Radar, InstaTrade, and Settings, deep-linking into the matching guide section. Routes: `/guide`, `/guide/:section`. The older technical strategy doc remains at `/help`.

## Admin Portal (admin role only)
- `/admin` home, `/admin/users`, `/admin/emails` (composer + provider banner + history; SendGrid via `SENDGRID_API_KEY` + `EMAIL_FROM_ADDRESS`), `/admin/sessions` (audit log).
- Frontend gate: `<AdminOnly>` in `client/src/App.tsx` blocks non-admins from `/automation`, `/execution`, `/opportunities`, `/app/automation`, `/admin/*`.
- Backend gate: `app.use(['/api/automation', '/api/automation-profiles', '/api/automation-endpoints', '/api/automation-events'], isAuthenticated, isAdmin)` in `server/routes.ts`.
- Tables: `session_audit_events`, `email_campaigns`. Auth instrumentation: `recordSessionEvent()` in `server/replit_integrations/auth/routes.ts` fires on login/logout/register.

## Agent Architecture
- `server/agent/prompt-interpreter.ts` — natural language → structured request
- `server/agent/strategy-engine.ts` — wraps strategy plugins → normalized `TradeSetup`
- `server/routes/agent.ts` — setups, custom strategies, conditions CRUD, activity logs
- `client/src/components/trade-setup-card.tsx` — reusable setup card

### Probability Engine & Instrument Selector
5-factor weighted score (technical 30 / realtime 25 / news 15 / analyst 15 / risk 15) → A+/A/B/C grade. Instrument Selector recommends stock vs option (long call/put / debit spread) by bias, conviction, and user trade preferences. Tables: `setup_scores`, `instrument_recommendations`, `option_candidates`, `trade_outcomes`, `user_trade_preferences`. Services: `probability-engine.ts`, `instrument-selector.ts`, `options-evaluator.ts`, `execution-guardrails.ts`. Endpoints: `GET/PUT /api/user/trade-preferences`, `GET/POST/PATCH /api/trade-outcomes`, `POST /api/trade/place-option`.

### Analysis Conditions
14 built-in conditions (Volume/Trend/Momentum/Pattern/Risk/Price Level/Volatility), togglable with thresholds; users can also add custom conditions. Server evaluates each against generated setups and returns pass/fail badges. Endpoints: `GET /api/agent/built-in-conditions`, `GET/POST /api/agent/conditions`, `PATCH/DELETE /api/agent/conditions/:id`.

## Opportunity Radar (`/opportunity-radar`)
Software-generated, AI-ranked stock & options candidate scenarios. **Not autonomous** — every live order requires user review + checkbox ack. Composite score weights: technical 28 / sentiment 20 / momentum 22 / liquidity 15 / risk 15; A+/A/B/C grades, <60 hidden. Services in `server/services/opportunity-radar/` (`scoring.ts`, `universe-service.ts`, `ml-adapter.ts`, `radar-service.ts`, `news-score-adapter.ts`). Table: `opportunity_scenarios` (persisted on user action only). Endpoints: `GET /api/radar/scenarios`, `POST /api/radar/scenarios` (sent_order requires `complianceAcknowledged: true`), `GET /api/radar/scenarios/history`. Sent orders mirror to `tradeSetupHistory`.

## News Sentiment Layer
- Sources: StockNews API (mock fallback if `STOCKNEWS_API_KEY` missing) + OpenAI gpt-4o-mini for strict-JSON sentiment (rule-based fallback if `OPENAI_API_KEY` missing).
- Pipeline: `server/services/news/{stockNewsService,newsDedupService,openAiSentimentService,sentimentAggregationService,index}.ts` — fetch → dedupe by headline hash → analyze (cached) → aggregate per ticker → upsert snapshot. Single-flight refresh.
- Routes: `GET /api/sentiment/:symbol`, `GET /api/sentiment/watchlist`, `GET /api/news/trending`, `POST /api/admin/run-sentiment-refresh` (admin).
- Tables: `news_sentiment` (per-article), `ticker_sentiment_snapshot` (per-ticker rollup, 15-min TTL).
- Surfaced on Opportunity Radar (chip + "View News Context" drawer) and Market Intel (Morning Briefing, Watchlist Sentiment, Strongest Pos/Neg, "Why Is It Moving?" search).

## Goal/Income/Trade/Markets Modes
- `/goal-mode` (Grow): 6-step wizard (capital → goal → risk → activity → instruments → broker) → `GoalRealityCheck` + `CandidateScenarioCard`. `Prepare Order` always opens `OrderReviewModal` with explicit ack.
- `/income-mode`: covered-call / CSP / defined-risk form.
- `/trade-finder`: AgentPage aliased as "Advanced Trade Builder" with novice prompt chips.
- `/market-intel`: Morning Briefing, Why It's Moving, Watchlist Impact, Congress Flow, Top Catalysts.
- `/history`: TradeSetupsPage. Backward-compat: `/agent`, `/trade-setups` still resolve.
- `tradeSetupHistory` schema includes: `sourceMode`, `userCapital`, `monthlyTarget`, `maxRiskPerTrade`, `allowedInstruments`, `activityLevel`, `goalType`, `realityCheckText`, `complianceAcknowledged`, `orderReviewedAt`, `userConfirmedOrder`.

## System Architecture
- **Frontend**: React 18 + TypeScript + Vite, Wouter routing, TanStack React Query, shadcn/ui, Tailwind, TradingView lightweight-charts, PWA (service worker + Web Push).
- **Backend**: Node + Express in TypeScript, Drizzle ORM + PostgreSQL, Zod validation, custom esbuild.
- **Project layout**: `client/`, `server/`, `shared/`. Storage Interface Pattern abstracts data access. Type sharing via `@shared/schema`.

## Persona-Based Onboarding & Wizard Enforcement
7-step persona wizard computes a trader persona (label, strategy bundle, risk defaults). Wizard selections (`traderType`, `positionSizing`, `safetyLimits`, `automationMode`) are backend-enforced — controlling asset classes, computing trade quantity, max trade/loss limits, and policy-mode overrides. Day-Trader EOD mechanism auto-closes equity positions at market close. Admin disclaimer logs provide compliance audit trail.

## Data Models (key tables)
`custom_strategies`, `trade_setup_history`, `prompt_request_logs`, `activity_logs`, `analysis_conditions`, `news_sentiment`, `ticker_sentiment_snapshot`, `setup_scores`, `instrument_recommendations`, `option_candidates`, `trade_outcomes`, `user_trade_preferences`, `opportunity_scenarios`, `session_audit_events`, `email_campaigns`. Definitions in `shared/schema.ts`.

## Authentication & Authorization
Email/password with bcrypt + PostgreSQL-backed sessions. Roles: `user`, `admin`. Users can manage profile, change password, delete account.

## External Dependencies
- **PostgreSQL** — primary database (Drizzle ORM, auto-migrations on build).
- **Brokerage**: **Tradier** (OAuth, primary) and **TradeStation** (OAuth via v3 API, primary). **SnapTrade** also supported where available. Encrypted connections; user picks preferred trading account.
- **Stock News API** — compliance-safe headlines by ticker, cached & rate-limited.
- **OpenAI** — gpt-4o-mini for sentiment analysis (optional).
- **Web Push API** — real-time alert delivery.
- **Stripe** — subscription billing (Checkout + Billing Portal). Manages partner subscriptions and the single Pro plan with 14-day trial.

## Partner Dashboard (AlgoPilotX Branding)
Standalone dashboard for newsletter subscribers to automate trade execution from external signals. **Signal Provider** = partner newsletter; **Automation Provider** = AlgoPilotX (Sunfish Technologies LLC). `/api/partner/me` returns dynamic branding (`agentTitle`, `poweredBy`, `signalsLabel`, `executionLabel`); `/api/partner/context` provides pre-auth resolution (supports `?partner=slug`). All disclaimers reflect signal-source vs. automation-tool separation. Fallback: "Newsletter Auto Agent — Powered by AlgoPilotX". Disclaimer version: `v1.1.0`.

## Historical Features (kept for context)
- **Centralized strategy scoring & trade status** — pattern scoring centralized in strategy modules; results categorized as `AWAITING_BREAKOUT`, `IN_ENTRY_ZONE`, or `EXTENDED`.
- **Centralized broker service API** — provider adapter pattern, in-memory rate-limit cache, normalized accounts/positions/orders endpoints.
- **Futures Trading Module** — streaming data, pattern scanning, bracket orders; adapter factory for mock/Rithmic/TradeStation feeds.
- **Trade Autopilot (`/automation`, admin-only)** — Mode Selector (ALERTS/ASSISTED/AUTONOMOUS), Auto Agent setup, scan schedule, safety controls. Hidden from public/non-admin users per branding policy.
- **Automated options trading (admin)** — Auto Agent evaluates equities through the options scanner with policy-based filters.
- **Exit Manager (server cron)** — monitors managed exits during market hours and places market-close orders when triggers hit. Public branding now calls this "Exit Protection / Risk Controls".
- **Automated scanning & Top Picks** — multi-strategy scans on schedule; Command Center "Today's Top Picks" with sort/filter/chart.
- **External trade alerts (Strategy Fundamentals)** — webhook ingestion against user policies.
- **Command Center filters & presets** — expandable advanced filter panel with named saved presets.
