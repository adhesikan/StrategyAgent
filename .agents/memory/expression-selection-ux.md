---
name: Expression Selection UX Contract
description: Explicit Explore CTA pattern for Trade Planning expression cards, pendingFamilyRef session-create flow, selectedBy invariant, and trade-plans.ts auth bug class.
---

## Rule
`ExpressionCard` must expose an explicit **Explore CTA button** (`onExplore` prop) for every non-unavailable expression family. Card-click alone (toggle via `onSelect`) is insufficient UX.

**Why:** Without a distinct button, traders have no visible affordance for initiating the equity planning flow (EquityPlanningPanel gated on `selectedFamily && sessionId`). The card-click was invisible as an interaction — detected only after Railway UAT.

## pendingFamilyRef — No-Session Explore Flow
When Explore is clicked and no session exists yet:
1. Set `selectedFamily` immediately (local state)
2. Store the family in `pendingFamilyRef.current`
3. Call `createSessionMutation.mutate()`
4. In `createSessionMutation.onSuccess`: read `pendingFamilyRef.current`, call `apiRequest("PATCH", /api/trade-planning/session/${newId}, { selectedExpressionFamily: f })` — fire-and-forget

**How to apply:** Any new expression selection path that might trigger session creation must use the same ref pattern. Never block the UI on the PATCH; local state is already set.

## `selectedBy` Invariant — Must Be USER Always
`handleExploreFamily` must NEVER include `selectedBy` in the PATCH body. The server enforces `selectedBy: "USER"` via `FORBIDDEN_CLIENT_FIELDS` in `trade-preferences.ts`. If you add a new expression selection trigger, do not pass `selectedBy`.

## Auth Bug Class — trade-plans.ts
`trade-plans.ts` had 13 route handlers using `(req as any).user?.id` (always undefined — no Passport in this app). Same bug class as `trade-planning.ts` Defect-4. **Any new route file must use `req.session.userId!`** — not `req.user`. When adding route handlers, grep for `(req as any).user` before shipping.

**How to apply:** If you add handlers to `trade-plans.ts` or any new route file, pattern-check with `grep "(req as any).user" server/routes/*.ts` before the sprint ships.

## EXPLORE_CTA_LABELS
Mapping lives in `client/src/pages/trade-planning.tsx` as `EXPLORE_CTA_LABELS: Record<string, string>`. Add new families here if the expression family list grows. Labels are user-facing; avoid "trade" or "order" language — use "Explore" / "Monitor".

## EquityPlanningPanel Render Gate
Gate is `selectedFamily === "equity" || "equity_scaled"` AND `sessionId`. Both must be non-null. The Explore flow guarantees sessionId is created before the panel needs it (pendingFamilyRef pattern above).

## Create Trade Plan Gate
Only show for equity/equity_scaled expression families: `sessionId && (selectedFamily === "equity" || selectedFamily === "equity_scaled")`. Post body: `{ planningSessionId: sessionId, planType: "EQUITY" }`. Forbidden fields (`researchScore`, `marketPrice`, etc.) are rejected server-side.
