# 19 — Research Monitor & Daily Intelligence Feed

Sprint: 2.5.4 — Continuous Research Monitoring & Daily Intelligence Feed

---

## Overview

The Research Monitor provides **continuous, deterministic tracking** of research intelligence changes across companies, themes, sectors, and market categories.

Users define what they want monitored ("watches"). The platform detects changes using **existing precomputed intelligence** — no recomputation, no LLM invocation, no market data fetches.

---

## Design Principles

1. **No recomputation.** All data comes from existing precomputed stores: `getLatestRanking()`, `getLatestThemeSnapshots()`, `getLatestSectorSnapshots()`, `getCanonicalOpportunity()`, `getOpportunityIntelligence()`.
2. **No LLM.** The change engine is entirely deterministic.
3. **No alerts, no notifications.** Sprint 2.5.4 is monitoring only. Email/push/Slack/webhook are future roadmap items.
4. **Compliance.** All terminology uses neutral observation language: "Research Update", "Research Change", "Qualified Candidate", "Observed Change". Never "recommend", "advise", "predict", "guarantee".

---

## Architecture

```
User creates watch (WatchType, entityId)
        ↓
evaluateWatch() → reads precomputed store → detects change
        ↓
watch_activity_log (INSERT one row per evaluation)
        ↓
research_watches (UPDATE last_evaluated_at, last_change_*)
        ↓
getDailyFeed() → aggregates all precomputed changes → FeedSection[]
        ↓
buildMyWatchChangesSection() → filters to user's watches → CommandCenter
```

---

## Database Schema

### research_watches

| Column | Type | Notes |
|--------|------|-------|
| `id` | VARCHAR PK | `gen_random_uuid()` |
| `user_id` | VARCHAR | Required |
| `name` | TEXT | User-visible label, max 100 chars |
| `watch_type` | TEXT | WatchType enum |
| `entity_id` | TEXT | Symbol / themeId / sector / collectionId (null for market-wide) |
| `entity_label` | TEXT | Human-readable entity label |
| `status` | TEXT | `active` \| `paused` \| `archived` |
| `last_evaluated_at` | TIMESTAMP | When last evaluated |
| `last_change_at` | TIMESTAMP | When last meaningful change detected |
| `last_change_type` | TEXT | WatchActivityType of most recent change |
| `last_change_summary` | TEXT | Human-readable change summary |
| `notify_email` | BOOLEAN | Future use (always false in Sprint 2.5.4) |
| `notify_push` | BOOLEAN | Future use (always false in Sprint 2.5.4) |
| `created_at` | TIMESTAMP | |
| `updated_at` | TIMESTAMP | |

**Indexes:** `idx_rw_user_id`, `idx_rw_status(user_id, status)`, `idx_rw_watch_type(user_id, watch_type)`

### watch_activity_log

| Column | Type | Notes |
|--------|------|-------|
| `id` | VARCHAR PK | `gen_random_uuid()` |
| `watch_id` | VARCHAR | FK → research_watches.id |
| `user_id` | VARCHAR | Denormalized for query efficiency |
| `activity_type` | TEXT | WatchActivityType |
| `entity_symbol` | TEXT | Symbol (null for market-wide) |
| `entity_label` | TEXT | Human-readable label |
| `change_direction` | TEXT | ChangeDirection enum |
| `change_data` | JSONB | `{ from?, to?, delta?, score?, memberCount?, regime?, summary }` |
| `observed_at` | TIMESTAMP | |

**Indexes:** `idx_wal_watch_id`, `idx_wal_user_id`, `idx_wal_observed_at(watch_id, observed_at)`

**Retention:** Rows older than 90 days are eligible for cleanup (not yet automated).

---

## Watch Types

| WatchType | entityId | What's Monitored |
|-----------|----------|------------------|
| `company` | TICKER | Research score, confidence, qualification status |
| `theme` | themeId | Theme score, member count, leadership changes |
| `sector` | Sector name | Sector score, member count, strength changes |
| `collection` | Collection UUID | Symbol membership count |
| `opportunity_type` | type key | Count of candidates in that type |
| `market_regime` | null | Market regime string changes |
| `institutional_activity` | TICKER | Institutional score changes |
| `growth_candidates` | null | Count of growth-type candidates |
| `income_candidates` | null | Count of income-type candidates |
| `momentum` | null | Count of momentum-type candidates |
| `etf_candidates` | null | Count of ETF candidates |
| `dividend_candidates` | null | Count of dividend/covered-call candidates |
| `custom_collection` | null | Reserved for future use |

