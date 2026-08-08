---
name: Portfolio Privacy Disclosures (Sprint 2.4.1A)
description: Compliance disclosure blocks added to all portfolio upload flows — exact test IDs, stale-test traps, and language rules.
---

## What was added

Eight disclosure blocks across `portfolio-import.tsx` (CSV/XLSX) and `portfolio-import-document.tsx` (image/PDF):

| data-testid | Page | §spec |
|-------------|------|-------|
| `csv-privacy-disclosure` | CSV/XLSX upload | §1 |
| `csv-consent-notice` | CSV/XLSX upload | §6 |
| `csv-review-warning` | CSV/XLSX preview | §8 |
| `csv-confirm-disclaimer` / `research-disclaimer` | CSV/XLSX confirm | §9 |
| `doc-privacy-disclosure` | Doc upload | §1 |
| `ai-extraction-disclosure` | Doc upload | §3 |
| `file-retention-notice` / `file-retention-statement` | Doc upload | §4 |
| `pii-warning` | Doc upload | §5 |
| `doc-consent-notice` | Doc upload | §6 |
| `doc-review-warning` | Doc preview | §8 |
| `doc-confirm-disclaimer` / `doc-research-disclaimer` | Doc confirm | §9 |
| `privacy-link` | Doc upload | §10 |

## Critical language rules

- **"recommendation"** is permitted in `portfolio-import-document.tsx` ONLY inside the negating research disclaimer: "does not constitute investment advice or a recommendation to buy, sell, hold, or rebalance any security." Tests must check the surrounding context, not assert the word is absent.
- **"not stored"** (old Sprint 2.4.1 phrase) was replaced by "not retained after processing" and "discarded after extraction" — tests checking for "not stored" must be updated to use the new phrases.
- Privacy links → `/privacy` only. Never `/admin`, `docs/`, operations manual.
- AI extraction disclosure (§3) appears ONLY on image/PDF pages — never on CSV/XLSX pages.
- PII warning (§5) appears ONLY on image/PDF pages.

## Stale-test traps created by this sprint

When Sprint 2.4.1 tests asserted "recommendation never appears" — that became a stale negative after Sprint 2.4.1A legitimately added the research disclaimer. Fixed by: checking the surrounding context, not banning the word outright.

**Why:** Compliance disclaimers necessarily contain words that look like violations out of context. Test the intent (no affirmative buy/sell signals), not the string's mere presence.

## File retention implementation

`server/routes/portfolio.ts` contains `req.file.buffer = Buffer.alloc(0)` after extraction — this is the actual implementation the UI disclosure claims. If this line is removed, the retention claim becomes inaccurate and tests will catch it (test checks route source for `Buffer.alloc(0)`).
