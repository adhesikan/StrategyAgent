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

## Two Modes (customer-facing)
Customer vocabulary is two modes only (no public paper/simulated trading claims):
- **Analysis Mode** — no broker connected. AI analysis, Educational Examples, delayed reference data. No orders.
- **Connected Broker Mode** — broker connected. Live data + InstaTrade™ order review/submission. Sandbox broker accounts (`sandbox:` id prefix) are internal/dev only and surface as "Sandbox: {provider}" / "Broker Sandbox".
Internal API values (`dataMode: "simulated"`, PP `accountMode: "paper"`, testids) are unchanged.

## Optional Onboarding (T104)
`client/src/components/start-choice.tsx`: StartChoiceDialog (gated on `prefs.onboardingStatus === 'not_started'`), 3-question QuickSetupDialog, PersonalizationPromptCard, IncompletePreferencesDisclosure — wired into `home-dashboard.tsx`. Home sections in `client/src/components/home/home-sections.tsx` (TodaysOpportunities, NeedsAttention, PositionsSummaryOrConnect).

## InstaTrade™ Flow
The only execution path. Sheet-based ticket (`client/src/components/stock-trade-ticket.tsx`) with required acknowledgment checkbox before submission. Button label adapts:
- No account → `Connect Broker to Use InstaTrade™` (disabled)
- Live account, Live Trading Setup incomplete → `Complete Live Trading Setup` (opens inline `LiveTradingSetupDialog` from `client/src/components/live-trading-setup.tsx`; saves prefs incl. `liveSetupCompleted`, options + execution-disclosure acks)
- Live account, setup complete → `Send to Broker with InstaTrade™`
Same gating in `option-trade-ticket.tsx`. Server enforces it too: `/api/trade/place-equity` and `/api/trade/place-option` return `LIVE_SETUP_REQUIRED` (422) for non-sandbox accounts when `liveSetupCompleted` is false.

Server-side execution guardrails (`server/services/execution-guardrails.ts`) block trades that violate stored preferences (allowed instruments, defined-risk-only, min score, min R/R) and return `GUARDRAIL_BLOCKED`.

## Position Protection (live-only)
Customer-facing PP is restricted to verified live brokerage positions. `server/services/position-protection/index.ts` flags: `liveEnabled` (default OFF — real-money exits require explicit `ENABLE_LIVE_POSITION_PROTECTION=true`), `sandboxEnabled` (default OFF, internal dev only — paper plans rejected with `LIVE_ONLY`). Flags accept both `ENABLE_*_POSITION_PROTECTION` and legacy `POSITION_PROTECTION_*` names; effective config is logged at worker startup. `POST /api/position-protection/plans` derives `accountMode` server-side from the `sandbox:` account-id prefix (client claim ignored).

## External Alert Webhook Hardening
`POST /api/external-alerts/webhook` (server/routes.ts): env kill switch `EXTERNAL_ALERT_WEBHOOK_ENABLED`, per-key rate limit (`EXTERNAL_ALERT_RATE_LIMIT_PER_MIN`, default 30/min), 5-min timestamp skew validation, idempotency/replay protection via `X-Idempotency-Key` or payload SHA-256 fingerprint (10-min TTL, in-memory — single-instance only).

## App Shell & Navigation
- **Sidebar** (`client/src/components/app-sidebar.tsx`): Home, Grow (`/goal-mode`), Income (`/income-mode`), Trade (`/trade-finder`), Markets (`/market-intel`); collapsible **More** with Top Opportunities (`/opportunity-radar`), My Activity (`/history`), My Limits (`/settings/risk-profile`), Settings, **Advanced Tools** (Trade Setups, Discover, Charts, Backtest, Alerts), plus User Guide (`/guide`) and Strategy Reference (`/help`). Admin items appended for admins.
- **Mobile bottom nav** (`client/src/components/mobile-bottom-nav.tsx`): Home/Grow/Income/Trade/More.
- **Authenticated home** (`client/src/pages/home-dashboard.tsx`): hero prompt → `QuickPromptBar` (intent-based routing) → status pills → `NewHereBadge` → 4 action cards → `AiSnapshotPanel` (`GET /api/home/snapshot`) → `PopularChips` → `ComplianceFooter`.
- **Public landing** (`client/src/pages/home.tsx`): hero (CTA "Start 14-Day Trial"), trust badges (Stocks+Options · Daily AI Ideas · 14-Day Analysis Trial · Broker-Connected Data · InstaTrade™), problem/benefits/features, single-plan pricing, FAQ (8 spec Q&As), final CTA.
- **Compliance**: full §12 disclaimer in `client/src/components/footer.tsx` (global) and `ComplianceFooter` in `trading-shell.tsx` (in-app).

