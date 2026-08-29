/**
 * Canonical quarter identifiers used by institutional services.
 *
 * Public/service callers may use "latest", "YYYY-Qn", or an existing
 * database period-end date. Database queries continue to use ISO period-end
 * dates.
 */
export type InstitutionalQuarterNumber = 1 | 2 | 3 | 4;
export type InstitutionalQuarterLabel = `${number}-Q${InstitutionalQuarterNumber}`;
export type InstitutionalQuarterIdentifier = InstitutionalQuarterLabel | "latest";

export type ParsedQuarterIdentifier =
  | {
      kind: "latest";
      identifier: "latest";
      periodEndDate: null;
    }
  | {
      kind: "quarter";
      identifier: InstitutionalQuarterLabel;
      year: number;
      quarter: InstitutionalQuarterNumber;
      periodEndDate: string;
    };

const PERIOD_END_BY_QUARTER: Record<InstitutionalQuarterNumber, string> = {
  1: "03-31",
  2: "06-30",
  3: "09-30",
  4: "12-31",
};

function buildQuarter(
  year: number,
  quarter: InstitutionalQuarterNumber,
): ParsedQuarterIdentifier {
  return {
    kind: "quarter",
    identifier: `${year}-Q${quarter}`,
    year,
    quarter,
    periodEndDate: `${year}-${PERIOD_END_BY_QUARTER[quarter]}`,
  };
}

/**
 * Parse "latest", a canonical quarter label, or a legacy DB period-end date.
 * Returns null for malformed values and for dates that are not quarter ends.
 */
export function parseQuarterIdentifier(
  value: string | null | undefined,
): ParsedQuarterIdentifier | null {
  const input = String(value ?? "").trim();
  if (!input) return null;
  if (input.toLowerCase() === "latest") {
    return { kind: "latest", identifier: "latest", periodEndDate: null };
  }

  const labelMatch = input.toUpperCase().match(/^(\d{4})-Q([1-4])$/);
  if (labelMatch) {
    const year = Number(labelMatch[1]);
    const quarter = Number(labelMatch[2]) as InstitutionalQuarterNumber;
    return buildQuarter(year, quarter);
  }

  const datePart = input.split("T")[0];
  const dateMatch = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) return null;

  const year = Number(dateMatch[1]);
  const monthDay = `${dateMatch[2]}-${dateMatch[3]}`;
  const quarterEntry = Object.entries(PERIOD_END_BY_QUARTER).find(
    ([, periodEnd]) => periodEnd === monthDay,
  );
  if (!quarterEntry) return null;

  return buildQuarter(
    year,
    Number(quarterEntry[0]) as InstitutionalQuarterNumber,
  );
}

/** Convert a canonical quarter or legacy period-end date to YYYY-Qn. */
export function normalizeQuarter(
  value: string | null | undefined,
): InstitutionalQuarterIdentifier | null {
  return parseQuarterIdentifier(value)?.identifier ?? null;
}

/**
 * Convert a quarter identifier to its database period-end date.
 * "latest" has no fixed date and therefore returns null.
 */
export function quarterToPeriodEndDate(
  value: string | null | undefined,
): string | null {
  return parseQuarterIdentifier(value)?.periodEndDate ?? null;
}

/** Convert an exact period-end date to its canonical YYYY-Qn label. */
export function periodEndDateToQuarter(
  value: string | null | undefined,
): InstitutionalQuarterLabel | null {
  const parsed = parseQuarterIdentifier(value);
  return parsed?.kind === "quarter" ? parsed.identifier : null;
}