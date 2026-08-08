/**
 * Portfolio Upload Privacy & Compliance Disclosures (Sprint 2.4.1A)
 *
 * Pure structural tests verifying disclosure text is present in all
 * upload flows. No backend, DOM, or JSDOM required — string-based reads.
 *
 * Covers:
 *  - CSV disclosure present
 *  - XLSX disclosure (same page as CSV)
 *  - Screenshot AI disclosure present
 *  - PDF AI disclosure present
 *  - File-retention text matches actual implementation
 *  - PII minimization warning present
 *  - Research / not-investment-advice language present
 *  - Preview verification warning present
 *  - Confirm acknowledgement present
 *  - No claim that extraction is guaranteed accurate (positively tested via "may contain errors")
 *  - No admin-only operational details exposed
 *  - Privacy link present
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const csvImportSrc = fs.readFileSync(
  path.join(__dirname, "../../../client/src/pages/portfolio-import.tsx"),
  "utf-8",
);

const docImportSrc = fs.readFileSync(
  path.join(__dirname, "../../../client/src/pages/portfolio-import-document.tsx"),
  "utf-8",
);

// ---------------------------------------------------------------------------
// §1 — CSV / XLSX upload: privacy disclosure
// ---------------------------------------------------------------------------

describe("§1 — CSV/XLSX upload disclosure", () => {
  it("shows csv-privacy-disclosure section", () => {
    expect(csvImportSrc).toContain('data-testid="csv-privacy-disclosure"');
  });

  it("includes Privacy & Data Use heading", () => {
    expect(csvImportSrc).toContain("Privacy");
    expect(csvImportSrc).toContain("Data Use");
  });

  it("states spreadsheet is processed to import holdings", () => {
    expect(csvImportSrc).toContain(
      "Your spreadsheet is processed to import your holdings",
    );
  });

  it("states files are not retained after processing", () => {
    expect(csvImportSrc).toContain("not retained after processing");
  });

  it("states portfolio info is stored after confirmation", () => {
    expect(csvImportSrc).toContain("stored securely in your account after you confirm");
  });

  it("links to the Privacy Policy page (not admin ops manual)", () => {
    // Must link to /privacy, not /admin or docs/
    expect(csvImportSrc).toContain('href="/privacy"');
    expect(csvImportSrc).not.toContain('href="/admin');
    expect(csvImportSrc).not.toContain('href="docs/');
  });

  it("does not link end users to the operations manual", () => {
    expect(csvImportSrc).not.toContain("operations");
    expect(csvImportSrc).not.toContain("runbook");
    expect(csvImportSrc).not.toContain("devsecops");
  });
});

// ---------------------------------------------------------------------------
// §1 — Document (image/PDF) upload: full privacy disclosure
// ---------------------------------------------------------------------------

describe("§1 — Document (image/PDF) upload full disclosure", () => {
  it("shows doc-privacy-disclosure section", () => {
    expect(docImportSrc).toContain('data-testid="doc-privacy-disclosure"');
  });

  it("states file may contain sensitive financial information", () => {
    expect(docImportSrc).toContain("sensitive financial information");
  });

  it("states file used only to extract and normalize portfolio holdings", () => {
    expect(docImportSrc).toContain("only to extract and normalize portfolio holdings");
  });

  it("states extracted info is stored after confirmation (§4 file-retention)", () => {
    expect(docImportSrc).toContain('data-testid="file-retention-statement"');
    expect(docImportSrc).toContain("not retained after processing");
  });

  it("asks user to review before confirming", () => {
    expect(docImportSrc).toContain("review all extracted information before confirming");
  });

  it("states automated extraction may contain errors", () => {
    expect(docImportSrc).toContain("Automated extraction may contain errors");
  });

  it("advises not to upload unnecessary documents", () => {
    expect(docImportSrc).toContain("not necessary for portfolio analysis");
  });

  it("links to Privacy Policy", () => {
    expect(docImportSrc).toContain('data-testid="privacy-link"');
    expect(docImportSrc).toContain('href="/privacy"');
  });

  it("does not link end users to admin or operations pages", () => {
    expect(docImportSrc).not.toContain('href="/admin');
    expect(docImportSrc).not.toContain("operations manual");
    expect(docImportSrc).not.toContain("runbook");
  });
});

// ---------------------------------------------------------------------------
// §3 — AI extraction disclosure (image/PDF only)
// ---------------------------------------------------------------------------

describe("§3 — AI extraction disclosure (image/PDF)", () => {
  it("shows ai-extraction-disclosure section", () => {
    expect(docImportSrc).toContain('data-testid="ai-extraction-disclosure"');
  });

  it("states document processed by AI service solely to extract portfolio information", () => {
    expect(docImportSrc).toContain(
      "processed by an AI service solely to extract portfolio information",
    );
  });

  it("instructs user to verify symbols, quantities, cost basis", () => {
    expect(docImportSrc).toContain("Always verify symbols, quantities, cost basis");
  });

  it("includes 'Learn how your data is handled' link", () => {
    expect(docImportSrc).toContain("Learn how your data is handled");
  });

  it("does NOT appear in the CSV/XLSX page (no AI used there)", () => {
    // The AI extraction disclosure should only be in the document import page
    expect(csvImportSrc).not.toContain("AI service solely to extract");
    expect(csvImportSrc).not.toContain("ai-extraction-disclosure");
  });
});

// ---------------------------------------------------------------------------
// §4 — File retention statement
// ---------------------------------------------------------------------------

describe("§4 — File retention disclosure", () => {
  it("document import shows file-retention-notice", () => {
    expect(docImportSrc).toContain('data-testid="file-retention-notice"');
  });

  it("retention notice says file is discarded after extraction", () => {
    expect(docImportSrc).toContain(
      "original uploaded file is discarded after extraction",
    );
  });

  it("retention notice says only confirmed data is stored", () => {
    expect(docImportSrc).toContain("Only portfolio data you confirm is stored");
  });

  it("retention claim matches actual implementation (buffer cleared in route)", () => {
    const routeSrc = fs.readFileSync(
      path.join(__dirname, "../portfolio.ts"),
      "utf-8",
    );
    // Route must explicitly discard the buffer — matching what disclosure claims
    expect(routeSrc).toContain("Buffer.alloc(0)");
  });
});

// ---------------------------------------------------------------------------
// §5 — PII minimization warning
// ---------------------------------------------------------------------------

describe("§5 — PII minimization warning (image/PDF)", () => {
  it("shows pii-warning section", () => {
    expect(docImportSrc).toContain('data-testid="pii-warning"');
  });

  it("warns about account numbers, addresses, tax IDs", () => {
    expect(docImportSrc).toContain("account numbers");
    expect(docImportSrc).toContain("tax IDs");
  });

  it("recommends uploading only the holdings page", () => {
    expect(docImportSrc).toContain(
      "upload only the page or screenshot containing your holdings",
    );
  });

  it("uses 'Data minimization' label", () => {
    expect(docImportSrc).toContain("Data minimization");
  });

  it("does NOT appear in CSV/XLSX upload (not applicable to spreadsheets)", () => {
    expect(csvImportSrc).not.toContain("pii-warning");
    expect(csvImportSrc).not.toContain("account numbers, addresses, tax IDs");
  });
});

// ---------------------------------------------------------------------------
// §6 — Consent / acknowledgement notice
// ---------------------------------------------------------------------------

describe("§6 — Consent notice adjacent to upload button", () => {
  it("CSV/XLSX upload shows csv-consent-notice", () => {
    expect(csvImportSrc).toContain('data-testid="csv-consent-notice"');
  });

  it("CSV/XLSX consent says 'By continuing, you acknowledge'", () => {
    expect(csvImportSrc).toContain(
      "By continuing, you acknowledge that the file will be processed as described above",
    );
  });

  it("document import shows doc-consent-notice", () => {
    expect(docImportSrc).toContain('data-testid="doc-consent-notice"');
  });

  it("document import consent says 'By continuing, you acknowledge'", () => {
    expect(docImportSrc).toContain(
      "By continuing, you acknowledge that the file will be processed as described above",
    );
  });
});

// ---------------------------------------------------------------------------
// §7 — CSV/XLSX: lighter disclosure, no AI mention
// ---------------------------------------------------------------------------

describe("§7 — CSV/XLSX lighter disclosure (no AI mention)", () => {
  it("does not mention AI extraction in the CSV upload path", () => {
    expect(csvImportSrc).not.toContain("AI extraction");
    expect(csvImportSrc).not.toContain("AI service");
    expect(csvImportSrc).not.toContain("ai-extraction-disclosure");
  });

  it("does not mention screenshots or PDF in the CSV page", () => {
    // CSV page should not bleed document-import-specific copy
    expect(csvImportSrc).not.toContain("AI-assisted extraction");
  });
});

// ---------------------------------------------------------------------------
// §8 — Preview verification warning
// ---------------------------------------------------------------------------

describe("§8 — Preview verification warning", () => {
  it("CSV/XLSX preview shows csv-review-warning", () => {
    expect(csvImportSrc).toContain('data-testid="csv-review-warning"');
  });

  it("CSV/XLSX review warning says 'Review carefully before importing'", () => {
    expect(csvImportSrc).toContain("Review carefully before importing");
  });

  it("document import preview shows doc-review-warning", () => {
    expect(docImportSrc).toContain('data-testid="doc-review-warning"');
  });

  it("document review warning says 'Review carefully before importing'", () => {
    expect(docImportSrc).toContain("Review carefully before importing");
  });

  it("document review warning mentions AI-extracted fields may be inaccurate", () => {
    expect(docImportSrc).toContain("AI-extracted fields may be inaccurate");
  });

  it("does NOT imply extraction is guaranteed accurate", () => {
    // The phrase 'guaranteed' should not appear as a positive claim
    // The word may appear only in the negative context
    const hasGuaranteedAccurate = docImportSrc.includes("guaranteed to be accurate");
    const hasNegation = docImportSrc.includes("not guaranteed to be accurate")
      || docImportSrc.includes("Extraction is not guaranteed");
    if (hasGuaranteedAccurate) {
      // Only acceptable if immediately negated
      expect(hasNegation).toBe(true);
    }
    // Regardless, must warn about potential errors
    expect(docImportSrc).toContain("may be inaccurate");
  });
});

// ---------------------------------------------------------------------------
// §9 — Confirm acknowledgement + research disclaimer
// ---------------------------------------------------------------------------

describe("§9 — Confirm-step acknowledgement and research disclaimer", () => {
  it("CSV/XLSX shows csv-confirm-disclaimer", () => {
    expect(csvImportSrc).toContain('data-testid="csv-confirm-disclaimer"');
  });

  it("CSV/XLSX confirm says 'Confirm that these holdings accurately reflect'", () => {
    expect(csvImportSrc).toContain(
      "Confirm that these holdings accurately reflect the portfolio information you want stored",
    );
  });

  it("CSV/XLSX research disclaimer present", () => {
    expect(csvImportSrc).toContain('data-testid="research-disclaimer"');
    expect(csvImportSrc).toContain("research and analytics purposes");
  });

  it("CSV/XLSX states VCP Trader AI does not make investment decisions", () => {
    expect(csvImportSrc).toContain("does not make investment decisions for you");
  });

  it("CSV/XLSX states no investment advice", () => {
    expect(csvImportSrc).toContain("does not constitute investment advice");
  });

  it("CSV/XLSX research disclaimer mentions buy, sell, hold, rebalance", () => {
    expect(csvImportSrc).toContain("buy, sell, hold, or rebalance");
  });

  it("document import shows doc-confirm-disclaimer", () => {
    expect(docImportSrc).toContain('data-testid="doc-confirm-disclaimer"');
  });

  it("document import confirm says 'Confirm that these holdings accurately reflect'", () => {
    expect(docImportSrc).toContain(
      "Confirm that these holdings accurately reflect the portfolio information you want stored",
    );
  });

  it("document import research disclaimer present", () => {
    expect(docImportSrc).toContain('data-testid="doc-research-disclaimer"');
    expect(docImportSrc).toContain("research and analytics purposes");
  });

  it("document import states no investment decisions", () => {
    expect(docImportSrc).toContain("does not make investment decisions for you");
  });

  it("document import states no investment advice", () => {
    expect(docImportSrc).toContain("does not constitute investment advice");
  });
});

// ---------------------------------------------------------------------------
// §10 — Privacy link
// ---------------------------------------------------------------------------

describe("§10 — Privacy link", () => {
  it("CSV/XLSX page links to /privacy", () => {
    expect(csvImportSrc).toContain('href="/privacy"');
  });

  it("document import page links to /privacy", () => {
    expect(docImportSrc).toContain('href="/privacy"');
  });

  it("/privacy route exists in App.tsx", () => {
    const appSrc = fs.readFileSync(
      path.join(__dirname, "../../../client/src/App.tsx"),
      "utf-8",
    );
    expect(appSrc).toContain("/privacy");
    expect(appSrc).toContain("PrivacyPage");
  });
});

// ---------------------------------------------------------------------------
// Admin-only content guard
// ---------------------------------------------------------------------------

describe("Admin-only content guard", () => {
  it("CSV/XLSX page exposes no admin endpoint URLs", () => {
    expect(csvImportSrc).not.toContain("/api/admin");
    expect(csvImportSrc).not.toContain("platform-health");
    expect(csvImportSrc).not.toContain("operations-manual");
  });

  it("document import page exposes no admin endpoint URLs", () => {
    expect(docImportSrc).not.toContain("/api/admin");
    expect(docImportSrc).not.toContain("platform-health");
    expect(docImportSrc).not.toContain("operations-manual");
  });

  it("CSV/XLSX page exposes no internal telemetry field names to users", () => {
    expect(csvImportSrc).not.toContain("processingDurationMs");
    expect(csvImportSrc).not.toContain("rowsDetected");
    expect(csvImportSrc).not.toContain("resultStatus");
  });

  it("document import page does not expose raw telemetry to users", () => {
    // telemetry is received from server but must not be shown directly to users
    // It's OK if it's in a type interface; it must not appear in UI JSX as literal text
    const uiSection = docImportSrc.replace(/interface ExtractionTelemetry[\s\S]*?}/, "");
    expect(uiSection).not.toContain("processingDurationMs");
    expect(uiSection).not.toContain("resultStatus:");
  });
});

// ---------------------------------------------------------------------------
// Screenshot / PDF — both flows covered
// ---------------------------------------------------------------------------

describe("Screenshot and PDF flows both covered", () => {
  it("DOC_CONFIG has image endpoint pointing to /api/portfolio/import/image", () => {
    expect(docImportSrc).toContain("/api/portfolio/import/image");
  });

  it("DOC_CONFIG has pdf endpoint pointing to /api/portfolio/import/pdf", () => {
    expect(docImportSrc).toContain("/api/portfolio/import/pdf");
  });

  it("AI disclosure shown for image type", () => {
    // Both image and PDF use the same StepUpload component which shows the AI disclosure
    expect(docImportSrc).toContain("ai-extraction-disclosure");
  });

  it("AI disclosure shown for pdf type", () => {
    // Same component covers both types
    expect(docImportSrc).toContain("ai-extraction-disclosure");
  });

  it("PII warning shown for both document types", () => {
    expect(docImportSrc).toContain("pii-warning");
  });
});
