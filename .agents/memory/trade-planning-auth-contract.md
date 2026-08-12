---
name: Trade Planning Authentication Contract
description: Canonical session-based auth pattern for trade-planning and execution routes; documents the Defect-4 req.user footgun and its root cause.
---

# Trade Planning Authentication Contract

## The canonical pattern

```typescript
// After isAuthenticated middleware — guaranteed non-null
const userId = req.session.userId!;
```

`req.session.userId` is declared in `sessionAuth.ts` via `declare module "express-session" { interface SessionData { userId?: string; } }`.

`isAuthenticated` middleware (in `server/replit_integrations/auth/sessionAuth.ts:51`) checks `if (!req.session.userId) return res.status(401)` then calls `next()`. After `next()` is called, `userId!` is safe.

## The footgun — `(req as any).user?.id`

This codebase does **not** use Passport. `req.user` is NEVER populated. Any code using `(req as any).user?.id` or `req.user.id` to extract userId will always get `undefined`, causing any `if (!userId) return 401` guard to fire even for authenticated users.

**Why:** Sprint 2.8.1 documented "req.user pattern corrected to (req as any).session?.userId" but that note was misleading. The actual fix needed was `req.session.userId!` (typed directly — no cast required after the SessionData declaration). The intermediate `(req as any).user?.id` pattern introduced Defect-4: isAuthenticated passes, handler returns 401.

**How to apply:**
- Every new route handler that needs userId: use `req.session.userId!` directly
- Never use `(req as any).user`, `req.user`, `req.user?.id`, or variants
- `req.session` is already typed — no cast needed

## getPlanningSession arg order

```typescript
// Service signature — userId FIRST, sessionId SECOND
export async function getPlanningSession(userId: string, sessionId: string)

// Correct call
const session = await getPlanningSession(userId, sessionId);

// Swapped (bug) — was present in 9 call sites, all fixed
const session = await getPlanningSession(sessionId, userId); // WRONG
```

## opportunity-workspace getUserId helper

`server/routes/opportunity-workspace.ts` has a local `getUserId(req)` helper:
```typescript
function getUserId(req: Request): string | null {
  const u = (req as any).user;
  if (!u) return null;
  return u.id ?? u.userId ?? null;
}
```
This also reads from `req.user` and also always returns null. However, the workspace route falls back to `""` and does not perform ownership-gated 401. If the workspace ever adds ownership checks, this helper must be replaced with `req.session.userId`.

## Execution pipeline audit (Sprint 2.8.6A-defect-4 verified)

| Route file | Pattern | Safe? |
|---|---|---|
| execution-readiness.ts | `req.session.userId!` | ✅ |
| order-preparation.ts | `(req as any).session?.userId` | ✅ (functional, cast unnecessary) |
| order-confirmation.ts | `req.session?.userId` | ✅ |
| trade-planning.ts | `req.session.userId!` (fixed) | ✅ |

## Client error display contract (trade-planning.tsx)

Status codes must map to distinct UI states:
- `401` → "Your session could not be verified. Please sign in again." + Sign In link
- `403` → access denied message
- `503` → retriable infra error + Try Again button
- `>= 500` (non-503) → generic temporary error + Try Again
- `404` / default → "{SYMBOL} is not a current research candidate"

Never show "not a current research candidate" for a 401 — it is factually wrong and causes support escalations.
