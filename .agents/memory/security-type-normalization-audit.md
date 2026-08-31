---
name: Institutional security-type normalization
description: Durable rules for OpenFIGI classification, canonical symbols, and stale type correction.
---

Provider `securityType` and `securityType2` are the concrete type signals; `marketSector` may corroborate or contradict them, while names and descriptions never establish type. Unknown, conflicting, and incomplete combinations fail closed. Funds remain separate from stock analytics, and derivatives/units remain unsupported.

**Why:** A trusted CUSIP/identity and a provider ticker do not prove operating-company common equity; historical machine-derived `asset_type` values can also outlive the rule that created them.

**How to apply:** Keep canonical symbol validation structural and provider-authoritative without ticker suffix heuristics or symbol allowlists. Retain malformed/provider-only candidates for aggregate audit, but do not allow them to become identity evidence or downstream stock targets. Correct only non-reviewed persisted types when sufficient provider evidence deterministically disagrees; preserve reviewed types and trusted identity.