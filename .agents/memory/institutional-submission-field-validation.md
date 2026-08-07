---
name: Institutional 13F submission field validation failure
description: All 9,716 holdings-bearing rows were silently dropped by the combined gate (!accession || !cik || !periodOfReport). Root cause was normalizeDateField not supporting SEC date formats.
---

## The rule
parseSubmissionTsv uses granular per-field rejection counters, NOT a combined gate. Each rejected row increments exactly one counter so the production log tells you which field is failing.

**Why:** With a combined gate, 9,716 rows all passed form-type classification (13F-HR/13F-NT counts were correct) but 0 rows reached the output, and the failure message was "none normalised to 13F-HR or 13F-HR/A" — which was wrong. The actual cause was normalizeDateField rejecting the date format. A combined gate makes the root cause invisible in logs.

## Counter invariant
recognizedHoldingsFormRows = parsedRows + sum(all rejection counters)
Invariant must hold. rejectedInvalidAccession is INFORMATIONAL (non-gated) and excluded from the sum.

## Date formats now supported
- YYYY-MM-DD (already worked)
- YYYYMMDD (already worked)
- MM/DD/YYYY (new — observed in some EDGAR bulk exports)
- MM-DD-YYYY (new)
- YYYY/MM/DD (new)
- Strict calendar validation: isValidCalendarDate(y, m, d) guards all formats; impossible dates → null

## Failure codes
- NO_HOLDINGS_BEARING_SUBMISSIONS: recognizedHoldingsFormRows === 0 (form type issue)
- ALL_HOLDINGS_SUBMISSIONS_INVALID: recognizedHoldingsFormRows > 0 AND parsedRows === 0 (field validation issue)
Old code fired NO_HOLDINGS_BEARING_SUBMISSIONS in both cases — misleading.

## CIK validation
normalizeCik() returns null for blank or non-numeric input (SEC CIKs are always integer strings).
Previous code used `cikRaw.replace(/^0+/, "").padStart(10, "0") || cikRaw` which never returned empty/null — `!cik` never fired.

## --validate mode
npx tsx scripts/inspect-submission-types.ts --validate
Calls parseSubmissionTsv on live data; outputs type classification, field rejection counts, invariant check, and diagnosis (ALL_HOLDINGS_SUBMISSIONS_INVALID or NO_HOLDINGS_BEARING_SUBMISSIONS or healthy). No DB writes.

**How to apply:** Before any re-run of the backfill, run --validate to confirm parsedRows > 0. Only then run the full backfill.
