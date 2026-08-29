---
name: Historical validation bias controls
description: Non-obvious rules that keep offline Multibagger validation reproducible and free of outcome-availability bias.
---

Select model-ranked cohorts before filtering or inspecting future-outcome availability. Keep selected symbols whose outcomes are stale, missing, or unobservable in the cohort with an explicit unavailable state.

**Why:** Filtering to observable outcomes first silently replaces high-scoring delisted or data-poor symbols with lower-scoring survivors, introducing survivorship and availability bias.

**How to apply:** Require point-in-time model inputs, adjusted-price basis and bounded endpoint dates, normalize order-insensitive price observations before hashing, and bind each run to immutable scoring-artifact plus input/price snapshot hashes.