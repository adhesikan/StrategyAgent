import type { ParsedBulkHolding } from "./sec-13f-bulk-parser";

export type ParsedFilingIdentity = Pick<
  ParsedBulkHolding,
  "accessionNumber" | "filerCik" | "filerName" | "filingType" | "filingDate" | "periodOfReport" | "isAmendment"
>;

/**
 * Derive filing identity only from accession-scoped SEC rows.
 *
 * A requested archive quarter is intentionally not accepted as an argument:
 * catalog quarters select source archives but can never become filing metadata.
 */
export function deriveParsedFilingIdentity(
  expectedAccession: string,
  holdings: ParsedBulkHolding[],
): ParsedFilingIdentity {
  const first = holdings[0];
  if (!first) throw new Error("EMPTY_ACCESSION_BATCH");
  if (first.accessionNumber !== expectedAccession) {
    throw new Error("ACCESSION_BATCH_IDENTITY_MISMATCH");
  }

  const identity: ParsedFilingIdentity = {
    accessionNumber: first.accessionNumber,
    filerCik: first.filerCik,
    filerName: first.filerName,
    filingType: first.filingType,
    filingDate: first.filingDate,
    periodOfReport: first.periodOfReport,
    isAmendment: first.isAmendment,
  };
  if (!identity.periodOfReport || !identity.filingDate) {
    throw new Error("SEC_FILING_METADATA_INCOMPLETE");
  }

  for (const holding of holdings) {
    if (
      holding.accessionNumber !== identity.accessionNumber ||
      holding.filerCik !== identity.filerCik ||
      holding.filingType !== identity.filingType ||
      holding.filingDate !== identity.filingDate ||
      holding.periodOfReport !== identity.periodOfReport ||
      holding.isAmendment !== identity.isAmendment
    ) {
      throw new Error("ACCESSION_BATCH_METADATA_CONFLICT");
    }
  }
  return identity;
}