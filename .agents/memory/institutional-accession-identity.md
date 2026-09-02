---
name: Institutional accession identity
description: Canonical SEC 13F accession representation and the rerun-safety boundary.
---

Use the 18-digit accession number without dashes as the one filing identity across SEC parsing, dry-run comparison, persistence, completion checks, amendment handling, and replay.

**Why:** A dry-run-specific normalizer once masked that the bulk parser emitted dashed values while the database contract expected undashed values, causing false zero-overlap results. Separate identity schemes make reconciliation untrustworthy.

**How to apply:** Normalize at the parser boundary and reuse that same normalizer everywhere identity is compared. Reruns are protected at accession level: complete exact-count accessions skip writes; incomplete accessions are made ineffective, cleared, and replayed before becoming effective.