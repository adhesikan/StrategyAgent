---
name: Two-mode customer policy
description: Customer-facing vocabulary and enforcement rules for Analysis Mode vs Connected Broker Mode
---

**Rule:** Customer-facing surfaces use only "Analysis Mode" and "Connected Broker
Mode". No public paper-trading/simulated-fill/virtual-cash claims. Approved terms:
"Educational Example(s)", "Delayed reference data", "Sandbox: {provider}" /
"Broker Sandbox" (dev accounts only).

**Why:** compliance redesign removed all customer paper-trading claims; the trial
is an analysis/discovery trial, not a paper-trading trial.

**How to apply:**
- Internal API values stay unchanged (`dataMode: "simulated"`, PP
  `accountMode: "paper"`, `sandbox:` id prefixes, existing testids) — only copy
  changes.
- Any client-side trading gate (e.g. Live Trading Setup before live orders) must
  also be enforced server-side on the order routes; a UI-only gate is bypassable
  by direct API calls.
- Webhook ingestion protections (rate limit, idempotency) are in-memory and
  single-instance only — move to a shared store before scaling out.
