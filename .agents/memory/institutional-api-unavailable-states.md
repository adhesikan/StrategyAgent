---
name: Institutional API unavailable states
description: How institutional UI surfaces must distinguish delayed or missing snapshots from transport failures across two API generations.
---

Treat the v1 nested `error.code` value `DATA_UNAVAILABLE` as a delayed/empty snapshot, not a generic request failure. Treat a successful legacy response as usable only when it contains its summary payload; HTTP 200 with unavailable status is an empty state.

**Why:** The two institutional API generations represent missing snapshots differently, and relying on HTTP status alone produces either destructive errors or a dashboard full of misleading placeholders.

**How to apply:** Parse both top-level and nested API error codes, wait for applicable fallback queries, and validate payload usability before choosing loading, error, or empty UI states.