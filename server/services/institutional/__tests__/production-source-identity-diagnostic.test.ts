import { describe, expect, it } from "vitest";
import {
  assertSecGovUrl,
  classifySourceMatch,
  deriveSymbolStatus,
  loadProductionDiagnosticGroups,
  normalizePgDate,
  normalizeSourceHoldingValue,
  runProductionSourceIdentityDiagnostic,
  sourceRowMatchesGroup,
  validateXmlStructure,
  type GroupFinding,
} from "../production-source-identity-diagnostic";
import { filingIndexUrl } from "../sec-client";

const base = {
  accession_number: "000000000124000001", filer_cik: "0000000001", cusip: "037833100",
  filer_name: "MANAGER", filing_type: "13F-HR", filing_date: "2024-05-01",
  period_of_report: "2024-03-31", is_effective: true, amendment_flag: false,
  amendment_number: null, amendment_type: null,
  issuer_name: "APPLE INC", class_title: "COM", figi: null, reported_value: 10,
  reported_shares: 20, shares_prn_type: "SH", investment_discretion: "SOLE",
  other_manager: null, voting_sole: 20, voting_shared: 0, voting_none: 0, physical_rows: 2,
};
function xml(rows: number): string {
  return `<?xml version="1.0"?><informationTable>${Array.from({ length: rows }, () =>
    `<infoTable><nameOfIssuer>APPLE INC</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>037833100</cusip><value>10</value><shrsOrPrnAmt><sshPrnamt>20</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt><investmentDiscretion>SOLE</investmentDiscretion><votingAuthority><Sole>20</Sole><Shared>0</Shared><None>0</None></votingAuthority></infoTable>`).join("")}</informationTable>`;
}
function groups(count = 30) {
  const targets = [
    ...Array(6).fill(["037833100", "APPLE INC"]),
    ...Array(13).fill(["67066G104", "NVIDIA CORPORATION"]),
    ...Array(11).fill(["594918104", "MICROSOFT CORPORATION"]),
  ];
  return targets.slice(0, count).map(([cusip, issuer_name], index) => ({
    ...base, cusip, issuer_name, accession_number: `000000000124${String(index).padStart(6, "0")}`,
  }));
}

