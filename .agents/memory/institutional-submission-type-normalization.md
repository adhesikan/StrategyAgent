---
name: Institutional 13F SUBMISSIONTYPE value normalization
description: Production fix — 0 rows parsed because SUBMISSIONTYPE values don't exactly match "13F-HR"/"13F-HR/A". normalizeSubmissionType() resolves all variants.
---

## The rule
Always use normalizeSubmissionType() before filtering SUBMISSION.tsv rows. Never compare raw formTypeRaw to "13F-HR" or "13F-HR/A" directly.

**Why:** Production failure — 11,761 SUBMISSION rows parsed but 0 retained. The old filter used exact string comparison after .trim().toUpperCase(). The actual production values used a different separator (e.g. underscore, no hyphen) that failed the exact match but is semantically identical.

## normalizeSubmissionType() alias table
| Input (case-insensitive, trimmed) | Output |
|---|---|
| "13F-HR" | "13F-HR" |
| "13F-HR/A" | "13F-HR/A" |
| "13F_HR" | "13F-HR" |
| "13F_HR_A" | "13F-HR/A" |
| "13FHR" | "13F-HR" |
| "13FHRA" | "13F-HR/A" |
| "13F-HR-A" | "13F-HR/A" (hyphen-A suffix) |
| "13F-HR /A" | "13F-HR/A" (space before slash) |
| "13F-NT" | "13F-NT" |
| "13F-NT/A" | "13F-NT/A" |
| "13FNT" | "13F-NT" |
| "13FNTA" | "13F-NT/A" |
| blank / null | null |
| anything else | "UNKNOWN" |

## COVERPAGE REPORTTYPE fallback
UNKNOWN-typed rows are kept in `unknownTypeRows` for a COVERPAGE fallback pass.
After COVERPAGE is parsed, if cpRow.reportType normalizes to "13F-HR" or "13F-HR/A", the row is promoted.
Only exact HR types accepted via fallback — NT/UNKNOWN REPORTTYPE → row stays excluded.

## Failure policy
- 0 included after fallback → NO_HOLDINGS_BEARING_SUBMISSIONS (includes submissionTypeCounts JSON in message)
- If UNKNOWN rows AND no COVERPAGE AND no verified rows → NO_HOLDINGS_BEARING_SUBMISSIONS (not MANAGER_IDENTITY_SOURCE_MISSING)
- If verified rows > 0 AND no COVERPAGE → MANAGER_IDENTITY_SOURCE_MISSING (original diagnosis preserved)

## Amendment conflict policy
Both sources checked: SUBMISSION.isAmendment (from 13F-HR/A) AND COVERPAGE.ISAMENDMENT.
Either = true → isAmendment = true. Disagreements counted in amendmentFlagConflictCount (no silent resolution).

**How to apply:** Any change to submission-type filtering must go through normalizeSubmissionType(). Never add a new exact-string comparison.
