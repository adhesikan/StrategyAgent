---
name: Twelve Data market-data integration
description: Durable rules for the Twelve Data daily OHLCV layer — env-first licensing, credit safety, prelaunch gating.
---

- Env vars are the ONLY effective license control (`TWELVE_DATA_LICENSE_MODE`, `TWELVE_DATA_EXTERNAL_DISPLAY_ENABLED`); the DB license row is descriptive. Never add code paths that let DB or admin UI enable external display.
  **Why:** licensing compliance — external display of Twelve Data requires a paid Venture plan and written approval.
  **How to apply:** any new endpoint surfacing Twelve Data-backed data must go through the central access-control gate and return the safe denial with no data on failure.
- Stripe trial/paid status must never grant prelaunch access — only admin/internal roles or the internal test email allowlist.
- Credit accounting must remain transactional (row-locked check-and-increment) — a read-then-write pattern oversubscribes the 7/min & 750/day safety caps under concurrency (caught in review).
- Scheduler trading-day checks need a real NYSE holiday calendar, not weekday-only logic.
