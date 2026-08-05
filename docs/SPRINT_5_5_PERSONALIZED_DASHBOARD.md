# Sprint 5.5 — Personalized Morning Dashboard

## 1. Route Behavior

| Path | Authenticated | Unauthenticated |
|------|--------------|-----------------|
| `/dashboard` | Renders the Morning Dashboard | Redirects to `/auth` (AuthPage) |
| `/` | Redirects to `/dashboard` (unless user pinned a custom landing page) | Renders public marketing homepage |
| `/home` | Renders AI Command Center (preserved for deep links and pinned preferences) | Redirects to `/auth` |
| `/command-center` | Renders AI Command Center (preserved) | Redirects to `/auth` |

**Post-login redirect:** `DefaultLanding` checks `/api/user/settings` for `defaultLandingPage`. If unset or pointing to a recognized page, users land on `/dashboard`. Custom pinned pages (e.g. `/scanner`) are preserved.

## 2. Dashboard Architecture

The dashboard uses a single backend orchestration endpoint `GET /api/dashboard` that fans out in parallel using `Promise.allSettled` to six internal data sources. The client fetches this endpoint via React Query (`queryKey: ["/api/dashboard"]`), refetching every 5 minutes with a 60-second stale time.

**Client layer** (`client/src/pages/dashboard.tsx`):
- Ten independent section components, each accepting props derived from the single `DashboardResponse`
- Section-level `SectionError` component with Retry button (fires `dashboard_section_retry` analytics)
- Loading skeletons via `DashboardSkeleton` while the initial query is pending
- Top-level error card when the entire orchestration call fails

## 3. Reused APIs

| Endpoint | Section(s) |
|----------|-----------|
| `GET /api/dashboard` (new orchestration) | All sections |
| `buildHomeSnapshot(userId)` (extracted from `home-snapshot.ts`) | Market Snapshot, Growth & Income, Market Events |
| `generateCandidateScenarios(userId, filters)` | Today's Opportunities |
| `storage.getBrokerConnection(userId)` | Portfolio Intelligence |
| `getBrokerPositions(userId)` | Portfolio Intelligence |
| `ResearchRecordService.listForUser(userId, { limit: 5 })` | Saved Research |
| `storage.getWatchlists(userId)` | Watchlist Activity |

The `/api/home/snapshot` route was refactored to call the extracted `buildHomeSnapshot()` function — no duplicate logic.

## 4. Section Contracts

### 4.1 Morning Header
- Source: `useAuth()` user object (`firstName`), `getMarketSessionInfo()` from `@shared/market-session`, `new Date()`
- Displays: greeting, first name (if available), full date, market session label + color indicator
- No hardcoded market status — always derived from ET time logic

### 4.2 Quick Actions
- Seven goal-oriented buttons: Find Growth, Find Income, Find Trade Setups, Analyze a Stock, Review My Portfolio, Continue Saved Research, Understand Markets
- Each routes to an existing product mode or pre-fills an Ask AI prompt via `?q=` URL param
- None submit trades or create orders
- Fires `dashboard_quick_action_clicked` with `{ action }` — no symbols, prompts, or account data

### 4.3 Market Snapshot
- Source: `dashboard.marketSnapshot` (from `buildHomeSnapshot`)
- Displays: market tone badge, tone reason, index tiles (SPY/QQQ/IWM), top movers, data-mode badge (live/delayed), timestamp
- Missing field fallback: "Data currently unavailable" — never a fabricated value
- `status: "unavailable"` → `SectionError` with retry

### 4.4 Today's Opportunities
- Source: `dashboard.opportunities` (from `generateCandidateScenarios`)
- Backend ranking order is preserved — no client-side resorting, no GPT reordering
- Bounded to 3–5 candidates
- Each card shows: symbol, company name, strategy type, bias, grade badge, main reason, Open Analysis CTA
- Empty state: deterministic message + Open Scanner button
- No demonstration cards (no preview data in authenticated dashboard)

### 4.5 Portfolio Intelligence
- Source: `dashboard.portfolio` (broker connection + positions)
- `brokerConnected: false` → compact Connect Broker prompt (fires `dashboard_connect_broker_clicked`)
- `brokerConnected: true, status: "ok"` → neutral observations (position count, unrealized P/L, largest concentration note)
- Never shows account numbers, broker identifiers, or buy/sell directions
- Explicit compliance disclaimer at the bottom of the section

### 4.6 Watchlist Activity
- Source: `dashboard.watchlists`
- Existing watchlists → bounded list with symbol counts and Scan CTA per watchlist
- No watchlists → polished Create Watchlist empty state (routes to `/scanner`)
- Does not claim "since yesterday" — no historical change-state data exists

### 4.7 Growth & Income
- Source: `dashboard.marketSnapshot.data.topGrowth` / `bestIncome`
- Clearly labeled with data-mode badge (live context vs. reference context)
- Income section carries an "Estimated structure" badge when data mode is not live — users are never shown estimated contracts as executable
- CTAs route to Ask AI prompts, not to order placement

