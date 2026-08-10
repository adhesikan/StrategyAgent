# 27 — Research Goals & Planning

**Sprint:** 2.6.5  
**Status:** Active  
**Last Updated:** 2026-08-10

---

## Overview

Research Goals let traders tell VCP Trader AI what they want to focus their research on — themes, sectors, opportunity types, and research horizon — without any financial questionnaire, suitability assessment, or portfolio-personal data.

Goals affect:
- **Research Workspace** — context entry pre-filled with goal filters
- **Opportunity Discovery** — candidates matched against goal filters
- **Dashboard** — primary goal surfaces relevant candidates
- **Research Monitor** — goal-scoped monitoring
- **Reports** — goal-focused report generation

---

## Architecture

### Database Tables

**`research_goals`** (migration `027_research_goals.sql`)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `user_id` | TEXT NOT NULL | |
| `name` | TEXT NOT NULL | Max 120 chars |
| `goal_type` | TEXT NOT NULL | See GoalType enum (12 values) |
| `description` | TEXT | Optional |
| `horizon` | TEXT NOT NULL | long_term / multi_year / short_term / adaptive |
| `research_style` | TEXT NOT NULL | growth, balanced, institutional_activity, etc. |
| `focus_areas` | JSONB | Array of strings |
| `preferred_sectors` | JSONB | Array of strings |
| `preferred_themes` | JSONB | Array of strings |
| `preferred_opportunity_types` | JSONB | Array of strings |
| `volatility_preference` | TEXT | lower / balanced / higher_accepted |
| `options_interest` | BOOLEAN | Includes options-income research |
| `monitoring_enabled` | BOOLEAN | Links to Research Monitor |
| `is_primary` | BOOLEAN | One per user enforced in service layer |
| `status` | TEXT | active / paused / archived |

Indexes: `idx_research_goals_user_id`, `idx_research_goals_user_primary`, `idx_research_goals_type`

---

## API Endpoints

