---
name: Portfolio Document Intake (Sprint 2.4.1)
description: Image (GPT-4o vision) and PDF (pdf-parse + GPT-4o) portfolio intake — architecture, privacy rules, test patterns, and stale-test update protocol.
---

## Architecture

- **Image path:** multer memoryStorage → `extractFromImage()` → GPT-4o vision (base64 data URL) → JSON → `normalizePortfolioPositions("image")`
- **PDF path:** multer memoryStorage → `extractFromPdf()` → pdf-parse (embedded text only) → GPT-4o text → JSON → `normalizePortfolioPositions("pdf")`
- Scanned PDFs (no embedded text) are unsupported — return 422 "no holdings detected"; users should use screenshot path instead.
- Preview store, TTL, single-use, user-isolation, and confirm route all reused unchanged from Sprint 2.4.0.

## Schema

- `portfolioSourceTypeEnum` extended with `"image"` and `"pdf"` (additive only).
- `drizzle-kit push` on startup applies `ALTER TYPE ... ADD VALUE` automatically; idempotent.

## Privacy Rules

- Buffer discarded after extraction: `req.file.buffer = Buffer.alloc(0)`.
- Only telemetry counters logged (rowsDetected, processingDurationMs, resultStatus) — never raw content.
- `redactSensitiveText()` strips account#/SSN/email/IP before any log statement.
- File never written to disk (multer memoryStorage enforced by multer instance, not `upload` but `uploadImage` and `uploadPdf`).

## Confidence System

- `classifyConfidence(0–1)`: `≥0.8 → high`, `0.5–0.79 → medium`, `<0.5 → low`.
- `annotateWithConfidence()` attaches confidence + marketValue to normalised positions for preview UI only — NOT persisted to DB.
- Confidence is advisory, not validated against any security master.

## Test Patterns

- All structural tests are string-based (no DOM, no JSDOM) — fast, ~400ms for the entire file.
- Tests for `type=image` / `type=pdf` in portfolio-import-document.tsx should check for the endpoint strings (`/api/portfolio/import/image`) or the type-selection logic string (`"pdf" ? "pdf" : "image"`), not the literal URL query param (which is in portfolio.tsx, not the import page).
- `data-testid` values set via JSX variable (`{testId}`) are NOT matchable as literal `data-testid="btn-x"` in source — check the array value string `"btn-screenshot"` instead.

## Stale-Test Update Protocol

When a "coming soon" card becomes a real feature, update `portfolio-ux-sprint240a.test.ts`:
- Replace `aria-disabled="true"` checks with checks that the section does NOT have aria-disabled.
- Replace "Coming Soon" badge checks with route-navigation checks.
- Note the sprint that activated the feature in the test description.

## Known Limitations

1. Scanned PDFs (no embedded text) → 422; redirect users to screenshot import.
2. AI extraction accuracy varies; always show preview before confirm.
3. GPT-4o required; `OPENAI_API_KEY` must be set in production.
4. Confidence is AI self-reported, not validated against security master.

**Why:** These rules prevent the common pitfall of trusting AI extraction directly or inadvertently logging sensitive financial data from uploaded statements.
