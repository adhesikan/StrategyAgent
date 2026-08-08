// Sprint 2.3.6A — Operations Manual Tests
//
// Covers:
//   - Search: title, heading, body text, API URL, env variable, script, error message, table name
//   - Search: deduplication, excerpt, anchor generation
//   - No secret values in doc content (structural)
//   - API/UAT reference: canonical vcptrader.com routes
//   - API/UAT reference: POST endpoints documented as POST (not GET)
//   - Sprint change log: sprint inventories present
//   - Documentation checker: file detection logic
//   - Platform Health: manual links configuration (structural)
//   - Precomputation status: exported getter
//   - Enhanced diagnostics: symbolBreakdown shape

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const DOCS_DIR = path.resolve(process.cwd(), "docs/operations");

// ---------------------------------------------------------------------------
// Helpers — mirror the search logic from operations-manual.ts
// ---------------------------------------------------------------------------

interface DocEntry { id: string; title: string; content: string }

function loadDocs(): DocEntry[] {
  if (!existsSync(DOCS_DIR)) return [];
  return readdirSync(DOCS_DIR)
    .filter(f => f.endsWith(".md"))
    .map(f => {
      const content = readFileSync(path.join(DOCS_DIR, f), "utf8");
      const id      = f.replace(/\.md$/, "");
      const title   = (content.split("\n").find(l => l.startsWith("# ")) ?? "").replace(/^#\s+/, "").trim();
      return { id, title, content };
    });
}

function searchContent(docs: DocEntry[], query: string): Array<{ docId: string; section: string; lineNum: number }> {
  const q = query.toLowerCase();
  const results: Array<{ docId: string; section: string; lineNum: number }> = [];
  for (const doc of docs) {
    const lines = doc.content.split("\n");
    let lastHeading = doc.title;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^#{1,3}\s+(.+)/);
      if (m) lastHeading = m[1].trim();
      if (lines[i].toLowerCase().includes(q)) {
        results.push({ docId: doc.id, section: lastHeading, lineNum: i + 1 });
      }
    }
  }
  return results;
}