---

## Watch Activity Types

| ActivityType | Trigger |
|-------------|---------|
| `new_candidate` | Symbol first seen as qualified |
| `candidate_removed` | Symbol no longer qualified |
| `score_improved` | Research score improved ≥5 points |
| `score_weakened` | Research score declined ≥5 points |
| `confidence_changed` | Confidence level changed (high/medium/low) |
| `regime_change` | Market regime string changed |
| `theme_improved` | Theme score improved ≥5 points |
| `theme_weakened` | Theme score declined ≥5 points |
| `sector_improved` | Sector score improved ≥5 points |
| `sector_weakened` | Sector score declined ≥5 points |
| `collection_added` | Symbol added to collection |
| `collection_removed` | Symbol removed from collection |
| `institutional_accumulation` | Institutional score improved ≥8 points |
| `institutional_distribution` | Institutional score declined ≥8 points |
| `member_count_changed` | Candidate count changed |
| `status_unchanged` | Evaluated — no meaningful change (freshness record) |

---

## Change Detection Thresholds

| Signal | Threshold | Why |
|--------|-----------|-----|
| Research score change | ±5 points | Balance sensitivity vs noise |
| Institutional score change | ±8 points | Institutional data has more lag (13F delay) |
| Sector/theme score change | ±5 points | Match opportunity score threshold |
| Member count change | Any delta | Categorical change |
| Regime change | String ≠ | Regime string inequality |

**All thresholds are hard-coded constants. Do not change without updating this table.**

---

## Daily Research Feed

The feed is generated by `getDailyFeed(userId)` in `server/services/research-monitor-service.ts`.

**Sources used:**
1. `getLatestRanking()` → opportunity changes (new/upgraded/downgraded)
2. `getLatestThemeSnapshots()` → theme changes with `scoreDelta >= 3`
3. `getLatestSectorSnapshots()` → sector changes with `scoreDelta >= 3`
4. `listWatches(userId)` → personalized watch changes from last 24h

**Feed Sections (in order):**
1. New Qualified Candidates (if any)
2. Improved Research Scores (top 5)
3. Weakened Research Scores (top 5)
4. Market Regime (if ranking available)
5. Research Theme Changes (if scoreDelta ≥ 3)
6. Sector Changes (if scoreDelta ≥ 3)
7. My Watch Changes (if user has active watches with 24h changes)

**Feed is personalized** (`isPersonalized=true`) when user has active watches. Without watches, the feed shows market-wide intelligence changes only.

---

## API Routes

