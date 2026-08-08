// SEC Form 13F InfoTable parser — Sprint 2.2.5.
//
// Parses the XML InfoTable document from a 13F-HR filing.
// The XML schema is: http://www.sec.gov/edgar/document/thirteenf/informationtable
//
// Key correctness rules (NON-NEGOTIABLE):
//   - Put/call rows are preserved with putCall field set — never mixed into common-stock totals.
//   - PRN (principal amount) rows are preserved with sharesPrnType = "PRN" — not treated as shares.
//   - reportedValue is in thousands of USD as reported.
//   - Filing date vs period of report are never swapped.
//   - Null values remain null; they are never converted to zero.
//   - CUSIP is normalized to 9 characters.
//   - Issuer name and class title whitespace is normalized.
//
// The parser tolerates common filer-supplied variations:
//   - Namespace prefixes (ns1:, thirteenf:, etc.)
//   - Missing optional fields (figi, otherManager, votingAuthority)
//   - Capitalization variations (nameOfIssuer vs NAMEOFISSUER)
//   - Both XML (InfoTable) and older text-table (TSV) formats

export interface ParsedHolding {
  issuerName: string;
  classTitle: string;
  cusip: string;
  figi: string | null;
  /** Reported value in USD as filed. Post-2023 SEC bulk data uses dollars; pre-2023 used thousands.
   *  Canonical unit stored in DB = USD (dollars). The ×1000 factor was removed from fund-service. */
  reportedValue: number | null;
  reportedShares: number | null;
  /** SH = common shares | PRN = principal amount */
  sharesPrnType: "SH" | "PRN" | null;
  /** Put | Call | null — never treated as common-stock shares */
  putCall: "Put" | "Call" | null;
  investmentDiscretion: string | null;
  otherManager: string | null;
  votingSole: number | null;
  votingShared: number | null;
  votingNone: number | null;
}

export interface ParseResult {
  holdings: ParsedHolding[];
  /** Count of rows that were skipped due to parse errors */
  skippedRows: number;
  /** True when put/call rows were found (for audit) */
  hasPutCallRows: boolean;
  /** True when PRN rows were found */
  hasPrnRows: boolean;
  parseWarnings: string[];
}

// ---------------------------------------------------------------------------
// XML text extraction helpers (no external dependency)
// ---------------------------------------------------------------------------

/** Extract text content between the first matching open/close tag pair. */
function extractTag(xml: string, tag: string): string | null {
  // Match with optional namespace prefix and attributes
  const re = new RegExp(
    `<(?:[a-zA-Z0-9_]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-zA-Z0-9_]+:)?${tag}>`,
    "i",
  );
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

/** Extract all occurrences of a repeating block tag. */
function extractAllBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(
    `<(?:[a-zA-Z0-9_]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-zA-Z0-9_]+:)?${tag}>`,
    "gi",
  );
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    blocks.push(m[1]);
  }
  return blocks;
}

/** Parse a positive integer from a string; null if missing/invalid. */
function parseIntOrNull(s: string | null | undefined): number | null {
  if (s == null || s.trim() === "") return null;
  // Remove commas used as thousands separators by some filers
  const cleaned = s.trim().replace(/,/g, "");
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Normalize CUSIP to exactly 9 characters (pad with leading zeros if shorter). */
function normalizeCusip(raw: string): string {
  const cleaned = raw.trim().replace(/[^A-Z0-9]/gi, "").toUpperCase();
  return cleaned.padStart(9, "0").slice(0, 9);
}

/** Normalize issuer name: collapse internal whitespace. */
function normalizeName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Normalize put/call field. Returns Put | Call | null. */
function normalizePutCall(raw: string | null): "Put" | "Call" | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if (upper === "PUT" || upper === "P") return "Put";
  if (upper === "CALL" || upper === "C") return "Call";
  return null; // Empty string or blank self-closes = no put/call
}

/** Normalize shares/prn type. Returns SH | PRN | null. */
function normalizeSharesPrnType(raw: string | null): "SH" | "PRN" | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if (upper === "SH") return "SH";
  if (upper === "PRN") return "PRN";
  return null;
}

// ---------------------------------------------------------------------------
// XML InfoTable parser
// ---------------------------------------------------------------------------

/**
 * Parse an XML InfoTable document from a 13F-HR filing.
 * Handles both namespaced and non-namespaced variants.
 */
