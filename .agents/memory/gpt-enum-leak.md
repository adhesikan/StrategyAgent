---
name: GPT enum leak prevention
description: Raw internal enum values must never appear in GPT system rules or be allowed in GPT output.
---

# GPT Enum Leak Prevention

## The Rule

Raw internal enum values — `NO_TRADE`, `TRADE_CANDIDATE`, `INSUFFICIENT_DATA`, `UNAVAILABLE`, `PRICE_REFERENCE_MISMATCH` etc. — must never appear verbatim in GPT system prompt rules or user content if they could be parroted back in GPT output.

## Why

GPT echoes language from its system prompt. If you write "State the overallVerdict (NO_TRADE)", GPT will output "NO_TRADE" in the answer text, which reaches the user as an unexplained raw code.

## How to Apply

In `ask.ts`, build a display-label map server-side and interpolate the label, not the enum:

```ts
const DISPLAY = {
  TRADE_CANDIDATE: "Qualified research candidate",
  NO_TRADE: "No qualifying setup",
  WATCH: "Setup worth monitoring",
  INSUFFICIENT_DATA: "Insufficient verified data",
};
const label = DISPLAY[multiStrategy.overallVerdict] ?? multiStrategy.overallVerdict;
mcpSystemRules += `... State the overall verdict: "${label}" ...`;
```

Also: add an explicit prohibition in the system rule: "NEVER output raw internal codes NO_TRADE, TRADE_CANDIDATE, INSUFFICIENT_DATA, or UNAVAILABLE".

## PRICE INTEGRITY OVERRIDE scope

`PRICE INTEGRITY OVERRIDE` must only fire for genuine price-scale failures:
- `PRICE_REFERENCE_MISMATCH` — actual ratio error detected
- `PRICE_REFERENCE_CONFLICT` — broker and history disagree materially
- `PRICE_NON_FINITE` — non-finite setup price

Must NOT fire for:
- `PRICE_REFERENCE_STALE` — reference too old to validate (use a softer NOTE)
- `PRICE_REFERENCE_UNAVAILABLE` — no reference found (use a softer NOTE)
