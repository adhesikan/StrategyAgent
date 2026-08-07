---
name: Institutional 13F COVERPAGE join
description: Current SEC 13F bulk archive requires a three-table join — manager name is in COVERPAGE.tsv, not SUBMISSION.tsv. Archive also changed voting field names.
---

## The rule
Never assume FILINGMANAGER_NAME is in SUBMISSION.tsv. Current SEC archives (post-2023) store manager identity in COVERPAGE.tsv, joined to SUBMISSION by ACCESSION_NUMBER.

**Why:** Production failure: SUBMISSION [manager name] missing because FILINGMANAGER_NAME moved to COVERPAGE.tsv. Parser required it in SUBMISSION → MANAGER_IDENTITY_SOURCE_MISSING on every parse.

## Current archive structure (01mar2026-31may2026_form13f.zip, 94.8 MB)
9 entries: COVERPAGE.tsv, INFOTABLE.tsv, OTHERMANAGER.tsv, OTHERMANAGER2.tsv, SIGNATURE.tsv, SUBMISSION.tsv, SUMMARYPAGE.tsv, FORM13F_metadata.json, FORM13F_readme.htm

## Actual column names (2026-Q1)

**SUBMISSION.tsv (5 cols):** ACCESSION_NUMBER, FILING_DATE, SUBMISSIONTYPE, CIK, PERIODOFREPORT
- Form type column is now SUBMISSIONTYPE (not FORM-TYPE / FORM_TYPE)
- No manager name column
- Values: 13F-HR, 13F-HR/A, 13F-NT, 13F-NT/A

**COVERPAGE.tsv (21 cols):** ACCESSION_NUMBER, FILINGMANAGER_NAME, ISAMENDMENT, AMENDMENTNO, AMENDMENTTYPE, REPORTTYPE, REPORTCALENDARORQUARTER, + address/admin fields
- CIK is NOT present — CIK lives only in SUBMISSION

**INFOTABLE.tsv (15 cols):** ACCESSION_NUMBER, INFOTABLE_SK, NAMEOFISSUER, TITLEOFCLASS, CUSIP, FIGI, VALUE, SSHPRNAMT, SSHPRNAMTTYPE, PUTCALL, INVESTMENTDISCRETION, OTHERMANAGER, VOTING_AUTH_SOLE, VOTING_AUTH_SHARED, VOTING_AUTH_NONE
- Voting columns changed: VOTING_AUTH_SOLE (not VOTINGAUTHORITY_SOLE) — different normalized form!
- INFOTABLE_SK is a new surrogate key (unused)

## Three-table join flow
SUBMISSION → COVERPAGE (by accession) → INFOTABLE (by accession)
- Manager name: COVERPAGE.FILINGMANAGER_NAME (primary), SUBMISSION.NAME (legacy fallback)
- CIK: SUBMISSION.CIK only (single source → managerCikConflictCount always 0)
- Amendment: SUBMISSION.SUBMISSIONTYPE=13F-HR/A OR COVERPAGE.ISAMENDMENT=Y

## Required field policy
- SUBMISSION required: accession, CIK, period of report (manager name is optional)
- COVERPAGE required: accession, manager name
- INFOTABLE required: accession, issuer name, class title, CUSIP
- If SUBMISSION lacks manager name AND COVERPAGE missing/invalid → MANAGER_IDENTITY_SOURCE_MISSING

## Alias additions needed
- SUB_FORMTYPE_ALIASES must include SUBMISSIONTYPE
- INFO_VSOLE_ALIASES must include VOTING-AUTH-SOLE (normalizes to VOTINGAUTHSOLE ≠ VOTINGAUTHORITYSOLE)
