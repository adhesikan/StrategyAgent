import { sql } from "drizzle-orm";
import { filingDocUrl, filingIndexUrl } from "./sec-client";
import { findInfoTableDocumentFilename, isInfoTableXml, parseInfoTableXml, type ParsedHolding } from "./sec-13f-parser";

export const PRODUCTION_SOURCE_IDENTITY_TARGETS = [
  { symbol: "AAPL", cusip: "037833100" },
  { symbol: "NVDA", cusip: "67066G104" },
  { symbol: "MSFT", cusip: "594918104" },
  { symbol: "COST", cusip: "22160K105" },
] as const;
export const EXPECTED_UNRESOLVED_GROUPS = 30;

export type SqlExecutor = { execute(query: unknown): Promise<unknown> };
export type SourceClassification =
  | "SOURCE_ROWS_CONFIRM_MULTIPLE"
  | "INGESTION_OR_PERSISTENCE_DUPLICATION_CONFIRMED"
  | "SOURCE_MATCH_AMBIGUOUS"
  | "SOURCE_UNAVAILABLE";

export interface ProductionDiagnosticGroup {
  accessionNumber: string;
  filerCik: string;
  filerName: string | null;
  filingType: string;
  filingDate: string;
  periodOfReport: string;
  isEffective: boolean;
  amendmentFlag: boolean | null;
  amendmentNumber: number | null;
  amendmentType: string | null;
  putCall: null;
  cusip: string;
  symbol: string;
  issuerName: string;
  classTitle: string;
  figi: string | null;
  reportedValue: number | null;
  reportedShares: number | null;
  sharesPrnType: string | null;
  investmentDiscretion: string | null;
  otherManager: string | null;
  votingSole: number | null;
  votingShared: number | null;
  votingNone: number | null;
  physicalRows: number;
}

export interface SourceRowEvidence extends ParsedHolding {
  accessionNumber: string;
  documentFilename: string;
  /** One-based position in the fetched Information Table document. */
  rowOrdinal: number;
  nativeId: string | null;
  rawAsFiledReportedValue: number | null;
  sourceReportedValueUnit: "THOUSANDS_USD" | "USD";
  normalizedReportedValueUsd: number | null;
}

export interface GroupFinding extends ProductionDiagnosticGroup {
  classification: SourceClassification;
  sourceRows: SourceRowEvidence[];
  sourceMatchCount: number | null;
  sourceError: string | null;
  conditionalRedundantRows: number;
  conditionalRedundantShares: number;
  conditionalRedundantReportedValue: number | null;
}

export type SecTextFetcher = (url: string) => Promise<string>;

function rowsOf(result: unknown): any[] {
  const candidate = result as { rows?: any[] };
  return candidate.rows ?? (Array.isArray(result) ? result : []);
}

function nullableText(value: unknown): string | null {
  return value == null ? null : String(value);
}
function nullableNumber(value: unknown): number | null {
  return value == null ? null : Number(value);
}
export function normalizePgDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  const text = String(value ?? "").trim();
  const iso = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString().slice(0, 10);
  return "";
}

