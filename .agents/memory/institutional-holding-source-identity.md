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
the SEC source-row identifier. Treat malformed, incomplete, or non-exact source
evidence as unresolved rather than safe. For source reconciliation, a filename
is not authoritative by itself: require explicit Information Table metadata
from the filing index, fetch the exact validated same-accession path, and retain
body-free transport/encoding/validator evidence for every attempted accession.
SEC may list both an XSL-rendered `.html` representation and the raw `.xml`
Information Table with the same type/sequence; select only the raw XML document
label outside viewer/XSL paths, and fail closed if distinct raw candidates remain.

For controlled production repair, source-confirmed multiple rows are preserved
and aggregate-eligible; confirmed ingestion/persistence duplication, ambiguous
matches, and unavailable evidence block. Bind the body-free provenance result
to the repair plan hash and rerun it inside the write transaction before writes.