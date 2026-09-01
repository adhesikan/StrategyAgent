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

The aggregate-only verifier and remediation analyzer must share the same effective-holding scope and canonical type source, and the analyzer must fail closed if their stock-eligible CUSIP counts differ.

**Why:** Joining `security_master` without projecting its type silently converted fully typed trusted identities into insufficient evidence, suppressing all downstream aggregate and signal targets.

**How to apply:** Reconcile canonical verifier counts against analyzer inputs before creating a plan; stale holding symbols never override a trusted CUSIP mapping, while rejected or conflicting evidence remains blocked.

Canonical asset type is CUSIP-scoped and must remain attached when exact/reviewed identity comes from the institutional mapping rather than the security-master ticker.

**Why:** Requiring the security-master ticker to match the resolved symbol dropped valid mapping-only common stocks and REITs during holding enrichment, making broad accepted coverage appear limited to legacy repaired symbols.

**How to apply:** Use the security-master row joined by CUSIP as the type authority after identity resolves; only ticker-dependent descriptive metadata and theme membership require the master ticker to match the resolved symbol.

Canonical coverage reconciliation must compare the complete CUSIP→symbol population, not just equal CUSIP counts or aggregate/signal row counts. Runtime identity must resolve each canonical symbol to the same CUSIP set.

**Why:** Count-equal populations can still disagree symbol-for-symbol, while persisted aggregates and signals can make an incompatible runtime resolver look complete. Derived rows are presence evidence only, never identity authority.

**How to apply:** Reuse the live resolver's pure gate in population verifiers, report bounded set mismatches, and establish commit plus non-secret database identity before diagnosing code, cache, deployment, or configuration drift.

Population-wide resolver reconciliation must batch database evidence reads, group shared filing-period selection, measure query/runtime cost, and enforce a database statement timeout while preserving the pure per-symbol gate.

**Why:** A semantically correct verifier can still run for hours when it repeats filing work or loads an unnecessarily broad evidence population; a fail-closed timeout is safer than an unbounded diagnostic.

**How to apply:** Keep canonical identity loading set-based, bound accession batches, compare sets in memory, emit compact metrics, and treat timeout as a failed reconciliation rather than partial success.

The live Stock View must seed its shared identity predicate from a symbol-scoped form of the canonical effective-holdings contract, not from a direct security-master ticker lookup.

**Why:** A mapping-backed canonical symbol can be valid in the reconciled CUSIP→symbol population while having no matching `security_master.ticker`; feeding only direct-ticker rows to the same pure predicate creates a false `UNSUPPORTED` result.

**How to apply:** Share the canonical CTE and eligibility rules between population verification and runtime symbol lookup, parameterize the requested symbol, and retain selected-filing evidence only as supplemental diagnostics rather than identity authority.

Once Stock View authorizes a canonical symbol and CUSIP set, holder enrichment must consume that authorization directly instead of re-resolving each holding from legacy ticker fields.

**Why:** Re-running the older row-level resolver downstream can reject a valid mapping-backed canonical identity and turn an ordinary stock lookup into an upstream failure.

**How to apply:** Pass the trusted canonical symbol only alongside its bounded CUSIP set; use CUSIPs for holdings queries, keep the symbol as presentation identity, and leave non-Stock-View enrichment callers on the normal evidence resolver.