All endpoints require authentication (`isAuthenticated`).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/research-goals` | List all goals for current user |
| `POST` | `/api/research-goals` | Create a new research goal |
| `GET` | `/api/research-goals/primary` | Get primary goal (or 404) |
| `GET` | `/api/research-goals/health` | Platform health metrics (admin) |
| `GET` | `/api/research-goals/metadata` | Vocabulary: types, horizons, styles |
| `GET` | `/api/research-goals/:id` | Get single goal (ownership enforced) |
| `PATCH` | `/api/research-goals/:id` | Update goal fields |
| `DELETE` | `/api/research-goals/:id` | Archive goal (soft delete) |
| `POST` | `/api/research-goals/:id/primary` | Set as primary (unsets previous) |
| `GET` | `/api/research-goals/:id/matches` | Match goal against current opportunity snapshot |
| `GET` | `/api/research-goals/:id/activity` | Goal activity summary |
| `GET` | `/api/research-goals/:id/context` | Goal context for Research Workspace |
| `GET` | `/api/research-goals/:id/plan` | Deterministic research plan |

**Route ordering note:** Static routes (`/primary`, `/health`, `/metadata`) are registered BEFORE the dynamic `/:id` route to prevent Wouter/Express from matching "primary" as an ID.

---

## Goal Types (12)

| Value | Label |
|-------|-------|
| `long_term_growth` | Long-Term Growth Research |
| `income` | Income Research |
| `ai_infrastructure` | AI Infrastructure Research |
| `semiconductors` | Semiconductor Research |
| `lower_volatility` | Lower-Volatility Research |
| `dividend_income` | Dividend Income Research |
| `options_income` | Options-Income Research |
| `long_term_compounding` | Long-Term Compounding Research |
| `watchlist_monitoring` | Watchlist Monitoring |
| `market_regime` | Market Regime Research |
| `sector_rotation` | Sector Rotation Research |
| `custom` | Custom Research Goal |

---

## Matching Logic

Matching is **deterministic** — computed from the current opportunity intelligence snapshot, never from AI inference.

### Match States (categorical)

| State | Label |
|-------|-------|
| `strong_match` | Strong Research Match |
| `match` | Research Match |
| `partial_match` | Partial Research Match |
| `outside_filters` | Outside Current Filters |

### No Suitability Score

`matchOpportunityToGoal()` returns a categorical `matchState` only. There is **no numeric suitability score** exposed to the client or AI. This is enforced by design.

### Match Scoring Logic (internal, not exposed)

Internal points system (not surfaced):
- Theme alignment: +3 per matched theme
- Sector alignment: +2
- Opportunity type alignment: +2  
- Horizon alignment: +1
- Volatility compatibility: +1
- Options interest: +1

Thresholds: ≥5 = `strong_match`, ≥2 = `match`, ≥1 = `partial_match`, 0 = `outside_filters`

### Cache

Match results are cached per `userId:goalId:opportunitySnapshotId` (5-minute TTL). Cache is invalidated on goal update or delete. Cache is never shared across users.

---

## Compliance Rules

1. **No suitability assessment** — Goals are research filters, not financial questionnaires.
2. **No recommendation language** — `matchState` labels never say "recommended for you".
3. **No financial data fields** — No income, net worth, age, tax bracket, or employment.
4. **No automated buy/sell** — Goal matches never trigger orders.
5. **Volatility disclaimer** — Volatility preference is not a risk tolerance assessment.
6. **Privacy disclosure** — User goal preferences are stored only to power research features; they are never shared with third parties or used for advertising.

The compliance disclaimer on all goal-facing surfaces:
> "Research goals are personal research filters, not a suitability assessment or investment recommendation. Matching candidates to a goal does not mean those candidates are appropriate for your situation."

---

## Primary Goal

- One primary goal per user (enforced in the service layer, not a DB constraint).
- Setting a new primary goal automatically unsets the previous one.
- Primary goal drives the dashboard "Research For Your Goals" section.
- If no primary goal is set, those surfaces fall back gracefully.

---

## Client Pages

| Route | Component | Notes |
|-------|-----------|-------|
| `/goals` | `GoalsPage` | First-time experience + list view + inline wizard |
| `/goals/new` | `GoalsPage` (static) | Redirects to wizard within GoalsPage |
| `/goals/:id` | `GoalDetailPage` | Matches, Activity, Plan tabs |

Route ordering in App.tsx: `/goals/new` → `/goals/:id` → `/goals` (static before dynamic).

---

## Shared Types

`shared/research-goal-types.ts` exports:
- `GoalType` union (12 values) + `GOAL_TYPES` array + label/description maps
- `ResearchHorizon` union + labels/descriptions + `HORIZON_TO_TIME_HORIZON_MAP`
- `ResearchStyle` union + labels/descriptions
- `VolatilityPreference` union + labels/descriptions
- `GoalMatchResult`, `GoalMatchSummary`, `GoalActivitySummary`, `ResearchPlan`
- Compliance constants: `GOAL_COMPLIANCE_DISCLAIMER`, `GOAL_PRIVACY_DISCLOSURE`, `GOAL_MATCH_DISCLAIMER`, `VOLATILITY_DISCLAIMER`
- `TradePlanningContextShape` — documented only (Phase 2.7)

---

## Research Workspace Integration

When `?goalId=<id>` is present in the Research Workspace URL:
- `assembleCanonicalContext` called with `contextType: "goal"`
- Goal filters pre-applied to opportunity search
- Goal name surfaced in context banner
- Match explanations available in evidence sidebar

---

## Platform Health

`GET /api/research-goals/health` returns:
```json
{
  "activeGoals": 0,
  "usersWithGoals": 0,
  "primaryGoalSetRate": 0,
  "status": "operational"
}
```

This endpoint is integrated into the Platform Health dashboard.

---

## Operations — Runbook

### Check goal counts
```sql
SELECT status, COUNT(*) FROM research_goals GROUP BY status;
SELECT COUNT(DISTINCT user_id) FROM research_goals WHERE status = 'active';
SELECT COUNT(*) FROM research_goals WHERE is_primary = true AND status = 'active';
```

### Check for orphaned goals (user deleted)
```sql
SELECT COUNT(*) FROM research_goals 
WHERE user_id NOT IN (SELECT id FROM users);
```

### Soft-delete all goals for a user
```sql
UPDATE research_goals SET status = 'archived', updated_at = NOW() WHERE user_id = '<userId>';
```

### Cache reset
Match caches are in-memory (TTL 5 min). They reset on server restart.

---

## Known Limitations

- Goal activity summary is computed from the current opportunity snapshot; it does not track historical changes over time (planned for future sprint).
- Research Plan is deterministic and does not use GPT; all actions are pre-computed from goal filters.
- `TradePlanningContextShape` (Phase 2.7 handoff to trade execution) is documented only — not yet implemented.

---

## See Also

- `26-research-workspace-v2.md` — Research Workspace context entry
- `22-research-collections.md` — Research Collections
- `24-research-monitor.md` — Research Monitor
- `19-opportunity-intelligence-engine.md` — Opportunity Intelligence
