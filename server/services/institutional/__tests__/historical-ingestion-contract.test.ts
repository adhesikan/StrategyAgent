import { describe, expect, it } from "vitest";
import AdmZip from "adm-zip";
import { readFileSync } from "node:fs";
import {
  classifySecArchiveFailure,
  parseBulkQuarterFromBuffer,
  streamBulkQuarterFromBuffer,
  type BulkParseResult,
  validateSecArchiveResponse,
} from "../sec-13f-bulk-parser";
import { SecHttpError } from "../sec-client";
import {
  parseCatalogHtml,
  resolveCatalogQuarterRange,
} from "../sec-dataset-catalog";
import {
  buildAccessionOverlap,
  buildDryRunQuarterPlan,
  buildStreamingDryRunPlan,
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

describe("bounded historical INFOTABLE streaming", () => {
  function makeArchive(accessionOrder: string[], rowsPerAccession: number): Buffer {
    const zip = new AdmZip();
    const unique = Array.from(new Set(accessionOrder));
    zip.addFile("SUBMISSION.tsv", Buffer.from(
      "ACCESSION-NUMBER\tCIK\tNAME\tFORM-TYPE\tFILING-DATE\tCONFORMED-PERIOD-OF-REPORT\n" +
      unique.map((accession, index) =>
        `${accession}\t${String(index + 1).padStart(10, "0")}\tFUND ${index}\t${index === 1 ? "13F-HR/A" : "13F-HR"}\t2024-05-01\t2024-03-31`,
      ).join("\n"),
    ));
    const rows = ["ACCESSION-NUMBER\tNAMEOFISSUER\tTITLEOFCLASS\tCUSIP\tVALUE\tSSHPRNAMT\tSSHPRNAMTTYPE"];
    for (const accession of accessionOrder) {
      for (let index = 0; index < rowsPerAccession; index++) {
        rows.push(`${accession}\tISSUER ${index}\tCOM\t${String(index).padStart(9, "0")}\t1000\t10\tSH`);
      }
    }
    zip.addFile("INFOTABLE.tsv", Buffer.from(rows.join("\n")));
    return zip.toBuffer();
  }

  function mutateCentralEntry(
    archive: Buffer,
    entryName: string,
    mutate: (buffer: Buffer, centralOffset: number, localOffset: number) => void,
  ): Buffer {
    const buffer = Buffer.from(archive);
    for (let offset = 0; offset <= buffer.length - 46; offset++) {
      if (buffer.readUInt32LE(offset) !== 0x02014b50) continue;
      const nameLength = buffer.readUInt16LE(offset + 28);
      const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
      if (name === entryName) {
        mutate(buffer, offset, buffer.readUInt32LE(offset + 42));
        return buffer;
      }
    }
    throw new Error(`Missing central entry ${entryName}`);
  }

  it("processes high-volume-like input with serial bounded batches and no full population result", async () => {
    const accessions = Array.from({ length: 250 }, (_, index) =>
      `${String(index + 1).padStart(10, "0")}-24-${String(index + 1).padStart(6, "0")}`,
    );
    const batchSizes: number[] = [];
    let active = 0;
    let maxActive = 0;
    let totalRows = 0;
    const result = await streamBulkQuarterFromBuffer(
      makeArchive(accessions, 200),
      2024,
      1,
      {
        batchSize: 2_000,
        async onBatch(batch) {
          active++;
          maxActive = Math.max(maxActive, active);
          batchSizes.push(batch.length);
          totalRows += batch.length;
          await Promise.resolve();
          active--;
        },
      },
    );
    expect(result.status).toBe("success");
    expect(totalRows).toBe(50_000);
    expect(result.diagnostics.joinedHoldingRows).toBe(50_000);
    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(2_000);
    expect(batchSizes.length).toBeGreaterThan(1);
    expect(maxActive).toBe(1);
    expect("holdings" in result).toBe(false);
  }, 20_000);

  it("validates streamed CRC and uncompressed size for a valid archive", async () => {
    const result = await streamBulkQuarterFromBuffer(
      makeArchive(["0000000001-24-000001"], 3),
      2024,
      1,
      { onBatch() {} },
    );
    expect(result.status).toBe("success");
  });

  it("fails closed on a streamed CRC mismatch", async () => {
    const archive = mutateCentralEntry(
      makeArchive(["0000000001-24-000001"], 3),
      "INFOTABLE.tsv",
      (buffer, centralOffset) => buffer.writeUInt32LE((buffer.readUInt32LE(centralOffset + 16) ^ 0xffffffff) >>> 0, centralOffset + 16),
    );
    const result = await streamBulkQuarterFromBuffer(archive, 2024, 1, { onBatch() {} });
    expect(result).toMatchObject({ status: "failed", failureCode: "SOURCE_INTEGRITY_FAILURE" });
  });

  it("fails closed when declared uncompressed size is wrong", async () => {
    const archive = mutateCentralEntry(
      makeArchive(["0000000001-24-000001"], 3),
      "INFOTABLE.tsv",
      (buffer, centralOffset) => buffer.writeUInt32LE(buffer.readUInt32LE(centralOffset + 24) + 1, centralOffset + 24),
    );
    const result = await streamBulkQuarterFromBuffer(archive, 2024, 1, { onBatch() {} });
    expect(result).toMatchObject({ status: "failed", failureCode: "SOURCE_INTEGRITY_FAILURE" });
  });

  it("fails closed on truncated or malformed compressed entry data", async () => {
    const archive = mutateCentralEntry(
      makeArchive(["0000000001-24-000001"], 100),
      "INFOTABLE.tsv",
      (buffer, centralOffset) => buffer.writeUInt32LE(buffer.readUInt32LE(centralOffset + 20) - 2, centralOffset + 20),
    );
    const result = await streamBulkQuarterFromBuffer(archive, 2024, 1, { onBatch() {} });
    expect(result).toMatchObject({ status: "failed", failureCode: "SOURCE_INTEGRITY_FAILURE" });
  });

  it("fails closed when compressed entry bytes are malformed", async () => {
    const archive = mutateCentralEntry(
      makeArchive(["0000000001-24-000001"], 100),
      "INFOTABLE.tsv",
      (buffer, centralOffset, localOffset) => {
        const nameLength = buffer.readUInt16LE(localOffset + 26);
        const extraLength = buffer.readUInt16LE(localOffset + 28);
        const dataOffset = localOffset + 30 + nameLength + extraLength;
        const compressedSize = buffer.readUInt32LE(centralOffset + 20);
        const mutationOffset = dataOffset + Math.floor(compressedSize / 2);
        buffer[mutationOffset] ^= 0xff;
      },
    );
    const result = await streamBulkQuarterFromBuffer(archive, 2024, 1, { onBatch() {} });
    expect(result).toMatchObject({ status: "failed", failureCode: "SOURCE_INTEGRITY_FAILURE" });
  });

  it("stops emitting batches when cancellation occurs during parsing", async () => {
    const controller = new AbortController();
    let batches = 0;
    const result = await streamBulkQuarterFromBuffer(
      makeArchive(["0000000001-24-000001"], 5_000),
      2024,
      1,
      {
        batchSize: 100,
        signal: controller.signal,
        onBatch() {
          batches++;
          controller.abort();
        },
      },
    );
    expect(result).toMatchObject({ status: "failed", failureCode: "CANCELLED" });
    expect(batches).toBe(1);
  });

  it("fails closed when an accession reappears after another accession", async () => {
    const a = "0000000001-24-000001";
    const b = "0000000002-24-000002";
    let emitted = 0;
    const result = await streamBulkQuarterFromBuffer(
      makeArchive([a, b, a], 1),
      2024,
      1,
      { batchSize: 1, onBatch(batch) { emitted += batch.length; } },
    );
    expect(result.status).toBe("empty_parse_failure");
    expect(result.reason).toBe("INFOTABLE_ACCESSION_ORDER_VIOLATION");
    expect(emitted).toBeLessThan(3);
  });

  it("releases batch references before processing the next quarter", async () => {
    let retained: unknown[] | null = null;
    for (const accession of ["0000000001-24-000001", "0000000002-24-000002"]) {
      const result = await streamBulkQuarterFromBuffer(
        makeArchive([accession], 10),
        2024,
        1,
        { onBatch(batch) { retained = batch; } },
      );
      expect(result.status).toBe("success");
      expect(retained).toHaveLength(10);
      retained = null;
    }
    expect(retained).toBeNull();
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

  const descriptor = {
    downloadUrl: "https://www.sec.gov/files/structureddata/data/form-13f-data-sets/01mar2024-31may2024_form13f.zip",
    fileName: "01mar2024-31may2024_form13f.zip",
    windowStart: "2024-03-01",
    windowEnd: "2024-05-31",
    expectedPeriodOfReport: "2024-03-31",
    year: 2024,
    q: 1 as const,
  };
  const source = {
    status: "success",
    holdings: [
      { accessionNumber: "0000000001-24-000001", filingDate: "2024-05-01", isAmendment: false },
      { accessionNumber: "0000000001-24-000001", filingDate: "2024-05-01", isAmendment: false },
      { accessionNumber: "0000000002-24-000002", filingDate: "2024-05-02", isAmendment: true },
    ],
    diagnostics: {},
  } as BulkParseResult;

  it("projects a full backfill from the same accession population ingestion uses", () => {
    expect(buildDryRunQuarterPlan({
      descriptor,
      source,
      existingFilings: [],
      existingHoldingRows: [],
    })).toMatchObject({
      sourceFilings: 2,
      sourceHoldingRows: 3,
      filingsAlreadyPresent: 0,
      filingsToInsert: 2,
      filingsPotentiallyUpdated: 0,
      amendmentsToReconcile: 1,
      estimatedHoldingRowsToProcess: 3,
      downstreamAggregateRebuildRequired: true,
      downstreamSignalRebuildRequired: true,
      status: "FULL_BACKFILL_REQUIRED",
    });
  });

  it("projects partial and no-change reruns without inventing updates", () => {
    const existing = [{
      accessionNumber: "000000000124000001",
      amendmentFlag: false,
      filingDate: "2024-05-01",
      isEffective: true,
    }];
    expect(buildDryRunQuarterPlan({
      descriptor,
      source,
      existingFilings: existing,
      existingHoldingRows: [{ accessionNumber: "000000000124000001", holdingRows: 2 }],
    })).toMatchObject({
      filingsAlreadyPresent: 1,
      filingsToInsert: 1,
      amendmentsToReconcile: 1,
      estimatedHoldingRowsToProcess: 1,
      status: "PARTIAL_BACKFILL_REQUIRED",
    });

    expect(buildDryRunQuarterPlan({
      descriptor,
      source,
      existingFilings: [
        ...existing,
        { accessionNumber: "000000000224000002", amendmentFlag: true, filingDate: "2024-05-02", isEffective: true },
      ],
      existingHoldingRows: [
        { accessionNumber: "000000000124000001", holdingRows: 2 },
        { accessionNumber: "000000000224000002", holdingRows: 1 },
      ],
    })).toMatchObject({
      filingsAlreadyPresent: 2,
      filingsToInsert: 0,
      estimatedHoldingRowsToProcess: 0,
      status: "NO_CHANGE",
    });
  });

  it("projects an interrupted existing accession for full bounded replay", () => {
    expect(buildStreamingDryRunPlan(
      descriptor,
      {
        filings: [{
          accessionNumber: "000124000001",
          amendmentFlag: false,
          filingDate: "2024-05-01",
          isEffective: false,
        }],
        holdingRows: 500,
      },
      {
        status: "success",
        sourceFilings: 1,
        sourceHoldingRows: 1_500,
        filingsToInsert: 0,
        filingsPotentiallyUpdated: 1,
        holdingRowsToProcess: 1_500,
        amendmentsToReconcile: 0,
      },
    )).toMatchObject({
      filingsAlreadyPresent: 1,
      filingsToInsert: 0,
      filingsPotentiallyUpdated: 1,
      estimatedHoldingRowsToProcess: 1_500,
      status: "PARTIAL_BACKFILL_REQUIRED",
    });
  });

  it("reconciles dashed and canonical accessions with one canonical identity", () => {
    expect(buildAccessionOverlap(
      [
        { accessionNumber: "0000000001-24-000001" },
        { accessionNumber: "000000000224000002" },
        { accessionNumber: "0000000002-24-000002" },
      ],
      ["000000000124000001", "000000000224000002", "0000000003-24-000003"],
    )).toEqual({
      existingFilings: 3,
      existingAccessions: 3,
      sourceFilings: 3,
      sourceAccessions: 3,
      exactOverlap: 1,
      normalizedOverlap: 2,
      existingOnly: 0,
      sourceOnly: 1,
      duplicateExistingCanonicalAccessions: 1,
      duplicateSourceCanonicalAccessions: 0,
      normalizationExamples: [{
        existing: "0000000001-24-000001",
        canonical: "000000000124000001",
      }, {
        existing: "0000000002-24-000002",
        canonical: "000000000224000002",
      }],
    });
  });

  it("reports source errors without projecting database work", () => {
    expect(buildDryRunQuarterPlan({
      descriptor,
      source: { status: "failed", holdings: [], diagnostics: {} } as BulkParseResult,
      existingFilings: [],
      existingHoldingRows: [],
    })).toMatchObject({
      sourceAvailable: false,
      sourceFilings: null,
      filingsToInsert: null,
      status: "SOURCE_ERROR",
    });
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

  it("uses the canonical trusted-evidence union rather than reviewed security_master alone", () => {
    const source = readFileSync(
      new URL("../../../../scripts/audit-institutional-historical-coverage.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("FROM institutional_security_mappings");
    expect(source).toContain("LOWER(COALESCE(status, '')) IN ('exact', 'reviewed')");
    expect(source).toContain("sm.asset_type IN ('common_stock', 'reit')");
    expect(source).not.toContain("sm.review_status = 'reviewed'");
  });
});