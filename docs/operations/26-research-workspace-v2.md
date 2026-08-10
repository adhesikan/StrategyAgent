# Operations Manual — Research Workspace v2 (Sprint 2.6.4)

## Purpose

Canonical cross-platform AI research environment that accepts context from every surface in the platform (opportunity workspace, collections, theme/sector pages, monitor, reports, portfolio intelligence, and the command center) and routes it into the correct AI conversation mode with full evidence sidebar, comparison matrix, and challenge thesis workflows.

---

## Architecture

### Components

| Component | Location | Notes |
|-----------|----------|-------|
| Client page | `client/src/pages/research-workspace.tsx` | ~1100 lines; context-aware entry |
| Shared helpers | `shared/research-workspace-helpers.ts` | Pure URL parsing functions; testable |
| Shared types v2 | `shared/research-workspace-types.ts` | ResearchContext, WorkspaceAction, ACTION_QUESTIONS |
| Server service | `server/services/research-workspace-service.ts` | assembleCanonicalContext, telemetry |
| Server routes | `server/routes/research-workspace.ts` | Context endpoint + ask endpoint |
| Schema migration | `migrations/026_research_workspace_context.sql` | 5 nullable columns |

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/research-workspace/context` | Canonical ResearchContext assembly |
| POST | `/api/research/ask` | AI research (accepts researchContext metadata) |
| GET | `/api/research/conversations` | List user conversations |
| GET | `/api/research/conversations/:id` | Get conversation with messages |
| DELETE | `/api/research/conversations/:id` | Delete conversation |
| PATCH | `/api/research/conversations/:id/pin` | Pin/unpin |
| GET | `/api/research/templates` | 12 prompt templates |

---

## Context Entry Contract

### URL Scheme

All context entry points use standard query parameters:

```
/research-workspace?mode=company&symbol=NVDA                     → company research
/research-workspace?mode=company&symbol=NVDA&action=challenge     → challenge thesis prefilled
/research-workspace?mode=comparison&symbols=NVDA,AMD              → comparison mode v2
/research-workspace?mode=theme&themeId=ai-infrastructure          → theme context
/research-workspace?mode=sector&sector=Technology                 → sector context
/research-workspace?mode=collection&collectionId=...              → collection context
/research-workspace?mode=market                                    → market overview
/research-workspace?conversation=UUID                             → resume saved conversation
/research-workspace?symbol=NVDA&sourceRoute=/opportunities/NVDA   → back-link preserved
```

### Action Param Mapping

Action params from the Opportunity Workspace:

| `action` value | Maps to `mode` | Prefills question |
|----------------|----------------|-------------------|
| `explain_concept` | `company` | "Explain why {SYMBOL} qualified…" |
| `challenge` | `company` | "Challenge the investment thesis for {SYMBOL}…" |
| `explain_change` | `opportunity` | "Explain what changed for {SYMBOL}…" |
| `risk` | `company` | "Explain the risk factors for {SYMBOL}…" |
| `institutional` | `institutional` | "Explain institutional positioning for {SYMBOL}…" |
| `compare` | `comparison` | "Compare {SYMBOL} with similar candidates…" |

**CRITICAL**: The `action` param must always be paired with a valid `mode` param. Never use `mode=explain_concept` — that is not a valid ResearchMode and will be silently ignored.

---

## Schema Migration

Run before deploying Sprint 2.6.4 to production:

```sql
-- migrations/026_research_workspace_context.sql
ALTER TABLE workspace_conversations
  ADD COLUMN IF NOT EXISTS context_type    TEXT,
  ADD COLUMN IF NOT EXISTS context_label   TEXT,
  ADD COLUMN IF NOT EXISTS primary_symbol  VARCHAR,
  ADD COLUMN IF NOT EXISTS comparison_symbols TEXT[],
  ADD COLUMN IF NOT EXISTS source_route    VARCHAR;
