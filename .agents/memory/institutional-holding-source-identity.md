---
name: Institutional holding source identity
description: Limits on duplicate attribution for persisted SEC 13F InfoTable rows.
---

Identical persisted material fields do not prove that two holdings are duplicate
SEC source rows. Classify them as source-identity-unresolved unless independent
source evidence is available. Materially distinct rows sharing the legacy
accession/CUSIP/class/put-call key can prove that the legacy detector is too
coarse, but they do not justify deleting or collapsing data.

**Why:** SEC bulk data provides `INFOTABLE_SK`, but the current parser and schema
discard it. Two legitimate InfoTable lines may therefore be indistinguishable
after persistence.

**How to apply:** Report any redundant-row/share impact as conditional only.
Do not repair, deduplicate, or claim parser/ingestion duplication from stored
field equality alone. A conclusive future workflow must persist and reconcile
the SEC source-row identifier.