---
name: Institutional symbol availability
description: Trust boundary separating diagnostic symbol evidence from reliable identity and zero-position claims.
---

Load target-specific CUSIP evidence even when it is unresolved so mapping failures can be diagnosed, but only reviewed security-master evidence or exact/reviewed source evidence for the same symbol may establish reliable identity. A genuine no-reported-position result requires that reliable identity; unresolved target evidence is unmapped, and no evidence is unsupported. Incomplete coverage takes precedence over any numeric zero.

**Why:** Using one candidate set for both diagnostic loading and trusted identity either hides ambiguous rows before analysis or promotes untrusted/conflicting evidence into a false zero-position claim.

**How to apply:** Keep diagnostic candidates and reliable identity as separate provenance fields in all symbol-level institutional pipelines. Bind each status to the symbol emitted by that same source, preserve ambiguous rows for diagnostics, and suppress zero counts whenever coverage is incomplete.