## User Guide
`/guide` (`client/src/pages/user-guide.tsx`) — 16 sections with sticky sidebar TOC + live search. Reusable `<HelpLink section="..." />` (`client/src/components/help-link.tsx`) renders a `?` icon next to titles on Grow, Income, Trade, Markets, Opportunity Radar, InstaTrade, and Settings, deep-linking into the matching guide section. Routes: `/guide`, `/guide/:section`. The older technical strategy doc remains at `/help`.

## Email Service (Resend) & Support Center
Outbound email from `team@vcptrader.com` via Resend (`server/services/email/`): sendEmail core (suppression check w/ essential bypass, header-injection guard, logs to `email_messages`) + helper senders (welcome on registration, verification, password reset, billing, support ack/reply). Inbound: `POST /api/webhooks/resend` in `server/index.ts` (svix-verified raw body, per-IP rate limit, idempotent via `email_events`) → `inbound-email-service.ts` threads into `support_tickets` (VCP-YYYY-NNNNNN, 4-step deterministic matching), forwards to `support@sunfishtrading.com` with `X-VCP-Forwarded` loop protection, single ack per new ticket. Bounces/complaints → `email_suppressions`. Admin Support Center at `/admin/support` (`client/src/pages/admin-support.tsx`, API `server/routes/support-admin.ts` gated isAuthenticated+isAdmin): tickets/replies/notes, failed deliveries, suppressions, settings (`email_settings` singleton), health panel. Campaigns (`server/email-service.ts`) prefer Resend over SendGrid. Tables: `email_messages`, `email_events`, `support_tickets`, `support_messages`, `email_suppressions`, `email_settings`. Env: `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `EMAIL_FROM_ADDRESS/NAME`, `EMAIL_REPLY_TO`, `EMAIL_FORWARD_ADDRESS`, `ADMIN_SUPPORT_NOTIFICATION_EMAIL`. Tests: `npx vitest run --root . server/services/email/email-utils.test.ts`.

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

## Twelve Data Historical Daily Market Data (prelaunch)
Provider-neutral daily OHLCV ingestion via Twelve Data `/time_series` (Basic plan; safety caps 7/min, 750/day below provider limits). Services in `server/services/daily-market-data/` (config, twelve-data-client, credit-manager, ingestion, indicators, validation, access-control). License modes enforced by env only: `TWELVE_DATA_LICENSE_MODE` (disabled/prelaunch/external) + `TWELVE_DATA_EXTERNAL_DISPLAY_ENABLED`; DB `market_data_license_config` row is a descriptive record and can never override env. **Currently in prelaunch** — Twelve Data-backed analysis is visible only to admins/internal roles/`TWELVE_DATA_INTERNAL_TEST_EMAILS` allowlist; Stripe trial does NOT grant access; external users get a safe denial (403, no data). Credit reservation is transactional (row locks) in `market_data_credit_usage`; ingestion runs use pg advisory lock 774412001; daily cron 7:15 PM ET weekdays with NYSE-holiday-aware `isExpectedTradingDay`. Tables: `market_data_symbols` (seeded 20), `market_daily_bars` (numeric, dataVersion), `market_data_ingestion_runs/items`, `daily_indicators`, `daily_analysis_snapshots`, `market_data_credit_usage`, `market_data_request_log`. Routes: `server/routes/market-data-admin.ts` (admin: status/test/seed/backfill/ingest-daily/pause/runs/symbols/license/bars) and `server/routes/daily-analysis.ts` (gated: access probe, opportunities, symbol detail, conditions, history, symbols). Frontend: `/admin/market-data` page, gated `/daily-analysis` page, home `DailyOpportunities` section (hidden on 403), `DataAttribution` component. Requires `TWELVE_DATA_API_KEY` secret. No frontend provider calls, no WebSockets.

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
- `/market-intel`: Morning Briefing, Why It's Moving, Watchlist Impact, Top Catalysts. (Congress Activity removed from all customer-facing lists per user request, July 2026.)
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
