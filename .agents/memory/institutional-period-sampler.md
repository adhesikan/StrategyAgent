---
name: Institutional PERIODOFREPORT sampler
description: detectDateFormat + rawPeriodSamples infrastructure for diagnosing unsupported PERIODOFREPORT date formats in SEC 13F bulk archives. Actual production format still unknown — requires live run.
---

## The rule
When `rejectedInvalidPeriodOfReport = recognizedHoldingsFormRows` in the --validate output, run the script and look at `rawPeriodSamples` to identify the actual format before touching `normalizeDateField`.

**Why:** The production run showed 9,716/9,716 holdings-bearing rows rejected for invalid period format. All 5 existing formats (ISO_DASH, ISO_COMPACT, US_SLASH, US_DASH, ISO_SLASH) failed, meaning the SEC post-2023 bulk archive uses a 6th format that is not yet implemented. The format cannot be determined without seeing raw values.

## New exports in sec-13f-bulk-parser.ts
- `detectDateFormat(raw)` — pure classifier returning DateFormatLabel; diagnostic only
- `normalizeDateField(raw)` — now exported; canonical parser
- `DateFormatLabel` — type union of the 5 known labels + UNKNOWN

## New fields in parseSubmissionTsv return / BulkParseDiagnostics
- `detectedPeriodFormats: Record<DateFormatLabel, number>` — format distribution; collected pre-rejection for all holdings-bearing rows with nonempty period values
- `rawPeriodSamples: string[]` — up to 10 distinct raw PERIODOFREPORT values

## Sampling logic
Period format is sampled BEFORE accession/CIK/date rejection gates, so samples are always populated even when all rows are rejected. NT rows and UNKNOWN-type rows are excluded (samples are from holdings-bearing rows only).

## --validate output now shows
- `nonempty values`, `currently parseable`, `currently rejected` counts
- Up to 10 raw example strings
- Detected patterns by label (ISO_DASH, etc.)
- Diagnosis: if UNKNOWN > 0, prints "Share the raw examples so normalizeDateField() can be extended"

## ALL_HOLDINGS_SUBMISSIONS_INVALID message includes
`detectedPeriodFormats=${JSON.stringify(detectedPeriodFormats)}`

## How to apply
1. Run: `SEC_USER_AGENT="YourOrg agent@email" npx tsx scripts/inspect-submission-types.ts --validate`
2. Read the `Raw examples` section
3. Identify the format (must be exact syntactic match)
4. Add exactly ONE new branch to normalizeDateField() with strict calendar validation
5. Re-run --validate to confirm parsedRows > 0
6. Only then run the full backfill
