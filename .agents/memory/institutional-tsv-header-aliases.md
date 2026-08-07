---
name: Institutional 13F TSV header alias resolution
description: SEC bulk TSV schema changed post-2023; parser must use normalizeHeaderKey + alias groups, not literal column names.
---

## The rule
Never check `headers.includes("ACCESSION-NUMBER")`. Always use `hasAnyAlias(lookup, aliases)` with the canonical alias group.

**Why:** Post-2023 SEC bare TSV files use underscore-separated names (ACCESSION_NUMBER, FILINGMANAGER_NAME, PERIODOFREPORT, FILING_DATE). Legacy ZIPs used hyphenated names (ACCESSION-NUMBER, NAME, CONFORMED-PERIOD-OF-REPORT, FILING-DATE). Literal includes() checks fail silently on the current schema.

## How to apply
- `normalizeHeaderKey(s)` — strips BOM, trims, uppercases, removes ALL hyphens and underscores → canonical compare key
- `buildHeaderLookup(headers)` — one-time Map<normalizedKey, rawHeader> per file
- `getField(row, lookup, aliases)` — O(1) per-row alias-aware field access
- `hasAnyAlias(lookup, aliases)` — alias-aware required-field validation
- `buildCanonicalMapping(lookup, groups)` — diagnostics: canonical label → actual header found

## Current SEC schema (post-2023)
| Canonical | Current header | Legacy header |
|---|---|---|
| accession | ACCESSION_NUMBER | ACCESSION-NUMBER |
| manager name | FILINGMANAGER_NAME | NAME, COMPANY-NAME |
| period of report | PERIODOFREPORT | CONFORMED-PERIOD-OF-REPORT |
| filing date | FILING_DATE | FILING-DATE |
| CIK | CIK (unchanged) | CIK |
| issuer name | NAMEOFISSUER (unchanged) | NAMEOFISSUER |
| class title | TITLEOFCLASS (unchanged) | TITLEOFCLASS |
| voting sole | VOTINGAUTHORITY_SOLE | VOTINGAUTHORITY-SOLE |

## Required fields (canonical labels)
SUBMISSION: accession, CIK, manager name, period of report
INFOTABLE: accession, issuer name, class title, CUSIP

## missingHeaders now reports canonical labels, not raw column names
e.g. "manager name" not "FILINGMANAGER_NAME" or "NAME"