/** Loads only repair-scope, effective, exact-material duplicate groups. SELECT-only. */
export async function loadProductionDiagnosticGroups(executor: SqlExecutor): Promise<ProductionDiagnosticGroup[]> {
  const cusips = PRODUCTION_SOURCE_IDENTITY_TARGETS.map((target) => target.cusip);
  const result = await executor.execute(sql`
    WITH effective_holdings AS (
      SELECT h.*, f.filing_type, f.amendment_flag, f.amendment_number,
        f.amendment_type, f.is_effective
      FROM institutional_13f_holdings h
      INNER JOIN institutional_13f_filings f
        ON f.accession_number = h.accession_number AND f.is_effective = TRUE
    )
    SELECT accession_number, filer_cik, MAX(filer_name) AS filer_name, MAX(filing_type) AS filing_type,
      filing_date, period_of_report, BOOL_OR(is_effective) AS is_effective,
      BOOL_OR(amendment_flag) AS amendment_flag, MAX(amendment_number) AS amendment_number,
      MAX(amendment_type) AS amendment_type, NULL::text AS put_call,
      cusip, issuer_name, class_title, figi,
      reported_value, reported_shares, shares_prn_type, investment_discretion,
      other_manager, voting_sole, voting_shared, voting_none, COUNT(*)::int AS physical_rows
    FROM effective_holdings
    WHERE cusip IN (${sql.join(cusips.map((cusip) => sql`${cusip}`), sql`, `)})
      AND put_call IS NULL
      AND shares_prn_type IS DISTINCT FROM 'PRN'
      AND reported_shares > 0
    GROUP BY accession_number, filer_cik, filing_date, period_of_report,
      cusip, issuer_name, class_title, figi,
      reported_value, reported_shares, shares_prn_type, investment_discretion,
      other_manager, voting_sole, voting_shared, voting_none
    HAVING COUNT(*) > 1
    ORDER BY cusip, accession_number, class_title, reported_shares
  `);
  return rowsOf(result).map((row) => {
    const target = PRODUCTION_SOURCE_IDENTITY_TARGETS.find((item) => item.cusip === String(row.cusip));
    return {
      accessionNumber: String(row.accession_number).replace(/-/g, ""),
      filerCik: String(row.filer_cik),
      filerName: nullableText(row.filer_name),
      filingType: String(row.filing_type),
      filingDate: normalizePgDate(row.filing_date),
      periodOfReport: normalizePgDate(row.period_of_report),
      isEffective: Boolean(row.is_effective),
      amendmentFlag: row.amendment_flag == null ? null : Boolean(row.amendment_flag),
      amendmentNumber: nullableNumber(row.amendment_number),
      amendmentType: nullableText(row.amendment_type),
      putCall: null,
      cusip: String(row.cusip),
      symbol: target?.symbol ?? "UNKNOWN",
      issuerName: String(row.issuer_name),
      classTitle: String(row.class_title),
      figi: nullableText(row.figi),
      reportedValue: nullableNumber(row.reported_value),
      reportedShares: nullableNumber(row.reported_shares),
      sharesPrnType: nullableText(row.shares_prn_type),
      investmentDiscretion: nullableText(row.investment_discretion),
      otherManager: nullableText(row.other_manager),
      votingSole: nullableNumber(row.voting_sole),
      votingShared: nullableNumber(row.voting_shared),
      votingNone: nullableNumber(row.voting_none),
      physicalRows: Number(row.physical_rows),
    };
  });
}

function equal(a: unknown, b: unknown): boolean {
  return a == null && b == null ? true : a === b;
}

/** Exact persisted-material comparison; source ordinal is deliberately not part of it. */
export function sourceRowMatchesGroup(row: ParsedHolding, group: ProductionDiagnosticGroup): boolean {
  return row.issuerName === group.issuerName
    && row.classTitle === group.classTitle
    && row.cusip === group.cusip
    && equal(row.figi, group.figi)
    && equal(row.reportedValue, group.reportedValue)
    && equal(row.reportedShares, group.reportedShares)
    && equal(row.sharesPrnType, group.sharesPrnType)
    && equal(row.putCall, null)
    && equal(row.investmentDiscretion, group.investmentDiscretion)
    && equal(row.otherManager, group.otherManager)
    && equal(row.votingSole, group.votingSole)
    && equal(row.votingShared, group.votingShared)
    && equal(row.votingNone, group.votingNone);
}

export function classifySourceMatch(sourceMatchCount: number | null, physicalRows: number, sourceComplete = true): SourceClassification {
  if (sourceMatchCount == null) return "SOURCE_UNAVAILABLE";
  if (!sourceComplete || sourceMatchCount === 0) return "SOURCE_MATCH_AMBIGUOUS";
  if (sourceMatchCount === physicalRows && sourceMatchCount > 1) return "SOURCE_ROWS_CONFIRM_MULTIPLE";
  if (sourceMatchCount > 0 && sourceMatchCount < physicalRows) return "INGESTION_OR_PERSISTENCE_DUPLICATION_CONFIRMED";
  return "SOURCE_MATCH_AMBIGUOUS";
}

export function assertSecGovUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !["www.sec.gov", "sec.gov"].includes(parsed.hostname)) {
    throw new Error("SEC_URL_REJECTED:ONLY_HTTPS_SEC_GOV_ALLOWED");
  }
}

