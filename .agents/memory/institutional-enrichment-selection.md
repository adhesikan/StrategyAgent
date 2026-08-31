---
name: Institutional enrichment selection
description: Durable rules for prioritizing persisted institutional reference lookups.
---

Never-processed institutional CUSIPs take precedence over retryable provider
failures, rate limits, and partial observations. Ambiguous, unsupported,
no-reference, and conflicting outcomes are terminal skips by default and may
only be refreshed through explicit operator intent. Current candidate history
can establish that a lookup was previously attempted when lookup-state data is
missing, but it must never create identity evidence.

**Why:** Repeatedly querying terminal unresolved identities consumes provider
capacity without increasing safe coverage, while treating unknown historical
state as terminal could strand new or incomplete identities.

**How to apply:** Keep selection deterministic within each class, preserve
reviewed/rejected protections and the shared resolver as the trust authority,
and include the selection policy/refresh mode in any plan hash.