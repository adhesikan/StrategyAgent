---
name: Price integrity false-positive policy
description: How to prevent stale historical references from misclassifying legitimate long-term price appreciation as decimal-order errors in the price integrity checker.
---

# Price Integrity False-Positive Policy

## The Rule

A ratio comparison must only run when `resolved.canCompareRatio === true`. Use `checkPriceIntegrityFromResolved()` — never call `checkPriceIntegrity()` directly with a stale resolved reference.

## Why

A stock that moved from $89 to $893 over a year looks like a 10× decimal-order error if compared against a stale reference. This was the root cause of the MU false-positive in August 2026.

## How to Apply

- `canCompareRatio: true` when freshness is "fresh" or "acceptable" (≤5 calendar days)
- `canCompareRatio: false` when freshness is "stale" (>5 days) or "unknown"
- `canCompareRatio: false` when conflict=true or referencePrice=null

When `canCompareRatio === false`:
- Return `{ valid: false, code: "PRICE_REFERENCE_STALE" }`
- Do NOT classify as 10x / 100x / divergent
- Do NOT suppress price levels in the UI (stale ≠ wrong)
- Do NOT fire GPT PRICE INTEGRITY OVERRIDE
- DO block ResearchSave (can't confirm correctness without fresh data)

## Test Fixtures

Test files must use `"SYN"` (not `"MU"`) for invented prices. Use the named constant `syntheticDecimalOrderMismatchFixture` for 10× mismatch scenarios so the synthetic nature is explicit.
