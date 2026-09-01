import { describe, expect, it } from "vitest";
import AdmZip from "adm-zip";
import {
  classifySecArchiveFailure,
  parseBulkQuarterFromBuffer,
  validateSecArchiveResponse,
} from "../sec-13f-bulk-parser";
import { SecHttpError } from "../sec-client";
import {
  parseCatalogHtml,
  resolveCatalogQuarterRange,
} from "../sec-dataset-catalog";
import {
  parseHistoricalBackfillArgs,
  validateHistoricalBackfillEnvironment,
} from "../../../../scripts/run-institutional-backfill";
import { classifyHistoricalSource } from "../../../../scripts/audit-institutional-historical-coverage";

describe("historical SEC source classification", () => {
  it("classifies redirect, 403, 429, and 404 fail-closed", () => {
    expect(classifySecArchiveFailure(new SecHttpError(302, "https://www.sec.gov/a", null, 0, "https://www.sec.gov/a", true)))
      .toBe("SOURCE_FORMAT_UNEXPECTED");
    expect(classifySecArchiveFailure(new SecHttpError(403, "https://www.sec.gov/a"))).toBe("SOURCE_REJECTED");
    expect(classifySecArchiveFailure(new SecHttpError(429, "https://www.sec.gov/a"))).toBe("RATE_LIMITED");
    expect(classifySecArchiveFailure(new SecHttpError(404, "https://www.sec.gov/a"))).toBe("SOURCE_UNAVAILABLE");
  });

  it("rejects HTML, zero bytes, wrong MIME, and malformed archives", () => {
    expect(validateSecArchiveResponse("text/html", Buffer.from("<html>denied</html>"))).toBe("SOURCE_FORMAT_UNEXPECTED");
    expect(validateSecArchiveResponse("application/octet-stream", Buffer.alloc(0))).toBe("SOURCE_FORMAT_UNEXPECTED");
    expect(validateSecArchiveResponse("text/plain", Buffer.from("PK\u0003\u0004"))).toBe("SOURCE_FORMAT_UNEXPECTED");
    expect(validateSecArchiveResponse("application/zip", Buffer.from("not zip"))).toBe("SOURCE_FORMAT_UNEXPECTED");
  });

  it("accepts a valid ZIP response and the parser reads a valid archive", () => {
    const zip = new AdmZip();
    const accession = "0001234567-26-000001";
    zip.addFile("SUBMISSION.tsv", Buffer.from(
      "ACCESSION-NUMBER\tCIK\tNAME\tFORM-TYPE\tFILING-DATE\tCONFORMED-PERIOD-OF-REPORT\n" +
      `${accession}\t0001234567\tTEST FUND\t13F-HR\t2026-05-01\t2026-03-31`,
    ));
    zip.addFile("INFOTABLE.tsv", Buffer.from(
      "ACCESSION-NUMBER\tNAMEOFISSUER\tTITLEOFCLASS\tCUSIP\tVALUE\tSSHPRNAMT\tSSHPRNAMTTYPE\n" +
      `${accession}\tTEST INC\tCOM\t037833100\t1000\t10\tSH`,
    ));
    const buffer = zip.toBuffer();
    expect(validateSecArchiveResponse("application/octet-stream", buffer)).toBeNull();
    expect(parseBulkQuarterFromBuffer(buffer, 2026, 1).status).toBe("success");
  });
});

describe("catalog range and guarded backfill", () => {
  const catalog = parseCatalogHtml(`
    <a href="/files/structureddata/data/form-13f-data-sets/01jun2024-31aug2024_form13f.zip">Q2</a>
    <a href="/files/structureddata/data/form-13f-data-sets/01mar2024-31may2024_form13f.zip">Q1</a>
  `);

  it("resolves explicit ranges oldest-first without constructing URLs", () => {
    const result = resolveCatalogQuarterRange("2024-Q1", "2024-Q2", catalog);
    expect(result.missingQuarterLabels).toEqual([]);
    expect(result.descriptors.map((item) => item.fileName)).toEqual([
      "01mar2024-31may2024_form13f.zip",
      "01jun2024-31aug2024_form13f.zip",
    ]);
  });

  it("reports missing catalog quarters instead of guessing", () => {
    const result = resolveCatalogQuarterRange("2024-Q1", "2024-Q3", catalog);
    expect(result.missingQuarterLabels).toEqual(["2024-Q3"]);
  });

  it("is dry-run by default and requires an explicit range", () => {
    expect(parseHistoricalBackfillArgs(["--from-quarter", "2024-Q1", "--to-quarter", "2024-Q2"]))
      .toEqual({ fromQuarter: "2024-Q1", toQuarter: "2024-Q2", apply: false });
    expect(() => parseHistoricalBackfillArgs(["--from-quarter", "2024-Q1"])).toThrow("EXPLICIT_QUARTER_RANGE_REQUIRED");
  });

  it("requires production identity and rejects EXTERNAL_DATABASE_URL", () => {
    expect(() => validateHistoricalBackfillEnvironment({
      NODE_ENV: "production",
      RAILWAY_ENVIRONMENT_NAME: "production",
      DATABASE_URL: "postgres://redacted",
      EXTERNAL_DATABASE_URL: "postgres://redacted",
    })).toThrow("EXTERNAL_DATABASE_URL_FORBIDDEN");
    expect(() => validateHistoricalBackfillEnvironment({
      NODE_ENV: "development",
      RAILWAY_ENVIRONMENT_NAME: "production",
      DATABASE_URL: "postgres://redacted",
    })).toThrow("PRODUCTION_NODE_ENV_REQUIRED");
  });
});

describe("historical coverage source status", () => {
  const today = new Date("2026-09-01T00:00:00Z");
  it("distinguishes available, failed, missing, and not-yet-published", () => {
    expect(classifyHistoricalSource({ catalogAvailable: true, latestRunStatus: "completed", latestRunErrorCode: null, quarterEnd: "2025-12-31", today }))
      .toBe("SOURCE_AVAILABLE");
    expect(classifyHistoricalSource({ catalogAvailable: true, latestRunStatus: "failed", latestRunErrorCode: "SOURCE_REJECTED", quarterEnd: "2025-12-31", today }))
      .toBe("SOURCE_FAILED");
    expect(classifyHistoricalSource({ catalogAvailable: false, latestRunStatus: null, latestRunErrorCode: null, quarterEnd: "2025-12-31", today }))
      .toBe("SOURCE_MISSING");
    expect(classifyHistoricalSource({ catalogAvailable: false, latestRunStatus: null, latestRunErrorCode: null, quarterEnd: "2026-09-30", today }))
      .toBe("NOT_YET_PUBLISHED");
  });
});