type XmlStructureResult = { valid: boolean; elementQNames: string[] };

/**
 * Small strict XML structure scanner for SEC documents. It is intentionally
 * not a data parser: it only establishes that markup is well formed before the
 * tolerant 13F field parser is allowed to provide classification evidence.
 */
export function validateXmlStructure(content: string): XmlStructureResult {
  const stack: string[] = [];
  const elementQNames: string[] = [];
  let rootElements = 0;
  let rootEnded = false;
  let xmlDeclarationSeen = false;
  const qname = /^[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?$/;
  const legalXmlCodePoint = (cp: number) =>
    cp === 0x9 || cp === 0xa || cp === 0xd
    || (cp >= 0x20 && cp <= 0xd7ff)
    || (cp >= 0xe000 && cp <= 0xfffd)
    || (cp >= 0x10000 && cp <= 0x10ffff);
  for (const char of content) {
    if (!legalXmlCodePoint(char.codePointAt(0)!)) return { valid: false, elementQNames };
  }
  const validReferences = (text: string): boolean => {
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== "&") continue;
      const semicolon = text.indexOf(";", i + 1);
      if (semicolon < 0) return false;
      const reference = text.slice(i + 1, semicolon);
      if (!["amp", "lt", "gt", "apos", "quot"].includes(reference)) {
        let codePoint: number;
        if (/^#\d+$/.test(reference)) codePoint = Number(reference.slice(1));
        else if (/^#x[0-9A-Fa-f]+$/.test(reference)) codePoint = Number.parseInt(reference.slice(2), 16);
        else return false;
        if (!Number.isSafeInteger(codePoint) || !legalXmlCodePoint(codePoint)) return false;
      }
      i = semicolon;
    }
    return true;
  };
  const findBoundary = (start: number, terminator: string, trackSubset = false): number => {
    let quote: "'" | '"' | null = null;
    let subsetDepth = 0;
    for (let i = start; i < content.length; i++) {
      const char = content[i];
      if (quote) {
        if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"') { quote = char; continue; }
      if (trackSubset) {
        if (char === "[") subsetDepth++;
        else if (char === "]") subsetDepth--;
        if (subsetDepth < 0) return -1;
      }
      if (subsetDepth === 0 && content.startsWith(terminator, i)) return i;
    }
    return -1;
  };
  const validAttributes = (text: string): boolean => {
    let i = 0;
    const seen = new Set<string>();
    while (i < text.length) {
      while (/\s/.test(text[i] ?? "")) i++;
      if (i === text.length) return true;
      const nameStart = i;
      while (i < text.length && !/[\s=]/.test(text[i])) i++;
      const name = text.slice(nameStart, i);
      if (!qname.test(name) || seen.has(name)) return false;
      seen.add(name);
      while (/\s/.test(text[i] ?? "")) i++;
      if (text[i++] !== "=") return false;
      while (/\s/.test(text[i] ?? "")) i++;
      const quote = text[i++];
      if (quote !== "'" && quote !== '"') return false;
      const valueStart = i;
      while (i < text.length && text[i] !== quote) {
        if (text.charCodeAt(i) === 0 || text[i] === "<") return false;
        i++;
      }
      if (i >= text.length) return false;
      if (!validReferences(text.slice(valueStart, i))) return false;
      i++;
    }
    return true;
  };
  try {
    let i = 0;
    while (i < content.length) {
      const start = content.indexOf("<", i);
      if (start < 0) {
        if ((stack.length === 0 && content.slice(i).trim()) || content.slice(i).includes("]]>")
          || !validReferences(content.slice(i))) {
          return { valid: false, elementQNames };
        }
        break;
      }
      const text = content.slice(i, start);
      if ((stack.length === 0 && text.trim()) || text.includes("]]>") || !validReferences(text)) {
        return { valid: false, elementQNames };
      }
      if (content.startsWith("<!--", start)) {
        const end = content.indexOf("-->", start + 4);
        if (end < 0 || content.slice(start + 4, end).includes("--")) return { valid: false, elementQNames };
        i = end + 3; continue;
      }
      if (content.startsWith("<![CDATA[", start)) {
        if (stack.length === 0) return { valid: false, elementQNames };
        const end = content.indexOf("]]>", start + 9);
        if (end < 0) return { valid: false, elementQNames };
        i = end + 3; continue;
      }
      if (content.startsWith("<?", start)) {
        const end = findBoundary(start + 2, "?>");
        if (end < 0) return { valid: false, elementQNames };
        const body = content.slice(start + 2, end).trim();
        const target = body.split(/\s/, 1)[0];
        if (!qname.test(target)) return { valid: false, elementQNames };
        if (target.toLowerCase() === "xml") {
          const declarationOffset = content.charCodeAt(0) === 0xfeff ? 1 : 0;
          if (target !== "xml" || xmlDeclarationSeen || start !== declarationOffset || rootElements > 0) {
            return { valid: false, elementQNames };
          }
          if (!validAttributes(body.slice(target.length))) return { valid: false, elementQNames };
          xmlDeclarationSeen = true;
        }
        i = end + 2; continue;
      }
      if (/^<!DOCTYPE(?:\s|>)/i.test(content.slice(start))) {
        // External/internal entity semantics are deliberately outside this
        // diagnostic. Reject DTD evidence rather than interpreting it.
        return { valid: false, elementQNames };
      }
      if (content.startsWith("<!", start)) return { valid: false, elementQNames };
      const end = findBoundary(start + 1, ">");
      if (end < 0) return { valid: false, elementQNames };
      let body = content.slice(start + 1, end).trim();
      const closing = body.startsWith("/");
      if (closing) body = body.slice(1).trim();
      const selfClosing = !closing && body.endsWith("/");
      if (selfClosing) body = body.slice(0, -1).trimEnd();
      const nameMatch = body.match(/^([^\s]+)([\s\S]*)$/);
      if (!nameMatch || !qname.test(nameMatch[1])) return { valid: false, elementQNames };
      const name = nameMatch[1];
      const remainder = nameMatch[2];
      if (closing) {
        if (remainder.trim() || selfClosing || stack.pop() !== name) return { valid: false, elementQNames };
        if (stack.length === 0) rootEnded = true;
      } else {
        if (!validAttributes(remainder)) return { valid: false, elementQNames };
        if (stack.length === 0) {
          if (rootEnded) return { valid: false, elementQNames };
          rootElements++;
        }
        elementQNames.push(name);
        if (!selfClosing) stack.push(name);
        else if (stack.length === 0) rootEnded = true;
      }
      i = end + 1;
    }
  } catch {
    return { valid: false, elementQNames };
  }
  return { valid: stack.length === 0 && rootElements === 1, elementQNames };
}

export function validateInfoTableCompleteness(content: string, parsed: ReturnType<typeof parseInfoTableXml>): {
  complete: boolean;
  discoveredRows: number;
} {
  const structure = validateXmlStructure(content);
  const localName = (name: string) => name.split(":").pop()?.toLowerCase();
  const rootOpen = structure.elementQNames.filter((name) => localName(name) === "informationtable").length;
  const rowOpen = structure.elementQNames.filter((name) => localName(name) === "infotable").length;
  const complete = structure.valid && rootOpen === 1
    && parsed.holdings.length + parsed.skippedRows === rowOpen
    && parsed.skippedRows === 0
    && parsed.parseWarnings.length === 0;
  return { complete, discoveredRows: rowOpen };
}

export function normalizeSourceHoldingValue(
  row: ParsedHolding,
  filingDate: string,
): {
  holding: ParsedHolding;
  rawAsFiledReportedValue: number | null;
  sourceReportedValueUnit: "THOUSANDS_USD" | "USD";
  normalizedReportedValueUsd: number | null;
} {
  const unit = filingDate >= "2023-01-03" ? "USD" : "THOUSANDS_USD";
  const raw = row.reportedValue;
  const normalized = raw == null ? null : unit === "USD" ? raw : raw * 1000;
  return {
    holding: { ...row, reportedValue: normalized },
    rawAsFiledReportedValue: raw,
    sourceReportedValueUnit: unit,
    normalizedReportedValueUsd: normalized,
  };
}

async function sourceRowsForAccession(
  accessionNumber: string,
  filerCik: string,
  groups: ProductionDiagnosticGroup[],
  fetchText: SecTextFetcher,
): Promise<Map<ProductionDiagnosticGroup, { rows: SourceRowEvidence[]; error: string | null; complete: boolean }>> {
  const out = new Map<ProductionDiagnosticGroup, { rows: SourceRowEvidence[]; error: string | null; complete: boolean }>(
    groups.map((group) => [group, { rows: [], error: null, complete: true }]),
  );
  try {
    if (!/^\d{18}$/.test(accessionNumber) || !/^\d+$/.test(filerCik)) {
      throw new Error("SOURCE_FILING_IDENTITY_INVALID");
    }
    const indexUrl = filingIndexUrl(filerCik, accessionNumber);
    assertSecGovUrl(indexUrl);
    const filename = findInfoTableDocumentFilename(await fetchText(indexUrl));
    if (!filename || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.(xml)$/i.test(filename)) {
      throw new Error("INFOTABLE_DOCUMENT_FILENAME_REJECTED");
    }
    const documentUrl = filingDocUrl(filerCik, accessionNumber, filename);
    assertSecGovUrl(documentUrl);
    const content = await fetchText(documentUrl);
    if (!isInfoTableXml(content)) throw new Error("INFOTABLE_DOCUMENT_CONTENT_REJECTED");
    const parsed = parseInfoTableXml(content);
    const completeness = validateInfoTableCompleteness(content, parsed);
    for (const group of groups) {
      const matches = parsed.holdings
        .map((row, rowOrdinal) => ({ row, rowOrdinal }))
        .map(({ row, rowOrdinal }) => ({ ...normalizeSourceHoldingValue(row, group.filingDate), rowOrdinal }))
        .filter(({ holding }) => sourceRowMatchesGroup(holding, group))
        .map(({ holding, rawAsFiledReportedValue, sourceReportedValueUnit, normalizedReportedValueUsd, rowOrdinal }) => ({
          ...holding, rawAsFiledReportedValue, sourceReportedValueUnit, normalizedReportedValueUsd,
          accessionNumber, documentFilename: filename, rowOrdinal: rowOrdinal + 1, nativeId: null,
        }));
      out.set(group, { rows: matches, error: null, complete: completeness.complete && Boolean(group.filingDate) });
    }
  } catch (error: any) {
    const message = String(error?.message ?? error).slice(0, 300);
    for (const group of groups) out.set(group, { rows: [], error: message, complete: false });
  }
  return out;
}

export function deriveSymbolStatus(findings: GroupFinding[]): Record<string, string> {
  return Object.fromEntries(PRODUCTION_SOURCE_IDENTITY_TARGETS.map(({ symbol }) => {
    const classifications = findings.filter((finding) => finding.symbol === symbol).map((finding) => finding.classification);
    const status = classifications.includes("INGESTION_OR_PERSISTENCE_DUPLICATION_CONFIRMED")
      ? "BLOCKED_BY_CONFIRMED_DUPLICATION"
      : classifications.includes("SOURCE_UNAVAILABLE") || classifications.includes("SOURCE_MATCH_AMBIGUOUS")
        ? "BLOCKED_BY_UNRESOLVED_PROVENANCE"
        : "SAFE_FOR_CURRENT_REPAIR";
    return [symbol, status];
  }));
}

/** Sequential by accession: bounded SEC traffic and no broad ingestion path. */
export async function runProductionSourceIdentityDiagnostic(
  executor: SqlExecutor,
  fetchText: SecTextFetcher,
): Promise<{
  findings: GroupFinding[];
  symbolStatus: Record<string, string>;
  conditionalAggregateImpact: Record<string, unknown>;
  summary: Record<string, unknown>;
}> {
  const groups = await loadProductionDiagnosticGroups(executor);
  const bySymbol = Object.fromEntries(PRODUCTION_SOURCE_IDENTITY_TARGETS.map(({ symbol }) => [symbol, groups.filter((g) => g.symbol === symbol).length]));
  if (groups.length !== EXPECTED_UNRESOLVED_GROUPS || bySymbol.AAPL !== 6 || bySymbol.NVDA !== 13
    || bySymbol.MSFT !== 11 || bySymbol.COST !== 0) {
    throw new Error(`DIAGNOSTIC_SCOPE_REJECTED:EXPECTED_30_AAPL_NVDA_MSFT_AND_COST_0:${JSON.stringify(bySymbol)}`);
  }
  const findings: GroupFinding[] = [];
  const byAccession = new Map<string, ProductionDiagnosticGroup[]>();
  for (const group of groups) byAccession.set(group.accessionNumber, [...(byAccession.get(group.accessionNumber) ?? []), group]);
  for (const [accession, accessionGroups] of Array.from(byAccession.entries())) {
    const evidence = await sourceRowsForAccession(accession, accessionGroups[0].filerCik, accessionGroups, fetchText);
    for (const group of accessionGroups) {
      const result = evidence.get(group)!;
      findings.push({
        ...group, sourceRows: result.rows, sourceError: result.error,
        sourceMatchCount: result.error ? null : result.rows.length,
        classification: classifySourceMatch(result.error ? null : result.rows.length, group.physicalRows, result.complete),
        conditionalRedundantRows: group.physicalRows - 1,
        conditionalRedundantShares: (group.reportedShares ?? 0) * (group.physicalRows - 1),
        conditionalRedundantReportedValue: group.reportedValue == null ? null : group.reportedValue * (group.physicalRows - 1),
      });
    }
  }
  const confirmed = findings.filter((f) => f.classification === "INGESTION_OR_PERSISTENCE_DUPLICATION_CONFIRMED");
  const classificationCounts = Object.fromEntries(
    (["SOURCE_ROWS_CONFIRM_MULTIPLE", "INGESTION_OR_PERSISTENCE_DUPLICATION_CONFIRMED", "SOURCE_MATCH_AMBIGUOUS", "SOURCE_UNAVAILABLE"] as const)
      .map((classification) => [classification, findings.filter((finding) => finding.classification === classification).length]),
  );
  return {
    findings,
    symbolStatus: deriveSymbolStatus(findings),
    conditionalAggregateImpact: {
      potentialIfStoredRowsAreDuplicate: {
        rows: findings.reduce((sum, f) => sum + f.conditionalRedundantRows, 0),
        shares: findings.reduce((sum, f) => sum + f.conditionalRedundantShares, 0),
        reportedValueUsd: findings.reduce((sum, f) => sum + (f.conditionalRedundantReportedValue ?? 0), 0),
      },
      confirmedIngestionOrPersistenceDuplication: {
        rows: confirmed.reduce((sum, f) => sum + f.conditionalRedundantRows, 0),
        shares: confirmed.reduce((sum, f) => sum + f.conditionalRedundantShares, 0),
        reportedValueUsd: confirmed.reduce((sum, f) => sum + (f.conditionalRedundantReportedValue ?? 0), 0),
      },
      valueUnit: "CANONICAL_USD",
    },
    summary: {
      uniqueSourceFilingsExamined: byAccession.size,
      sourceIdentityMethod: "accession_number + information-table document filename + one-based parsed row ordinal; nativeId is null unless supplied by source",
      sourceIdentityAvailability: findings.some((f) =>
        f.classification === "SOURCE_UNAVAILABLE" || f.classification === "SOURCE_MATCH_AMBIGUOUS")
        ? "PARTIAL_OR_UNRESOLVED" : "AVAILABLE",
      classificationCounts,
      perSymbolFindings: Object.fromEntries(PRODUCTION_SOURCE_IDENTITY_TARGETS.map(({ symbol }) => [
        symbol, findings.filter((finding) => finding.symbol === symbol).length,
      ])),
      conditionalImpactBySymbol: Object.fromEntries(PRODUCTION_SOURCE_IDENTITY_TARGETS.map(({ symbol }) => [
        symbol, {
          potentialRows: findings.filter((f) => f.symbol === symbol).reduce((sum, f) => sum + f.conditionalRedundantRows, 0),
          confirmedRows: confirmed.filter((f) => f.symbol === symbol).reduce((sum, f) => sum + f.conditionalRedundantRows, 0),
          potentialReportedValueUsd: findings.filter((f) => f.symbol === symbol).reduce((sum, f) => sum + (f.conditionalRedundantReportedValue ?? 0), 0),
          confirmedReportedValueUsd: confirmed.filter((f) => f.symbol === symbol).reduce((sum, f) => sum + (f.conditionalRedundantReportedValue ?? 0), 0),
        },
      ])),
    },
  };
}