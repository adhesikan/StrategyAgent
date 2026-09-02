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