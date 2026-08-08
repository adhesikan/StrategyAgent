---
name: AI Research Workspace (Sprint 2.5.2)
description: 8-mode AI research environment consuming OppIntel + Collections + Sector/Theme Intelligence; evidence panels; saved conversations; 10 templates.
---

## Architecture

- `assembleResearchContext()` loads OppIntel (once) + sectors + themes in parallel; caps at 50 opportunities for prompt size
- `buildResearchSystemPrompt()` is mode-specific — 8 distinct rule sections
- `buildResearchUserMessage()` serializes context as JSON (not injected into system prompt)
- `parseAIWorkspaceResponse()` strips markdown fences before parsing; falls back to `buildRuleBasedWorkspaceResponse()` on parse error
- Conversations: `workspace_conversations` + `workspace_messages` (jsonb for AI responses)
- Conversations are created implicitly on first /api/research/ask (no separate create endpoint needed)

## Key files

- `shared/research-workspace-types.ts` — all types: ResearchMode, ContextScope, EvidencePanel, FollowUpAction, WorkspaceAIResponse, templates
- `server/services/research-workspace-service.ts` — assembleResearchContext, buildResearchSystemPrompt, buildResearchUserMessage, buildRuleBasedWorkspaceResponse, parseAIWorkspaceResponse, getWorkspaceHealth
- `server/routes/research-workspace.ts` — 7 routes under /api/research/
- `client/src/pages/research-workspace.tsx` — full workspace UI
- `server/routes/__tests__/research-workspace.test.ts` — 151 structural tests

## Wouter note (important for this project)

Wouter does NOT export `useNavigate` or `useSearchParams`. Use `useLocation()` for navigation and `useSearch()` for query params.

## Context scope filtering

`filterByScope()` maps scope keys to OppIntel filter criteria:
- Theme scopes → `themes.includes(theme)`
- Sector scopes → `sector === sectorName`
- Strategy scopes → `opportunityType in typeSet`
- Dynamic scopes (market-leaders, recently-improved, etc.) → sort + slice

## future_portfolio scope

Defined in types/client as a placeholder. Service explicitly skips it in filterByScope (no portfolio data wired). Tests verify: types contain "future_portfolio", service does NOT call getPortfolioPositions.

## Template IDs (10)

qualify-explain, compare-two, ai-infra-leaders, market-summary, institutional-explain, theme-leadership, sector-leadership, find-similar, recent-changes, challenge-thesis

## Compliance test pattern

Test checks absence of `>Buy<`, `>Sell<`, `>Target Price<`, `label="Buy"`, `label="Sell"` in client JSX (not comments or compliance notes).

## Platform health status rules

DEGRADED if: openAiConfigured=false OR contextAssemblyOk=false.
HEALTHY otherwise.
