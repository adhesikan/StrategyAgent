---
name: Ticker extraction policy
description: How Ask AI decides whether free text contains a ticker; explicit-syntax vs denylist precedence.
---

Rule: free-text ticker extraction is centralized in one server module with a reserved-language denylist and constraint-phrase pre-stripping. Explicit ticker syntax ($SYM, EXCHANGE:SYM, "ticker X"/"symbol X") BYPASSES the denylist; every downstream validator (e.g. trade-goal normalization) must apply the same explicit-context exception so extraction and validation can never disagree.

**Why:** "Find a trade under $500 max loss" once produced tickers UNDER/MAX/LOSS (chips + AI narrative about "ticker UNDER"). A later defense-in-depth validator that unconditionally rejected reserved words silently dropped legitimately explicit symbols like "ticker ON".

**How to apply:** never add a second ad-hoc ticker regex at a call site; import the central extractor/helpers. When adding validators, pair reserved-word rejection with the explicit-context check. Market-wide requests keep symbol undefined — never "" or a placeholder token.
