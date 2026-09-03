---
name: Historical 13F period repair
description: Safety boundary for detecting and repairing filing-period contamination in historical SEC 13F data.
---

Historical filing identity and period corrections must be derived from a unique authoritative SEC submissions record keyed by the canonical 18-digit accession. Requested catalog quarters select archives only and must never become filing metadata.

**Why:** A legacy per-filing XML path copied its requested target quarter into both filing and holding rows. Dashed/undashed accession duplicates can also hide conflicting holding sets, so canonicalization alone is not enough evidence for a safe merge.

**How to apply:** Keep production audits read-only and Railway-identity-bound. Correct a verified accession atomically; merge duplicates only when one holding set is empty or both fingerprints match. Otherwise roll back and require source replay. Recompute only affected periods and symbols.

For production-wide verification, count the filing population before loading rows, enforce finite filing/CIK/batch ceilings, sort and deduplicate CIKs, and process SEC submissions serially in bounded batches. A cap failure must report actual filings and unique CIKs without exposing rows or secrets.

SEC errors must be sanitized structurally, not by splitting messages on punctuation: URLs contain colons, so message splitting can falsely make a valid request appear truncated.

A genuine SEC submissions 404 is record-level source unavailability: preserve successful CIK metadata, leave missing accessions unverified, record bounded sanitized status, and continue. Transport, parsing, malformed URL, and cancellation failures remain fatal.

Accession recovery may use catalog-resolved SEC bulk archives, but must read SUBMISSION metadata only, select archives from filing-date windows, process one archive at a time, and never infer identity from issuer/manager similarity.

Duplicates and unverified identities are not contamination. The contamination flag requires an exact SEC-verified metadata mismatch plus dependent downstream rows; report duplicate, unverified, and mismatch impact separately.

Production duplicate convergence must be dry-run by default and hash-bound to a fresh plan. Safe cleanup may retain a non-empty donor only when authoritative metadata matches and holding fingerprints are empty or identical; conflicting non-empty sets require exact SEC replay before any legacy deletion.

**Why:** Choosing an arbitrary legacy copy can preserve a contaminated holding set, while deleting before replay validation can turn a recoverable source failure into data loss.

**How to apply:** Acquire a transaction-scoped advisory lock, revalidate the plan under repeatable-read isolation, validate and persist replay data before deleting legacy rows, reject remaining canonical collisions, and create normalized-accession uniqueness only after all groups converge.

Post-convergence materialization scope must be journaled in the same transaction as duplicate mutation. Resume from persisted exact symbol-period targets, never from a fresh duplicate scan, and checkpoint aggregate targets, signals, and snapshots independently.

**Why:** After mutation commits, duplicate groups disappear; a later materialization failure otherwise destroys the only reconstruction path for the required downstream rebuild.

**How to apply:** Treat the committed journal as the recovery authority, lease each resume attempt, skip completed idempotent stages, sanitize bounded failures, and fail closed on inconsistent journal state.

Operational diagnostics should separate lightweight duplicate classification from authoritative replay validation: summary mode may report replay candidates but must emit a distinct non-authorizing hash and never download replay sources.

**Why:** Sequential SEC replay checks can make a diagnostic dry run operationally unusable without reducing the safety required for APPLY.

**How to apply:** Keep summary mode read-only and false for apply readiness; reserve replay downloads and authorization checks for the normal dry-run/APPLY path.