```

All columns are nullable — backward compatible with existing conversations.

---

## Context Types

13 supported context types in `ResearchContextType`:

- `market` — market overview (default)
- `opportunity` — specific ranked opportunity
- `company` — company deep-dive
- `theme` — investment theme
- `sector` — market sector
- `institutional` — 13F institutional analysis
- `collection` — named collection
- `comparison` — 2–5 symbol comparison
- `monitor` — research monitor watch
- `report` — saved research report
- `portfolio` — portfolio intelligence
- `portfolio_holding` — individual holding
- `custom` — free-form

---

## Features (v2)

### Context Banner
When navigating from another page with a `symbol`, `themeId`, `sector`, `collectionId`, or `portfolioId` param, the workspace shows a context banner:
- "Researching: NVDA" for symbol context
- "Comparing: NVDA vs AMD" for comparison context  
- "Theme: AI Infrastructure" for theme context
- Includes a "Back" link if `sourceRoute` is provided

### Evidence Sidebar
Desktop-only right panel (toggle with sidebar icon in top bar). Shows:
- Current context label
- Top 8 evidence items from the last AI response
- Risk factors from the evidence panel

### Comparison Mode v2
When `mode=comparison` and 2+ tickers are pinned:
- Shows a comparison matrix below each AI response
- Matrix rows: Research Score, Technical Score, Institutional Score, Risk Level, Themes
- Each symbol links to its Opportunity Workspace

### Challenge Thesis Workflow
First-class template ("Challenge This Investment Thesis") + action param (`action=challenge`). Prefills a full bear-case question. Covered by all 6 OW action buttons.

### Follow-up Actions
All 4 action types handled:
- `ask` → prefills question and changes mode/scope
- `navigate` → routes to destination
- `set_scope` → changes scope dropdown
- `relax_filter` → applies `suggestedScope` or falls back to `entire_market`

### Conversation Persistence (v2)
Conversations persist `contextType`, `contextLabel`, `primarySymbol`, `comparisonSymbols`, `sourceRoute` — enables sidebar to show richer history labels.

### Source Attribution
Every AI response shows a colored indicator:
- 🟢 AI-generated analysis (OpenAI gpt-4o-mini)
- 🟡 Deterministic fallback analysis (rule_based)

### Template Library (v2)
12 templates total — 3 new in this sprint:
- "Challenge This Investment Thesis" (challenge thesis)
- "Explain What Changed" (change intelligence)
- "Explain Risk Profile" (risk factors)

---

## Handoff Surfaces

### Opportunity Workspace → Research Workspace
`client/src/pages/opportunity-workspace.tsx` — `AIResearchSection` component:

```typescript
// Sprint 2.6.4: correct URL scheme
navigate(`/research-workspace?symbol=${symbol}&mode=company&action=challenge&sourceRoute=/opportunities/${symbol}`)
```

All 6 action buttons use `mode=<valid_mode>&action=<action_name>`.

---

## Platform Health

The workspace health card in `/admin/platform-health` shows:
- `conversationCount` — total saved conversations
- `pinnedConversations` — pinned conversations
- `contextAssemblyOk` — opportunity intelligence available
- `openAiConfigured` — OpenAI key present
- `contextRequests` / `contextRequestsOk` — context endpoint calls (resets on restart)
- `askRequests` / `askRequestsOk` — ask endpoint calls (resets on restart)
- `fallbackCount` — times rule-based fallback was used
- `partialContextCount` — contexts assembled with limitations
- `averageAIResponseMs` — rolling average AI latency

---

## Routing Regression Rule (Definition of Done)

**Every new static route must be registered BEFORE any dynamic `:param` route in the same prefix.**

Applies to both:
- Server: Express route registration order
- Client: Wouter `<Route>` declaration order in App.tsx

This rule was documented after the `/opportunities/today` collision incident (Sprint 2.6.3).

---

## Compliance

Never use: "recommendation", "buy", "sell", "target price" in any text returned by the AI, in system prompts, in template prompts, or in rule-based fallback responses.

Use instead: "research candidate", "qualified opportunity", "evidence", "research score".

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Context banner not showing | URL params not parsed (`paramsApplied` guard) | Clear browser cache; check URL has correct params |
| Mode unchanged after navigation | `mode` param has non-valid value | Ensure mode is one of the 8 valid ResearchMode values |
| Action question not prefilled | `symbol` param missing with `action` | Both `symbol` and `action` must be present |
| Evidence sidebar empty | No AI response yet | Make a research request first |
| Comparison matrix not showing | Mode is not `comparison` OR < 2 tickers | Set mode=comparison and add 2+ tickers |
| Rule-based fallback response | OpenAI key not set or API error | Check `OPENAI_API_KEY` env var |
| `relax_filter` action does nothing | Missing `suggestedScope` | Falls back to `entire_market` |
| New conversation columns null | Migration not run | Run `migrations/026_research_workspace_context.sql` |

---

## UAT Checklist

1. Navigate to `/research-workspace` — empty state shows 6 template buttons
2. Select mode "Company" — description updates
3. Type a question, press ⌘↵ — response appears with evidence panel toggle
4. Open evidence panel — shows supporting/technical/institutional evidence with source labels
5. Click "Show Evidence Sidebar" (desktop) — right panel appears with top evidence
6. Click "Challenge This Thesis" template with NVDA pinned — question prefills
7. Navigate from OW via "Challenge This Thesis" button — context banner shows "Researching: NVDA"
8. Navigate from OW with `?mode=comparison&symbols=NVDA,AMD` — comparison matrix appears
9. Click a `relax_filter` follow-up — scope dropdown changes
10. Click "Open AI Research" from OW — `action=explain_concept` prefills question
11. Pin a conversation — appears in Pinned section
12. Delete a conversation — removed from list
13. Load `/research-workspace?conversation=UUID` — conversation history restored
14. Load `/research-workspace?themeId=ai-infrastructure&mode=theme` — context banner: "Theme: ai-infrastructure"
15. Source attribution indicator visible on every response (green=AI, yellow=fallback)