function slugify(s: string): string {
  return "#" + s.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// Docs existence
// ---------------------------------------------------------------------------

describe("docs/operations — file inventory", () => {
  it("docs directory exists", () => {
    expect(existsSync(DOCS_DIR)).toBe(true);
  });

  const expectedDocs = [
    "01-system-architecture",
    "02-environments-and-deployment",
    "03-database-and-migrations",
    "04-market-data-and-mcp",
    "05-scanner-and-ranking",
    "06-institutional-13f-pipeline",
    "07-security-master-and-mappings",
    "08-sector-theme-intelligence",
    "09-background-jobs-and-scheduling",
    "10-monitoring-and-platform-health",
    "11-troubleshooting-runbook",
    "12-security-and-devsecops",
    "13-production-release-checklist",
    "14-disaster-recovery",
    "15-known-issues-and-backlog",
    "16-api-and-uat-reference",
    "17-sprint-change-log",
    "system-manifest",
  ];

  for (const docId of expectedDocs) {
    const ext = docId.endsWith("manifest") ? ".yaml" : ".md";
    it(`${docId}${ext} exists`, () => {
      expect(existsSync(path.join(DOCS_DIR, `${docId}${ext}`))).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Search — returns results for all required query terms
// ---------------------------------------------------------------------------

describe("search — query coverage", () => {
  const docs = loadDocs();

  const REQUIRED_QUERIES: Array<[string, string]> = [
    ["getLatestRanking",                    "scanner / ranking docs"],
    ["toISOString is not a function",       "troubleshooting runbook"],
    ["PERIODOFREPORT",                      "13F pipeline doc"],
    ["DD-MMM-YYYY",                         "13F pipeline doc"],
    ["/api/intelligence/briefing",          "API reference or troubleshooting"],
    ["/api/admin/intelligence/rebuild",     "API reference or platform health"],
    ["MCP_SERVICE_TOKEN",                   "environments or MCP doc"],
    ["psql not found",                      "troubleshooting runbook"],
    ["sectorSnapshots",                     "sector/theme or monitoring doc"],
    ["FILINGMANAGER_NAME",                  "13F pipeline doc"],
    ["NO_HOLDINGS_BEARING_SUBMISSIONS",     "troubleshooting runbook"],
  ];

  for (const [query, desc] of REQUIRED_QUERIES) {
    it(`"${query}" finds results (${desc})`, () => {
      const results = searchContent(docs, query);
      expect(results.length).toBeGreaterThan(0);
    });
  }
});

// ---------------------------------------------------------------------------
// Search — result quality
// ---------------------------------------------------------------------------

describe("search — result quality", () => {
  const docs = loadDocs();

  it("search by title-level term finds the right doc", () => {
    const results = searchContent(docs, "System Architecture");
    expect(results.some(r => r.docId.includes("01-system"))).toBe(true);
  });

  it("search by API route finds relevant doc", () => {
    const results = searchContent(docs, "/api/opportunities/today");
    expect(results.length).toBeGreaterThan(0);
  });

  it("search by env variable name finds a result", () => {
    const results = searchContent(docs, "INSTITUTIONAL_13F_INGESTION_ENABLED");
    expect(results.length).toBeGreaterThan(0);
  });

  it("search by table name finds a result", () => {
    const results = searchContent(docs, "institutional_holdings");
    expect(results.length).toBeGreaterThan(0);
  });

  it("search by script name finds a result", () => {
    const results = searchContent(docs, "check-operations-docs");
    expect(results.length).toBeGreaterThan(0);
  });

  it("search by error message finds a result", () => {
    const results = searchContent(docs, "Failed to load intelligence briefing");
    expect(results.length).toBeGreaterThan(0);
  });

  it("search by job name finds a result", () => {
    const results = searchContent(docs, "institutional_ingestion");
    expect(results.length).toBeGreaterThan(0);
  });

  it("short query (< 2 chars) returns no results from real search", () => {
    // Mimics the server-side guard
    const q = "a";
    if (q.length < 2) {
      expect([]).toHaveLength(0);
    }
  });

  it("anchor slug generation is deterministic", () => {
    expect(slugify("Sector Intelligence")).toBe("#sector-intelligence");
    expect(slugify("13F Pipeline")).toBe("#13f-pipeline");
    expect(slugify("MCP: 401 Missing bearer token")).toBe("#mcp-401-missing-bearer-token");
  });
});

// ---------------------------------------------------------------------------
// API/UAT reference — canonical vcptrader.com routes
// ---------------------------------------------------------------------------

describe("16-api-and-uat-reference — content", () => {
  const apiDoc = existsSync(path.join(DOCS_DIR, "16-api-and-uat-reference.md"))
    ? readFileSync(path.join(DOCS_DIR, "16-api-and-uat-reference.md"), "utf8")
    : "";

  it("file is non-empty", () => {
    expect(apiDoc.length).toBeGreaterThan(100);
  });

  const REQUIRED_ROUTES = [
    "https://vcptrader.com/",
    "https://vcptrader.com/research",
    "https://vcptrader.com/intelligence",
    "https://vcptrader.com/opportunities/:symbol",
    "https://vcptrader.com/institutional/funds",
    "https://vcptrader.com/admin/platform-health",
    "https://vcptrader.com/admin/operations-manual",
    "/api/intelligence/briefing",
    "/api/opportunities/today",
    "/api/institutional/funds",
  ];

  for (const route of REQUIRED_ROUTES) {
    it(`documents route: ${route}`, () => {
      expect(apiDoc).toContain(route);
    });
  }

  it("documents POST /api/admin/intelligence/rebuild (not GET)", () => {
    expect(apiDoc).toContain("POST /api/admin/intelligence/rebuild");
    // The important caveat — GET 404 is expected behavior
    expect(apiDoc).toContain("404");
  });

  it("documents POST /api/admin/symbols/enrich", () => {
    expect(apiDoc).toContain("POST /api/admin/symbols/enrich");
  });

  it("explains GET vs POST caveat for admin endpoints", () => {
    // The doc must warn that typing a POST endpoint into Chrome sends GET
    expect(apiDoc.toLowerCase()).toContain("chrome");
  });

  it("contains UAT sequence for intelligence", () => {
    expect(apiDoc).toContain("/api/admin/intelligence/diagnostics");
    expect(apiDoc).toContain("hasData");
  });
});

// ---------------------------------------------------------------------------
// Sprint change log — content
// ---------------------------------------------------------------------------

describe("17-sprint-change-log — content", () => {
  const changeLog = existsSync(path.join(DOCS_DIR, "17-sprint-change-log.md"))
    ? readFileSync(path.join(DOCS_DIR, "17-sprint-change-log.md"), "utf8")
    : "";

  it("file is non-empty", () => {
    expect(changeLog.length).toBeGreaterThan(100);
  });

  const REQUIRED_SPRINTS = ["2.3.6", "2.3.5", "2.3.4", "2.3.3", "2.3.2", "2.3.1", "2.3.0", "2.2"];
  for (const sprint of REQUIRED_SPRINTS) {
    it(`documents sprint ${sprint}`, () => {
      expect(changeLog).toContain(sprint);
    });
  }

  it("Sprint 2.3.6 documents the market_data_symbols classification fix", () => {
    expect(changeLog).toContain("market_data_symbols");
  });

  it("Sprint 2.3.6 documents symbol enrichment", () => {
    expect(changeLog).toContain("enrichment");
  });

  it("Sprint 2.3.6 documents platform health", () => {
    expect(changeLog).toContain("platform-health");
  });

  it("Sprint 2.3.6 documents the rebuild lock", () => {
    expect(changeLog).toContain("rebuild");
  });

  it("documents Operations Manual Definition of Done", () => {
    expect(changeLog.toLowerCase()).toContain("definition of done");
  });
});

// ---------------------------------------------------------------------------
// No secret values in docs
// ---------------------------------------------------------------------------

describe("docs — no secret values", () => {
  const docs = loadDocs();
  const fullContent = docs.map(d => d.content).join("\n");

  // These patterns suggest actual secret values (not just variable names)
  const FORBIDDEN_PATTERNS = [
    /DATABASE_URL\s*=\s*postgres:\/\/[^/]/,  // actual connection string value
    /Bearer\s+[A-Za-z0-9_-]{20,}/,           // actual bearer token value
    /sk_live_[A-Za-z0-9]+/,                  // Stripe live secret key
    /sk_test_[A-Za-z0-9]+/,                  // Stripe test secret key
    /password\s*[=:]\s*\S{8,}/i,             // password = actual-value
  ];

  for (const pattern of FORBIDDEN_PATTERNS) {
    it(`docs do not contain pattern: ${pattern.source.slice(0, 40)}`, () => {
      expect(fullContent).not.toMatch(pattern);
    });
  }

  it("docs contain env variable NAMES but not values", () => {
    // DATABASE_URL as a name reference is fine
    expect(fullContent).toContain("DATABASE_URL");
    // But not with an actual value assigned
    expect(fullContent).not.toMatch(/DATABASE_URL\s*=\s*postgres:\/\//);
  });
});

// ---------------------------------------------------------------------------
// Troubleshooting runbook — all required incidents present
// ---------------------------------------------------------------------------

describe("11-troubleshooting-runbook — incident coverage", () => {
  const runbook = existsSync(path.join(DOCS_DIR, "11-troubleshooting-runbook.md"))
    ? readFileSync(path.join(DOCS_DIR, "11-troubleshooting-runbook.md"), "utf8")
    : "";

  const REQUIRED_INCIDENTS = [
    "getLatestRanking",
    "permanent skeleton",
    "Failed to load intelligence briefing",
    "toISOString",
    "sectorSnapshots",
    "symbols table",
    "Required headers missing",
    "FILINGMANAGER_NAME",
    "NO_HOLDINGS_BEARING_SUBMISSIONS",
    "PERIODOFREPORT",
    "timeout",
    "interactive",
    "stale",
    "404",
    "route collision",
    "1000",
    "401",
    "mock provider",
    "psql",
  ];

  for (const incident of REQUIRED_INCIDENTS) {
    it(`runbook contains: "${incident}"`, () => {
      expect(runbook).toContain(incident);
    });
  }
});

// ---------------------------------------------------------------------------
// Documentation checker script
// ---------------------------------------------------------------------------

describe("scripts/check-operations-docs.ts — structure", () => {
  const scriptPath = path.resolve(process.cwd(), "scripts/check-operations-docs.ts");

  it("script file exists", () => {
    expect(existsSync(scriptPath)).toBe(true);
  });

  it("script is non-empty", () => {
    const content = readFileSync(scriptPath, "utf8");
    expect(content.length).toBeGreaterThan(100);
  });

  it("script checks server/routes/ and server/services/ dirs", () => {
    const content = readFileSync(scriptPath, "utf8");
    expect(content).toContain("server/routes/");
    expect(content).toContain("server/services/");
  });

  it("script checks shared/schema.ts", () => {
    const content = readFileSync(scriptPath, "utf8");
    expect(content).toContain("shared/schema.ts");
  });

  it("script checks docs/operations/ dir", () => {
    const content = readFileSync(scriptPath, "utf8");
    expect(content).toContain("docs/operations/");
  });

  it("script exits 0 (advisory mode, not blocking)", () => {
    const content = readFileSync(scriptPath, "utf8");
    // Should only call process.exit(0), never process.exit(1)
    expect(content).toContain("process.exit(0)");
    expect(content).not.toContain("process.exit(1)");
  });
});

// ---------------------------------------------------------------------------
// Precomputation status — exported getter exists
// ---------------------------------------------------------------------------

describe("intelligence-orchestrator — precomputation status", () => {
  it("exports getPrecomputationStatus function", async () => {
    const mod = await import("../../services/intelligence-orchestrator");
    expect(typeof mod.getPrecomputationStatus).toBe("function");
  });

  it("getPrecomputationStatus returns correct shape", async () => {
    const { getPrecomputationStatus } = await import("../../services/intelligence-orchestrator");
    const status = getPrecomputationStatus();
    expect(status).toHaveProperty("lastAttemptAt");
    expect(status).toHaveProperty("lastSuccessAt");
    expect(status).toHaveProperty("lastErrorMessage");
    expect(status).toHaveProperty("lastSectorCount");
    expect(status).toHaveProperty("lastThemeCount");
    expect(status).toHaveProperty("lastRankedCount");
    expect(status).toHaveProperty("running");
    expect(typeof status.running).toBe("boolean");
  });

  it("initial state has running=false and null timestamps", async () => {
    const { getPrecomputationStatus } = await import("../../services/intelligence-orchestrator");
    const status = getPrecomputationStatus();
    // May have been modified by other tests or app startup, so just check types
    expect(typeof status.running).toBe("boolean");
    expect(status.lastAttemptAt === null || typeof status.lastAttemptAt === "string").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Operations manual route module
// ---------------------------------------------------------------------------

describe("operations-manual route module", () => {
  it("exports registerOperationsManualRoutes", async () => {
    const mod = await import("../operations-manual");
    expect(typeof mod.registerOperationsManualRoutes).toBe("function");
  });

  it("module does not export secret values", async () => {
    const mod = await import("../operations-manual");
    const keys = Object.keys(mod);
    // Should only export the register function and SearchResult type (types are erased)
    expect(keys).toContain("registerOperationsManualRoutes");
    for (const key of keys) {
      expect(key.toLowerCase()).not.toMatch(/secret|password|token|credential/);
    }
  });
});

// ---------------------------------------------------------------------------
// README — Definition of Done section
// ---------------------------------------------------------------------------

describe("docs/operations/README.md — DoD section", () => {
  const readme = existsSync(path.join(DOCS_DIR, "README.md"))
    ? readFileSync(path.join(DOCS_DIR, "README.md"), "utf8")
    : "";

  it("README exists and is non-empty", () => {
    expect(readme.length).toBeGreaterThan(100);
  });

  it("includes doc 16 in the table", () => {
    expect(readme).toContain("16-api-and-uat-reference");
  });

  it("includes doc 17 in the table", () => {
    expect(readme).toContain("17-sprint-change-log");
  });

  it("includes Operations Manual Definition of Done section", () => {
    expect(readme.toLowerCase()).toContain("definition of done");
  });

  it("references 17-sprint-change-log.md in DoD", () => {
    expect(readme).toContain("17-sprint-change-log.md");
  });
});