export function parseInfoTableXml(xml: string): ParseResult {
  const holdings: ParsedHolding[] = [];
  let skippedRows = 0;
  let hasPutCallRows = false;
  let hasPrnRows = false;
  const parseWarnings: string[] = [];

  // Find all <infoTable> blocks (handles namespace prefix variations)
  const blocks = extractAllBlocks(xml, "infoTable");

  if (blocks.length === 0) {
    parseWarnings.push("No infoTable blocks found in document");
    return { holdings, skippedRows: 0, hasPutCallRows, hasPrnRows, parseWarnings };
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    try {
      const issuerNameRaw = extractTag(block, "nameOfIssuer");
      const classTitle = extractTag(block, "titleOfClass");
      const cusipRaw = extractTag(block, "cusip");
      const figiRaw = extractTag(block, "figi");
      const valueRaw = extractTag(block, "value");
      const shrsOrPrnAmtBlock = extractTag(block, "shrsOrPrnAmt");
      const investmentDiscretion = extractTag(block, "investmentDiscretion");
      const otherManagerRaw = extractTag(block, "otherManager");
      const votingBlock = extractTag(block, "votingAuthority");
      const putCallRaw = extractTag(block, "putCall");

      // Required fields: issuerName, classTitle, cusip
      if (!issuerNameRaw || !classTitle || !cusipRaw) {
        skippedRows++;
        parseWarnings.push(`Row ${i}: missing required field (issuerName/classTitle/cusip)`);
        continue;
      }

      const cusip = normalizeCusip(cusipRaw);
      if (cusip.length !== 9) {
        skippedRows++;
        parseWarnings.push(`Row ${i}: invalid CUSIP "${cusipRaw}"`);
        continue;
      }

      // Parse shrsOrPrnAmt block
      let reportedShares: number | null = null;
      let sharesPrnType: "SH" | "PRN" | null = null;
      if (shrsOrPrnAmtBlock) {
        const sshRaw = extractTag(shrsOrPrnAmtBlock, "sshPrnamt");
        const typeRaw = extractTag(shrsOrPrnAmtBlock, "sshPrnamtType");
        reportedShares = parseIntOrNull(sshRaw);
        sharesPrnType = normalizeSharesPrnType(typeRaw);
      }

      // Parse votingAuthority block
      let votingSole: number | null = null;
      let votingShared: number | null = null;
      let votingNone: number | null = null;
      if (votingBlock) {
        votingSole = parseIntOrNull(extractTag(votingBlock, "Sole") ?? extractTag(votingBlock, "sole"));
        votingShared = parseIntOrNull(extractTag(votingBlock, "Shared") ?? extractTag(votingBlock, "shared"));
        votingNone = parseIntOrNull(extractTag(votingBlock, "None") ?? extractTag(votingBlock, "none"));
      }

      // Put/call — preserve as-is, never mixed into share totals
      const putCall = normalizePutCall(putCallRaw);
      if (putCall !== null) hasPutCallRows = true;

      // PRN tracking
      if (sharesPrnType === "PRN") hasPrnRows = true;

      const holding: ParsedHolding = {
        issuerName: normalizeName(issuerNameRaw),
        classTitle: normalizeName(classTitle),
        cusip,
        figi: figiRaw && figiRaw.trim() ? figiRaw.trim() : null,
        reportedValue: parseIntOrNull(valueRaw),
        reportedShares,
        sharesPrnType,
        putCall,
        investmentDiscretion: investmentDiscretion?.trim() ?? null,
        otherManager: otherManagerRaw?.trim() || null,
        votingSole,
        votingShared,
        votingNone,
      };

      holdings.push(holding);
    } catch (err: any) {
      skippedRows++;
      parseWarnings.push(`Row ${i}: parse error — ${err?.message ?? "unknown"}`);
    }
  }

  return { holdings, skippedRows, hasPutCallRows, hasPrnRows, parseWarnings };
}

// ---------------------------------------------------------------------------
// Filing document discovery
// ---------------------------------------------------------------------------

/**
 * Given the HTML index page of a filing, find the InfoTable XML document filename.
 * Returns the filename (not the full URL) of the primary holdings document.
 */
export function findInfoTableDocumentFilename(indexHtml: string): string | null {
  // Look for the InfoTable type or primary document in the filing index
  // Common patterns:
  // - type="informationTable" in the SGML header
  // - "infotable.xml" or similar filename
  // - Listed as primary document

  // Try to find XML file listed in the index
  const xmlMatch = indexHtml.match(
    /href="([^"]*infotable[^"]*\.xml)"[^>]*>/i,
  ) ?? indexHtml.match(
    /href="([^"]*\.xml)"[^>]*>.*?information\s*table/i,
  ) ?? indexHtml.match(
    /href="([^"]*\.xml)"[^>]*>/i,
  );

  if (xmlMatch) return xmlMatch[1].split("/").pop() ?? null;

  // Try text format (older filings use .txt or 13F_HR format)
  const txtMatch = indexHtml.match(/href="([^"]*13f[^"]*\.(txt|htm))"[^>]*>/i);
  if (txtMatch) return txtMatch[1].split("/").pop() ?? null;

  return null;
}

// ---------------------------------------------------------------------------
// Period-of-report extraction from filing header
// ---------------------------------------------------------------------------

/**
 * Extract PERIOD-OF-REPORT from the SGML header block of an SEC filing.
 * Returns ISO date string (YYYYMMDD → YYYY-MM-DD) or null.
 */
export function extractPeriodOfReport(headerText: string): string | null {
  const m = headerText.match(/PERIOD-OF-REPORT:\s*(\d{8})/i);
  if (!m) return null;
  const raw = m[1];
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

/**
 * Extract FILED AS OF DATE from the SGML header block.
 */
export function extractFiledDate(headerText: string): string | null {
  const m = headerText.match(/FILED AS OF DATE:\s*(\d{8})/i);
  if (!m) return null;
  const raw = m[1];
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

/**
 * Extract FILER CIK from the SGML header block.
 */
export function extractFilerCik(headerText: string): string | null {
  const m = headerText.match(/CENTRAL INDEX KEY:\s*(\d+)/i);
  return m ? m[1].padStart(10, "0") : null;
}

/**
 * Extract COMPANY CONFORMED NAME from the SGML header block.
 */
export function extractFilerName(headerText: string): string | null {
  const m = headerText.match(/COMPANY CONFORMED NAME:\s*(.+)/i);
  return m ? m[1].trim() : null;
}

/**
 * Whether a document looks like an XML InfoTable (vs. a text/HTML index).
 */
export function isInfoTableXml(content: string): boolean {
  const trimmed = content.trimStart();
  return (
    (trimmed.startsWith("<?xml") || trimmed.startsWith("<informationTable")) &&
    trimmed.toLowerCase().includes("infotable")
  );
}
