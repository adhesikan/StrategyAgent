---
name: Institutional holding-count contract
description: Planner and remediation APPLY must share canonical filing and effective-holding semantics.
---

The institutional remediation planner and APPLY validator must consume the same canonical effective-holding population: rank one effective filing per filer/reporting period, then exclude put/call and PRN rows and require positive shares. APPLY should validate the live stale-row count before mapping mutation and retain the returned-row assertion. Shared CTE output must alias filing metadata when `h.*` already contains the same column names.

**Why:** A state with multiple effective filings can make a planner that supersedes amendments disagree with an executor that joins every `is_effective` row; the mismatch guard must catch real drift without allowing partial repairs. PostgreSQL permits duplicate CTE output names until a downstream qualified reference triggers error `42702`.

**How to apply:** Reuse the shared canonical SQL contract for new coverage/remediation reads and updates. Treat any semantic change as a new contract version so old plan hashes cannot be reused.