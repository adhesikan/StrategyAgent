---
name: Portfolio UX Polish (Sprint 2.4.0A)
description: Pure UI polish sprint — onboarding redesign, import wizard enhancements, accessibility, tooltips, placeholder intelligence cards. Zero backend changes.
---

## Key Rules

- Coming-soon cards (Screenshot/PDF import) are `aria-disabled="true"` — no routes, no APIs, no OCR.
- Intelligence placeholder section shown only when `positions.length > 0` (not on empty holdings state).
- Language constraint enforced by tests: never "Recommendation / Buy / Sell" — always "Research / Analysis / Opportunities / Intelligence".
- "Analysis" (capital A) must appear literally in portfolio.tsx for test §5 to pass — currently in the AI Research intelligence card description.

## Tooltip Architecture

- `TooltipProvider` wraps at component level (not page-level) to avoid nesting issues.
- Column headers use `ColHeader` wrapper component — passes `tooltip?` prop.
- Field tooltips (`FIELD_TOOLTIPS`) and column tooltips (`COL_TOOLTIPS`) are both keyed dicts for easy extension.

## Accessibility Decisions

- Drop zone: `role="button"` + `tabIndex={0}` + `onKeyDown` (Enter + Space both trigger file picker).
- Hidden file `<input>` has `aria-hidden="true"` — screen readers use the role=button parent.
- Table action buttons: `aria-label` uses template literal with symbol name (e.g. "Edit ${p.symbol} position").
- `sr-only` on the Actions column header (last column) — icon-only, no visible text needed.

## Test File

`server/routes/__tests__/portfolio-ux-sprint240a.test.ts` — 124 pure structural tests, reads source as string, no DOM rendering. Uses `data-testid` attributes as anchors.

**Why:** Pure string tests run in <300ms and catch regressions without requiring a full browser or JSDOM setup. `data-testid` attributes are the canonical hook.
