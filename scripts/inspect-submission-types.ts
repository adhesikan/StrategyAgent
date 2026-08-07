#!/usr/bin/env tsx
// Diagnostic: Inspect distinct SUBMISSIONTYPE values in the latest SEC 13F archive.
//
// Usage:
//   npx tsx scripts/inspect-submission-types.ts
//
// Requirements:
//   SEC_USER_AGENT  — descriptive User-Agent for SEC EDGAR
//
// Output: safe structured log — distinct SUBMISSIONTYPE values and counts only.
// Never logs raw filing rows or credentials.

import {
  fetchDatasetCatalog,
  selectDatasetWindows,
  toDatasetDescriptor,
} from "../server/services/institutional/sec-dataset-catalog";
import { secFetchBuffer } from "../server/services/institutional/sec-client";
import AdmZip from "adm-zip";

const MAX_DISTINCT = 30;

async function main(): Promise<void> {
  const userAgent = process.env.SEC_USER_AGENT;
  if (!userAgent) {
    console.error("[inspect] ERROR: SEC_USER_AGENT is required");
    process.exit(1);
  }

  console.log("[inspect] Fetching SEC 13F dataset catalog…");
  const catalog = await fetchDatasetCatalog(userAgent);
  if (catalog.length === 0) {
    console.error("[inspect] ERROR: catalog is empty");
    process.exit(1);
  }

  // Select the most recent available dataset
  const windows = selectDatasetWindows(catalog, 1);
  if (windows.length === 0) {
    console.error("[inspect] ERROR: no dataset windows found");
    process.exit(1);
  }

  const entry = windows[0];
  const descriptor = toDatasetDescriptor(entry);

  console.log("[inspect] Downloading:", descriptor.fileName, "(this may take 30–90 s)");
  const ac = new AbortController();
  const buffer = await secFetchBuffer(descriptor.downloadUrl, userAgent, ac.signal);

  console.log("[inspect] Archive size:", buffer.length, "bytes");

  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    console.error("[inspect] ERROR: could not open archive as ZIP");
    process.exit(1);
  }

  // Find SUBMISSION.tsv (case-insensitive)
  const subEntry = zip.getEntries().find((e) => {
    const base = e.entryName.toUpperCase().replace(/\\/g, "/").split("/").pop() ?? "";
    return base === "SUBMISSION.TSV";
  });

  if (!subEntry) {
    const names = zip.getEntries().map((e) => e.entryName).slice(0, 10);
    console.error("[inspect] ERROR: SUBMISSION.tsv not found. Entries:", names);
    process.exit(1);
  }

  console.log("[inspect] Found:", subEntry.entryName);

  const text = subEntry.getData().toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  if (lines.length === 0) {
    console.error("[inspect] ERROR: SUBMISSION.tsv is empty");
    process.exit(1);
  }

  // Parse header to find SUBMISSIONTYPE column index
  const headers = lines[0].split("\t").map((h) => h.trim().toUpperCase());
  console.log("[inspect] SUBMISSION.tsv headers:", headers);

  // Find the column regardless of exact name (check for SUBMISSIONTYPE, FORM-TYPE, FORMTYPE)
  const formTypeIdx = headers.findIndex((h) => {
    const n = h.replace(/[-_]/g, "");
    return n === "SUBMISSIONTYPE" || n === "FORMTYPE";
  });

  if (formTypeIdx === -1) {
    console.error("[inspect] WARNING: no SUBMISSIONTYPE/FORM-TYPE column found in headers");
  }

  const rawCounts = new Map<string, number>();
  let totalRows = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    totalRows++;

    if (formTypeIdx !== -1) {
      const cells = lines[i].split("\t");
      const val = (cells[formTypeIdx] ?? "").trim();
      rawCounts.set(val, (rawCounts.get(val) ?? 0) + 1);
    }
  }

  // Build result (bounded to MAX_DISTINCT)
  const submissionTypeCounts: Record<string, number> = {};
  let distinctCount = 0;
  for (const [val, count] of [...rawCounts.entries()].sort((a, b) => b[1] - a[1])) {
    if (distinctCount >= MAX_DISTINCT) {
      submissionTypeCounts["[OTHER]"] = (submissionTypeCounts["[OTHER]"] ?? 0) + count;
    } else {
      submissionTypeCounts[val] = count;
      distinctCount++;
    }
  }

  console.log("\n[inspect] ============================================================");
  console.log("[inspect] RESULTS");
  console.log("[inspect] ============================================================");
  console.log("[inspect] Dataset:   ", descriptor.fileName);
  console.log("[inspect] totalRows: ", totalRows);
  console.log("[inspect] formTypeColumnIndex:", formTypeIdx);
  console.log("[inspect] formTypeHeader:", formTypeIdx !== -1 ? headers[formTypeIdx] : "NOT FOUND");
  console.log("[inspect] submissionTypeCounts:", JSON.stringify(submissionTypeCounts, null, 2));
  console.log("[inspect] ============================================================\n");
}

main().catch((err) => {
  console.error("[inspect] FATAL:", err?.message ?? err);
  process.exit(1);
});