### 4.8 Saved Research
- Source: `dashboard.savedResearch` — 5 most recent non-archived records
- Shows: title, symbol, verdict (from stored record label — no raw enums), date
- Open Research CTA → `/research/:id`; Open Journal CTA deferred to the detail page
- Empty state: descriptive message + "Start Research" button → `/ask`

### 4.9 Market Events
- Source: `dashboard.marketSnapshot.data.topNews`
- Empty when no news items available — section hidden (not errored)
- Every item shows: impact badge, symbol, why-it-matters text, Ask AI shortcut
- No invented events — renders only what the news-sentiment storage returns

### 4.10 Ask AI Panel
- Six suggested prompts rendered as buttons → route to `/ask?q=<prompt>`
- "Open Ask AI" button → `/ask`
- Does not add a second chat implementation

## 5. Failure Isolation

```
market snapshot unavailable  →  opportunities, portfolio, research, ask AI all render
portfolio unavailable        →  market snapshot, research, ask AI all render
ranking unavailable          →  market context, portfolio, research all render
saved research failure       →  ask AI, market snapshot, opportunities all render
total data unavailability    →  top-level error card; individual features remain via nav
```

Each section:
- Shows a truthful `SectionError` component (not a GPT-generated guess)
- Provides a Retry button that fires `dashboard_section_retry` analytics and calls `dashboardQuery.refetch()`
- Never propagates its failure to adjacent sections

## 6. Personalization Boundary

Personalized data:
- User's first name (from `useAuth()`)
- Broker connection state
- Portfolio positions (neutral observation only — no account IDs)
- Saved research records (user-owned data)
- Watchlists (user-owned data)

**Not personalized:**
- Risk profile (not inferred)
- Age, income, investment horizon, or suitability
- GPT-generated permanent user profile

## 7. Broker-Connected and Disconnected Behavior

**Connected:**
- Market Snapshot may show live index quotes (broker data) instead of Twelve Data reference
- Portfolio section shows position count, unrealized P/L, largest concentration note
- Top movers derived from watchlist symbols via broker quotes

**Disconnected:**
- Portfolio section shows compact Connect Broker prompt
- Market Snapshot falls back to Twelve Data reference quotes or simulated fallback
- All other sections continue to render normally

## 8. Analytics

Events are fired via `track()` from `client/src/lib/analytics.ts`. No symbols, account values, position details, prompts, tokens, or MCP payloads are included in props.

| Event | Fires when | Props |
|-------|-----------|-------|
| `dashboard_viewed` | Dashboard mounts | (none) |
| `dashboard_quick_action_clicked` | Quick Action button clicked | `{ action: string }` |
| `dashboard_opportunity_opened` | Open Analysis clicked | `{ symbol, grade }` |
| `dashboard_research_opened` | Research record opened | (none) |
| `dashboard_section_retry` | Section Retry clicked | `{ section: string }` |
| `dashboard_connect_broker_clicked` | Connect Broker prompt clicked | (none) |

## 9. Accessibility

- All sections have `aria-labelledby` pointing to their heading
- All icon-only elements have `aria-hidden="true"` 
- Interactive elements have `aria-label` descriptions
- Opportunity cards use `role="article"` with `aria-label`
- List containers use `role="list"` / `role="listitem"` where appropriate
- Loading skeleton has `aria-busy="true"` and `aria-label`
- Retry buttons have explicit `aria-label`
- Color is never the only indicator of meaning (badges always include text)
- Focus-visible ring on all keyboard-interactive elements

## 10. Known Limitations

- **Watchlist status changes** (newly qualified / no longer qualifying) are not implemented. The section shows the watchlist names and symbol counts only — no historical change-state data exists. This is by design per §9 of the spec.
- **Market calendar** (earnings this week, economic events, Fed events) is not implemented. `topNews` from the news-sentiment layer is used instead. A dedicated earnings/events calendar endpoint does not exist.
- **Sector strength and breadth** are not in the snapshot payload. The spec mentions them as examples but no existing endpoint provides them.
- **Concierge summary** ("AI Market Summary" from command-center.tsx) is not included — it requires a dedicated backend summary endpoint that does not exist per the existing code boundary comment.

## 11. Deferred Work

- **Watchlists — change-state tracking**: Requires a `previousState` snapshot stored server-side to derive "newly qualified" / "no longer qualifying" status.
- **Daily Intelligence brief**: A cached AI-generated morning brief needs a dedicated `/api/home/ai-brief` endpoint built from stored scan results.
- **Market calendar**: A dedicated earnings-this-week + economic-events endpoint.
- **Sector ETF tiles**: Sector strength via SPDRs (XLK, XLE, XLF, etc.) requires a separate quote batch.
- **"Pin Dashboard" option**: `/dashboard` should be added to `LANDING_PAGE_OPTIONS` in the UI's Set Default Page flow (it is already in the schema).