All routes require authentication (`isAuthenticated`).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/research-monitor/watches` | List user's active watches |
| POST | `/api/research-monitor/watches` | Create a new watch |
| GET | `/api/research-monitor/watches/:id` | Watch detail with activity + related candidates |
| PATCH | `/api/research-monitor/watches/:id` | Update name, status, notification flags |
| DELETE | `/api/research-monitor/watches/:id` | Archive watch (soft delete) |
| POST | `/api/research-monitor/watches/:id/evaluate` | Manually trigger evaluation |
| GET | `/api/research-monitor/feed` | Daily research feed |
| GET | `/api/research-monitor/health` | Monitoring health stats |

---

## Service Functions

All in `server/services/research-monitor-service.ts`:

| Function | Description |
|----------|-------------|
| `createWatch(userId, input)` | Create a new watch |
| `listWatches(userId, includeArchived?)` | List watches (excludes archived by default) |
| `getWatchById(watchId, userId)` | Single watch lookup |
| `updateWatch(watchId, userId, input)` | Update name/status/notification flags |
| `deleteWatch(watchId, userId)` | Soft-delete (archives) |
| `evaluateWatch(watchId, userId)` | Evaluate against precomputed stores |
| `getWatchDetail(watchId, userId)` | Full detail with activity + related candidates |
| `getDailyFeed(userId)` | Build daily intelligence feed |
| `buildMyWatchChangesSection(userId)` | Build command-center "My Watch Changes" section |
| `getResearchMonitoringHealth()` | Platform health stats |
| `ensureResearchMonitorTables()` | CREATE TABLE IF NOT EXISTS on startup |

---

## Startup Migration

`ensureResearchMonitorTables()` is called during `registerRoutes()` in `server/routes.ts`. It uses `CREATE TABLE IF NOT EXISTS` — safe to call multiple times.

If the tables already exist (production database), the call is a no-op.

---

## Command Center Integration

`myWatchChanges: MyWatchChangesSection` is added to `CommandCenterDailySnapshot`.

Built by `buildMyWatchChangesSection(userId)` — reads `research_watches` table and returns:
- `available: false` when user has no active watches
- `recentChanges[]` — up to 8 watch changes from active watches
- `lastEvaluatedAt` — most recent evaluation across all active watches
- `feedSummary` — one-line summary string

The section is included in the command center parallel fetch and degrades independently (errors caught, returns `available: false`).

---

## Platform Health

`researchMonitoring` health card is added to `buildPlatformHealth()`.

| Condition | Status |
|-----------|--------|
| No watches exist | UNKNOWN |
| Watches exist but none active | DISABLED |
| Active watches exist | HEALTHY |

Details include: `watchCount`, `activeWatchCount`, `evaluationsToday`, `lastEvaluatedAt`, `notificationChannels: "Not implemented"`.

---

## Client Page: /research-monitor

`client/src/pages/research-monitor.tsx`

**Sections:**
1. **My Research Watches** — cards with status, last change badge, evaluate/delete actions
2. **Daily Research Feed** — expandable section cards from `getDailyFeed()`
3. **Quick Links** — Dashboard, Intelligence, Research Hub, Command Center

**Modals:**
- Create Watch Modal — name, watchType selector, optional entityId field

**API queries:**
- `GET /api/research-monitor/watches` (30s stale)
- `GET /api/research-monitor/feed` (60s stale)

**Mutations:**
- `DELETE /api/research-monitor/watches/:id` — archive
- `POST /api/research-monitor/watches/:id/evaluate` — re-evaluate

---

## Future Roadmap (Do Not Implement Yet)

These are reserved for Sprint 2.6+ (Alerts & Notifications):

| Feature | Sprint |
|---------|--------|
| Email notifications | 2.6+ |
| Push notifications | 2.6+ |
| Slack webhook | 2.6+ |
| Microsoft Teams | 2.6+ |
| Custom webhook | 2.6+ |
| Watch scheduling (daily/hourly) | 2.6+ |
| Watch group filters | 2.6+ |
| Portfolio-aware watches | Portfolio Intelligence sprint |
| Watchlist integration | Watchlist sprint |

The `notifyEmail` and `notifyPush` columns in `research_watches` are reserved for this future work. `NotificationTarget` and `NotificationChannelStatus` interfaces in `shared/research-monitor-types.ts` define the intended future contract.

---

## Commercial Tiers (Documented Only — No Code Enforcement)

| Tier | Access |
|------|--------|
| Free | Limited watches (3), daily feed |
| Subscriber | Unlimited watches, advanced monitoring, historical changes, rich research history |
| Professional | Priority evaluation, firm-level watches |
| Enterprise / RIA | Organization watches, team shared monitors |

---

## Compliance Requirements

Every user-facing string must:
- Use "Research Update" not "Alert"
- Use "Observed Change" not "Signal"
- Use "Qualified Candidate" not "Strong Buy"
- Never say "recommend", "advise", "predict", "guarantee"
- Include disclaimers on all feed/watch creation UI

---

## Runbook

### Research watches not evaluating

1. Check `watch_activity_log` for recent entries: `SELECT * FROM watch_activity_log ORDER BY observed_at DESC LIMIT 20`
2. Check that precomputed stores have data: `GET /api/command-center/health` → verify `opportunityChangesAvailable`
3. Call `POST /api/research-monitor/watches/:id/evaluate` to manually trigger
4. Check server logs for `[research-monitor]` prefixed entries

### Feed shows no sections

1. Verify `getLatestRanking()` has data: `GET /api/admin/platform-health` → check `ranking.status`
2. Verify theme/sector snapshots exist: `SELECT COUNT(*) FROM theme_intelligence_snapshots`
3. If no precomputed data → opportunity engine has not yet run → MCP may be disabled

### Tables missing after deployment

Run startup migration manually:
```sql
-- Paste CREATE TABLE IF NOT EXISTS blocks from ensureResearchMonitorTables()
-- in server/services/research-monitor-service.ts
```

Or restart the server — `ensureResearchMonitorTables()` runs on every startup.

### Platform Health shows UNKNOWN

No watches have been created by any user. This is the expected state for a fresh deployment. Create a test watch to verify the system is functional.

---

## Admin Search Terms

- research monitor
- research watch
- daily feed
- watch activity
- watch evaluation
- continuous monitoring
- change detection
- my watch changes
- feed section
- WatchType
- research_watches
- watch_activity_log