describe("production source identity diagnostic", () => {
  it("classifies all required source outcomes and rejects non-SEC URLs", () => {
    expect(classifySourceMatch(2, 2)).toBe("SOURCE_ROWS_CONFIRM_MULTIPLE");
    expect(classifySourceMatch(1, 2)).toBe("INGESTION_OR_PERSISTENCE_DUPLICATION_CONFIRMED");
    expect(classifySourceMatch(0, 2)).toBe("SOURCE_MATCH_AMBIGUOUS");
    expect(classifySourceMatch(null, 2)).toBe("SOURCE_UNAVAILABLE");
    expect(classifySourceMatch(2, 3)).toBe("INGESTION_OR_PERSISTENCE_DUPLICATION_CONFIRMED");
    expect(classifySourceMatch(3, 2)).toBe("SOURCE_MATCH_AMBIGUOUS");
    expect(() => assertSecGovUrl("http://www.sec.gov/x")).toThrow("SEC_URL_REJECTED");
    expect(() => assertSecGovUrl("https://evil.example/x")).toThrow("SEC_URL_REJECTED");
    expect(() => assertSecGovUrl("https://www.sec.gov/Archives/x")).not.toThrow();
  });

  it("matches persisted material fields exactly, including nulls", () => {
    const group: any = {
      accessionNumber: "a", filerCik: "1", symbol: "AAPL", cusip: "037833100",
      issuerName: "APPLE INC", classTitle: "COM", figi: null, reportedValue: 10,
      reportedShares: 20, sharesPrnType: "SH", investmentDiscretion: "SOLE",
      otherManager: null, votingSole: 20, votingShared: 0, votingNone: 0, physicalRows: 2,
    };
    expect(sourceRowMatchesGroup({
      issuerName: "APPLE INC", classTitle: "COM", cusip: "037833100", figi: null, reportedValue: 10,
      reportedShares: 20, sharesPrnType: "SH", putCall: null, investmentDiscretion: "SOLE",
      otherManager: null, votingSole: 20, votingShared: 0, votingNone: 0,
    }, group)).toBe(true);
    expect(sourceRowMatchesGroup({
      issuerName: "APPLE INC", classTitle: "COM", cusip: "037833100", figi: null, reportedValue: 10,
      reportedShares: 21, sharesPrnType: "SH", putCall: null, investmentDiscretion: "SOLE",
      otherManager: null, votingSole: 20, votingShared: 0, votingNone: 0,
    }, group)).toBe(false);
  });

  it("uses a captured SELECT-only executor, dedupes full accessions, and confirms ingestion duplication", async () => {
    const seen: unknown[] = [];
    const requests: string[] = [];
    const report = await runProductionSourceIdentityDiagnostic({
      async execute(query) { seen.push(query); return { rows: groups().map((group) => ({ ...group, accession_number: "000000000124999999" })) }; },
    }, async (url) => {
      requests.push(url);
      return url.endsWith("-index.html")
      ? `<a href="infotable.xml">Information Table</a>` : xml(1);
    });
    expect(report.findings).toHaveLength(30);
    expect(report.findings.filter((f) => f.symbol === "AAPL").every((f) => f.classification === "INGESTION_OR_PERSISTENCE_DUPLICATION_CONFIRMED")).toBe(true);
    expect(report.findings[0].sourceRows[0]).toEqual(expect.objectContaining({
      accessionNumber: expect.any(String), documentFilename: "infotable.xml", rowOrdinal: 1, nativeId: null,
    }));
    expect(seen).toHaveLength(1);
    expect(requests).toHaveLength(2);
    const queryText = JSON.stringify(seen[0]).toUpperCase();
    expect(queryText).toContain("SELECT");
    expect(queryText).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/);
  });

  it("reports source multiple rows independently from confirmed stored duplication", async () => {
    const report = await runProductionSourceIdentityDiagnostic(
      { async execute() { return { rows: groups() }; } },
      async (url) => url.endsWith("-index.html") ? `<a href="infotable.xml">Information Table</a>` : xml(2),
    );
    expect(report.findings.filter((f) => f.symbol === "AAPL").every((f) => f.classification === "SOURCE_ROWS_CONFIRM_MULTIPLE")).toBe(true);
    expect(report.conditionalAggregateImpact.confirmedIngestionOrPersistenceDuplication).toEqual({
      rows: 0, shares: 0, reportedValueUsd: 0,
    });
  });

  it("fails closed when the returned repair scope is not exactly 30 AAPL/NVDA/MSFT and COST zero", async () => {
    await expect(runProductionSourceIdentityDiagnostic(
      { async execute() { return { rows: groups(29) }; } }, async () => "",
    )).rejects.toThrow("DIAGNOSTIC_SCOPE_REJECTED");
  });

  it("reports unavailable SEC source and ambiguous incomplete/no-match source evidence", async () => {
    const unavailable = await runProductionSourceIdentityDiagnostic(
      { async execute() { return { rows: groups() }; } },
      async () => { throw new Error("SEC unavailable"); },
    );
    expect(unavailable.findings.every((finding) => finding.classification === "SOURCE_UNAVAILABLE")).toBe(true);
    const incompleteXml = `${xml(1).replace("</informationTable>", "")}<infoTable><cusip>037833100</cusip></infoTable></informationTable>`;
    const ambiguous = await runProductionSourceIdentityDiagnostic(
      { async execute() { return { rows: groups() }; } },
      async (url) => url.endsWith("-index.html") ? `<a href="infotable.xml">Information Table</a>` : incompleteXml,
    );
    expect(ambiguous.findings.find((finding) => finding.symbol === "AAPL")?.classification).toBe("SOURCE_MATCH_AMBIGUOUS");
  });

  it("rejects traversal filenames and non-InfoTable document content before reconciliation", async () => {
    const traversal = await runProductionSourceIdentityDiagnostic(
      { async execute() { return { rows: groups() }; } },
      async () => `<a href="../infotable.xml">Information Table</a>`,
    );
    expect(traversal.findings.every((finding) => finding.classification === "SOURCE_UNAVAILABLE")).toBe(true);
    const wrongContent = await runProductionSourceIdentityDiagnostic(
      { async execute() { return { rows: groups() }; } },
      async (url) => url.endsWith("-index.html") ? `<a href="infotable.xml">Information Table</a>` : "<html>not an Information Table</html>",
    );
    expect(wrongContent.findings.every((finding) => finding.classification === "SOURCE_UNAVAILABLE")).toBe(true);
  });

  it("treats an unclosed trailing source row as ambiguous even after two valid matches", async () => {
    const truncated = xml(2).replace("</informationTable>", "")
      + "<infoTable><nameOfIssuer>APPLE INC</nameOfIssuer>";
    const report = await runProductionSourceIdentityDiagnostic(
      { async execute() { return { rows: groups() }; } },
      async (url) => url.endsWith("-index.html") ? `<a href="infotable.xml">Information Table</a>` : truncated,
    );
    expect(report.findings.find((finding) => finding.symbol === "AAPL")?.sourceMatchCount).toBe(2);
    expect(report.findings.find((finding) => finding.symbol === "AAPL")?.classification).toBe("SOURCE_MATCH_AMBIGUOUS");
  });

  it("rejects crossing XML tags as ambiguous despite otherwise valid matching rows", async () => {
    const crossing = xml(2).replace("</informationTable>", "<outer><inner></outer></inner></informationTable>");
    expect(validateXmlStructure(crossing).valid).toBe(false);
    expect(validateXmlStructure(`<?xml version="1.0"?><r a="x&gt;y&#x20;"><!-- <fake> --><![CDATA[<fake>]]><n/>&amp;&#65;</r>`).valid).toBe(true);
    const report = await runProductionSourceIdentityDiagnostic(
      { async execute() { return { rows: groups() }; } },
      async (url) => url.endsWith("-index.html") ? `<a href="infotable.xml">Information Table</a>` : crossing,
    );
    const aapl = report.findings.find((finding) => finding.symbol === "AAPL");
    expect(aapl?.sourceMatchCount).toBe(2);
    expect(aapl?.classification).toBe("SOURCE_MATCH_AMBIGUOUS");
    expect(report.symbolStatus.AAPL).toBe("BLOCKED_BY_UNRESOLVED_PROVENANCE");
  });

  it("rejects trailing DOCTYPE and malformed entity evidence as ambiguous and blocked", async () => {
    const malformedDocuments = [
      `${xml(2)}<!DOCTYPE informationTable>`,
      xml(2).replace("</informationTable>", "<note>malformed &unknown;</note></informationTable>"),
    ];
    for (const document of malformedDocuments) {
      expect(validateXmlStructure(document).valid).toBe(false);
      const report = await runProductionSourceIdentityDiagnostic(
        { async execute() { return { rows: groups() }; } },
        async (url) => url.endsWith("-index.html") ? `<a href="infotable.xml">Information Table</a>` : document,
      );
      const aapl = report.findings.find((finding) => finding.symbol === "AAPL");
      expect(aapl?.sourceMatchCount).toBe(2);
      expect(aapl?.classification).toBe("SOURCE_MATCH_AMBIGUOUS");
      expect(report.symbolStatus.AAPL).toBe("BLOCKED_BY_UNRESOLVED_PROVENANCE");
    }
  });

  it("normalizes pre-cutoff source thousands to canonical USD and leaves post-cutoff USD unchanged", () => {
    const holding: any = {
      issuerName: "X", classTitle: "COM", cusip: "123456789", figi: null,
      reportedValue: 1234, reportedShares: 1, sharesPrnType: "SH", putCall: null,
      investmentDiscretion: null, otherManager: null, votingSole: 1, votingShared: 0, votingNone: 0,
    };
    expect(normalizeSourceHoldingValue(holding, "2023-01-02")).toEqual(expect.objectContaining({
      rawAsFiledReportedValue: 1234, sourceReportedValueUnit: "THOUSANDS_USD",
      normalizedReportedValueUsd: 1_234_000,
    }));
    expect(normalizeSourceHoldingValue(holding, "2023-01-03")).toEqual(expect.objectContaining({
      sourceReportedValueUnit: "USD", normalizedReportedValueUsd: 1234,
    }));
    expect(normalizePgDate(new Date("2024-05-01T23:00:00Z"))).toBe("2024-05-01");
    expect(normalizePgDate("2024-05-01 00:00:00+00")).toBe("2024-05-01");
  });

  it("derives a symbol status without relying on a global classification", () => {
    const finding = (symbol: string, classification: any) => ({ symbol, classification }) as GroupFinding;
    expect(deriveSymbolStatus([
      finding("AAPL", "SOURCE_ROWS_CONFIRM_MULTIPLE"),
      finding("NVDA", "SOURCE_UNAVAILABLE"),
      finding("MSFT", "INGESTION_OR_PERSISTENCE_DUPLICATION_CONFIRMED"),
    ])).toEqual({
      AAPL: "SAFE_FOR_CURRENT_REPAIR", NVDA: "BLOCKED_BY_UNRESOLVED_PROVENANCE",
      MSFT: "BLOCKED_BY_CONFIRMED_DUPLICATION", COST: "SAFE_FOR_CURRENT_REPAIR",
    });
  });

  it("uses SEC's strict 10-2-6 index filename convention", () => {
    expect(filingIndexUrl("0001364742", "000136474224000007")).toBe(
      "https://www.sec.gov/Archives/edgar/data/1364742/000136474224000007/0001364742-24-000007-index.html",
    );
    expect(() => filingIndexUrl("bad", "000136474224000007")).toThrow("SEC_CIK_INVALID");
    expect(() => filingIndexUrl("1", "123")).toThrow("SEC_ACCESSION_INVALID");
  });

  it.runIf(Boolean(process.env.DATABASE_URL))(
    "executes the exact repair-scope SELECT against PostgreSQL without ambiguous columns",
    async () => {
      const { db } = await import("../../../db");
      await expect(loadProductionDiagnosticGroups(db)).resolves.toEqual(expect.any(Array));
    },
  );
});