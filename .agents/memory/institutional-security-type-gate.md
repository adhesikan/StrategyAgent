---
name: Institutional security-type gate
description: Stock-level institutional analytics require persisted authoritative security classification.
---

Stock-level institutional analytics must fail closed unless the persisted security master classification is explicitly eligible. Common stock and REIT are eligible; funds remain available for separate fund analytics; ADRs, foreign listings, preferred, debt, warrants, rights, contradictory, and missing classifications cannot produce stock aggregates or signals.

**Why:** Ticker resolution, positive shares, and 13F presence do not establish that a CUSIP is a common-equity instrument. Preserving reference identity while excluding non-stock instruments prevents polluted stock analytics and stale derived signals.

**How to apply:** Enforce the shared classifier at aggregate candidate evaluation, stock holding loaders, and remediation-plan target generation. Keep provider/reference persistence independent, and report excluded populations separately with their existing derived targets.

Trusted identity and asset-type completeness are separate: an exact/reviewed CUSIP mapping may remain trusted while its canonical type is unresolved. Type backfill may fill null or stale non-reviewed values from matching provider fields, but must never replace a non-null reviewed type.

**Why:** Identity evidence establishes what a CUSIP refers to; it does not by itself establish whether that instrument belongs in stock analytics. Combining the two gates either loses valid identity coverage or risks overwriting reviewed classification decisions.

**How to apply:** Let the existing reference-enrichment planner select trusted rows only when their type is missing/stale, reuse current provider candidate observations before issuing a lookup, and keep unresolved/contradictory classifications out of stock analytics.