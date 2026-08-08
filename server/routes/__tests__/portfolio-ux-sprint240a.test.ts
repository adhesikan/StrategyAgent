/**
 * Sprint 2.4.0A — Portfolio UX Polish
 * UI regression tests (pure structural and content checks — no DOM rendering)
 *
 * Covers:
 *   §1  Landing page title / subtitle
 *   §2  Button order: Upload → Connect Broker → Manual → Coming-soon cards
 *   §3  Supported imports list
 *   §4  Broker card — available vs coming soon
 *   §5  "What happens after import?" card content (no recommendation language)
 *   §6  Import page: safety bullets
 *   §7  Preview summary fields
 *   §8  Empty state: 3 action buttons
 *   §9  Intelligence placeholder cards
 *   §10 Breadcrumbs present
 *   §11 Tooltips wired to correct fields
 *   §12 ARIA labels / accessibility attributes
 *   §13 Mobile: min-width on scrollable tables
 *   §14 No new APIs introduced
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readPage(name: string): string {
  return readFileSync(join(__dirname, "../../../client/src/pages", name), "utf8");
}

const portfolioSrc = readPage("portfolio.tsx");
const importSrc    = readPage("portfolio-import.tsx");

// ---------------------------------------------------------------------------
// §1 Landing page title and subtitle
// ---------------------------------------------------------------------------

describe("§1 — Landing page title", () => {
  it("uses new title 'Import Your Investment Portfolio'", () => {
    expect(portfolioSrc).toContain("Import Your Investment Portfolio");
  });

  it("does NOT contain old title 'Add your portfolio'", () => {
    expect(portfolioSrc).not.toContain("Add your portfolio");
  });

  it("subtitle mentions 'Import holdings from your broker, spreadsheet, or enter them manually'", () => {
    expect(portfolioSrc).toContain("Import holdings from your broker, spreadsheet, or enter them manually");
  });

  it("subtitle mentions VCP Trader AI analysis", () => {
    expect(portfolioSrc).toContain("VCP Trader AI continuously analyzes your portfolio");
  });
});

// ---------------------------------------------------------------------------
// §1 Trust banner
// ---------------------------------------------------------------------------

describe("§1 — Trust banner bullets", () => {
  const bullets = [
    "No broker connection required",
    "Import in minutes",
    "Your portfolio stays private",
    "Secure local processing",
  ];

  bullets.forEach(bullet => {
    it(`shows trust bullet: "${bullet}"`, () => {
      expect(portfolioSrc).toContain(bullet);
    });
  });
});

// ---------------------------------------------------------------------------
// §2 Button order
// ---------------------------------------------------------------------------

describe("§2 — Primary action button order", () => {
  it("PRIMARY button is 'Upload Portfolio'", () => {
    expect(portfolioSrc).toContain("Upload Portfolio");
  });

  it("SECONDARY button is 'Connect Broker'", () => {
    expect(portfolioSrc).toContain("Connect Broker");
  });

  it("TERTIARY button is 'Enter Holdings Manually'", () => {
    expect(portfolioSrc).toContain("Enter Holdings Manually");
  });

  it("Upload Portfolio appears before Connect Broker in source", () => {
    const upIdx = portfolioSrc.indexOf("Upload Portfolio");
    const cbIdx = portfolioSrc.indexOf("Connect Broker");
    expect(upIdx).toBeLessThan(cbIdx);
  });

  it("Connect Broker appears before Enter Holdings Manually in source", () => {
    const cbIdx = portfolioSrc.indexOf("Connect Broker");
    const mIdx  = portfolioSrc.indexOf("Enter Holdings Manually");
    expect(cbIdx).toBeLessThan(mIdx);
  });

  it("shows 'Import from Screenshot' coming-soon card", () => {
    expect(portfolioSrc).toContain("Import from Screenshot");
  });

  it("shows 'Import from PDF Statement' coming-soon card", () => {
    expect(portfolioSrc).toContain("Import from PDF Statement");
  });

  it("coming-soon cards are aria-disabled", () => {
    expect(portfolioSrc).toContain('aria-disabled="true"');
  });

  it("coming-soon cards show Coming Soon badge", () => {
    const comingSoonCount = (portfolioSrc.match(/Coming Soon/g) || []).length;
    expect(comingSoonCount).toBeGreaterThanOrEqual(2);
  });

  it("no routes are created for screenshot or PDF import", () => {
    expect(portfolioSrc).not.toContain("/portfolio/import/screenshot");
    expect(portfolioSrc).not.toContain("/portfolio/import/pdf");
  });
});

// ---------------------------------------------------------------------------
// §3 Supported imports card
// ---------------------------------------------------------------------------

describe("§3 — Supported imports card", () => {
  const sources = ["CSV", "Excel (.xlsx)", "Fidelity Export", "Schwab Export",
    "Robinhood Export", "Interactive Brokers", "TradeStation Export", "Tradier Export"];

  sources.forEach(s => {
    it(`lists supported source: ${s}`, () => {
      expect(portfolioSrc).toContain(s);
    });
  });

  it("shows 'supported-imports-card' test ID", () => {
    expect(portfolioSrc).toContain('data-testid="supported-imports-card"');
  });

  it("shows Screenshot Import as coming soon", () => {
    expect(portfolioSrc).toContain("Screenshot Import");
  });

  it("shows PDF Statement Import as coming soon", () => {
    expect(portfolioSrc).toContain("PDF Statement Import");
  });
});

// ---------------------------------------------------------------------------
// §4 Broker card
// ---------------------------------------------------------------------------

describe("§4 — Broker card", () => {
  const available   = ["Tradier", "TradeStation"];
  const comingSoon  = ["Schwab", "Interactive Brokers", "Fidelity", "Robinhood"];

  available.forEach(b => {
    it(`shows available broker: ${b}`, () => {
      expect(portfolioSrc).toContain(b);
    });
  });

  comingSoon.forEach(b => {
    it(`shows coming-soon broker: ${b}`, () => {
      expect(portfolioSrc).toContain(b);
    });
  });

  it("shows broker-card test ID", () => {
    expect(portfolioSrc).toContain('data-testid="broker-card"');
  });

  it("does NOT implement new broker integrations (no new API routes for Schwab/Fidelity/Robinhood)", () => {
    expect(portfolioSrc).not.toContain("/api/broker/schwab");
    expect(portfolioSrc).not.toContain("/api/broker/fidelity");
    expect(portfolioSrc).not.toContain("/api/broker/robinhood");
  });
});

// ---------------------------------------------------------------------------
// §5 "What happens after import?" card — no forbidden language
// ---------------------------------------------------------------------------

describe("§5 — What happens card", () => {
  const expectedLabels = [
    "Track your holdings",
    "Monitor portfolio performance",
    "View sector exposure",
    "Research institutional ownership",
    "Monitor technical strength",
    "Identify portfolio concentration",
    "Generate AI research",
    "Discover covered call candidates",
  ];

  expectedLabels.forEach(label => {
    it(`shows feature label: "${label}"`, () => {
      expect(portfolioSrc).toContain(label);
    });
  });

  it("shows what-happens-card test ID", () => {
    expect(portfolioSrc).toContain('data-testid="what-happens-card"');
  });

  const forbidden = ["Recommendation", "Recommended Trade", " Buy ", " Sell "];
  forbidden.forEach(word => {
    it(`does NOT contain forbidden word "${word}"`, () => {
      expect(portfolioSrc).not.toContain(word);
    });
  });

  const approved = ["Research", "Analysis", "Opportunities", "Intelligence"];
  approved.forEach(word => {
    it(`uses approved wording: "${word}"`, () => {
      expect(portfolioSrc).toContain(word);
    });
  });
});

// ---------------------------------------------------------------------------
// §6 Import page: file safety info
// ---------------------------------------------------------------------------

describe("§6 — Import page file safety info", () => {
  it("shows file-safety-info block", () => {
    expect(importSrc).toContain('data-testid="file-safety-info"');
  });

  const safetyCopies = [
    "Maximum 500 holdings",
    "Nothing uploaded until confirmation",
    "Formula cells ignored",
    "Unknown columns safely ignored",
    "Broker credentials never required",
    "Files processed securely",
  ];

  safetyCopies.forEach(copy => {
    it(`shows safety bullet: "${copy}"`, () => {
      expect(importSrc).toContain(copy);
    });
  });

  it("shows CSV and Excel badges", () => {
    expect(importSrc).toContain("CSV");
    expect(importSrc).toContain("Excel (.xlsx)");
  });
});

// ---------------------------------------------------------------------------
// §7 Preview summary
// ---------------------------------------------------------------------------

describe("§7 — Preview summary", () => {
  it("shows preview-summary test ID", () => {
    expect(importSrc).toContain('data-testid="preview-summary"');
  });

  const summaryFields = [
    "Detected Holdings",
    "Unique Symbols",
    "Duplicate Symbols",
    "Missing Average Cost",
    "Missing Cost Basis",
    "Estimated Cost Basis",
    "Est. Market Value",
  ];

  summaryFields.forEach(field => {
    it(`shows summary field: "${field}"`, () => {
      expect(importSrc).toContain(field);
    });
  });

  it("shows em dash as unknown value placeholder", () => {
    expect(importSrc).toContain('"—"');
  });

  it("does NOT change parsing or API calls", () => {
    // Confirm/parse endpoints must remain unchanged
    expect(importSrc).toContain("/api/portfolio/import/csv");
    expect(importSrc).toContain("/api/portfolio/import/xlsx");
    expect(importSrc).toContain("/api/portfolio/import/confirm");
  });
});

// ---------------------------------------------------------------------------
// §8 Empty state
// ---------------------------------------------------------------------------

describe("§8 — Empty state", () => {
  it("shows empty-state test ID", () => {
    expect(portfolioSrc).toContain('data-testid="empty-state"');
  });

  it("shows 'No Holdings Yet'", () => {
    expect(portfolioSrc).toContain("No Holdings Yet");
  });

  it("shows 'Import a Spreadsheet' action", () => {
    expect(portfolioSrc).toContain("Import a Spreadsheet");
  });

  it("shows 'Connect a Broker' action", () => {
    expect(portfolioSrc).toContain("Connect a Broker");
  });

  it("shows 'Enter Holdings Manually' action", () => {
    expect(portfolioSrc).toContain("Enter Holdings Manually");
  });
});

// ---------------------------------------------------------------------------
// §9 Intelligence placeholder cards
// ---------------------------------------------------------------------------

describe("§9 — Intelligence placeholder cards", () => {
  it("shows intelligence-placeholders test ID", () => {
    expect(portfolioSrc).toContain('data-testid="intelligence-placeholders"');
  });

  const cards = [
    "Portfolio Health",
    "AI Research",
    "Sector Exposure",
    "Institutional Activity",
    "Technical Strength",
    "Portfolio Risk",
    "Opportunities",
  ];

  cards.forEach(card => {
    it(`shows intelligence card: "${card}"`, () => {
      expect(portfolioSrc).toContain(card);
    });
  });

  it("shows 'Available in an upcoming release' text", () => {
    expect(portfolioSrc).toContain("Available in an upcoming release");
  });

  it("shows Upcoming badge", () => {
    expect(portfolioSrc).toContain("Upcoming");
  });

  it("does NOT implement actual intelligence computation", () => {
    expect(portfolioSrc).not.toContain("computePortfolioIntelligence");
    expect(portfolioSrc).not.toContain("/api/portfolio/intelligence");
  });
});

// ---------------------------------------------------------------------------
// §10 Breadcrumbs
// ---------------------------------------------------------------------------

describe("§10 — Breadcrumbs", () => {
  it("portfolio page has breadcrumb nav", () => {
    expect(portfolioSrc).toContain('aria-label="Breadcrumb"');
  });

  it("import page has breadcrumb nav", () => {
    expect(importSrc).toContain('aria-label="Breadcrumb"');
  });

  it("portfolio breadcrumb includes 'Portfolio Overview'", () => {
    expect(portfolioSrc).toContain("Portfolio Overview");
  });

  it("import breadcrumb includes 'Portfolio Import'", () => {
    expect(importSrc).toContain("Portfolio Import");
  });

  it("import breadcrumb links back to Portfolio", () => {
    expect(importSrc).toContain('setLocation("/portfolio")');
  });
});

// ---------------------------------------------------------------------------
// §11 Tooltips
// ---------------------------------------------------------------------------

describe("§11 — Tooltips", () => {
  it("portfolio page imports Tooltip components", () => {
    expect(portfolioSrc).toContain("TooltipProvider");
    expect(portfolioSrc).toContain("TooltipTrigger");
    expect(portfolioSrc).toContain("TooltipContent");
  });

  it("import page imports Tooltip components", () => {
    expect(importSrc).toContain("TooltipProvider");
    expect(importSrc).toContain("TooltipContent");
  });

  it("Average Cost has tooltip in portfolio page", () => {
    expect(portfolioSrc).toContain("averageCost");
    expect(portfolioSrc).toContain("Average price paid per share");
  });

  it("Cost Basis has tooltip in portfolio page", () => {
    expect(portfolioSrc).toContain("Total amount you invested");
  });

  it("Market Value has tooltip in portfolio page", () => {
    expect(portfolioSrc).toContain("Current price × shares held");
  });

  it("G/L has tooltip in holdings table", () => {
    expect(portfolioSrc).toContain("Unrealized gain or loss");
  });

  it("Portfolio Source badge has tooltip", () => {
    expect(portfolioSrc).toContain("Positions synced from a connected broker");
    expect(portfolioSrc).toContain("Positions entered manually");
  });

  it("import preview Avg Cost column has tooltip", () => {
    expect(importSrc).toContain("Average price paid per share");
  });

  it("import preview Cost Basis column has tooltip", () => {
    expect(importSrc).toContain("Total amount invested in this position");
  });
});

// ---------------------------------------------------------------------------
// §12 Accessibility
// ---------------------------------------------------------------------------

describe("§12 — Accessibility", () => {
  it("drop zone has role=button and tabIndex for keyboard navigation", () => {
    expect(importSrc).toContain('role="button"');
    expect(importSrc).toContain("tabIndex={0}");
  });

  it("drop zone responds to Enter key", () => {
    expect(importSrc).toContain('e.key === "Enter"');
  });

  it("drop zone responds to Space key", () => {
    expect(importSrc).toContain('e.key === " "');
  });

  it("portfolio table has aria-label", () => {
    expect(portfolioSrc).toContain('aria-label="Holdings table"');
  });

  it("edit/delete buttons have aria-labels with symbol name", () => {
    expect(portfolioSrc).toContain("Edit ${p.symbol} position");
    expect(portfolioSrc).toContain("Remove ${p.symbol} from portfolio");
  });

  it("action buttons on remove row have aria-label", () => {
    expect(importSrc).toContain("Remove ${p.symbol} from import");
  });

  it("trust banner has role=list", () => {
    expect(portfolioSrc).toContain('role="list"');
  });

  it("empty state has role=region with aria-label", () => {
    expect(portfolioSrc).toContain('role="region"');
    expect(portfolioSrc).toContain('"No holdings"');
  });

  it("success screen has role=status and aria-live", () => {
    expect(importSrc).toContain('role="status"');
    expect(importSrc).toContain('aria-live="polite"');
  });

  it("invalid rows section has role=alert", () => {
    expect(importSrc).toContain('role="alert"');
  });

  it("step indicator has role=progressbar", () => {
    expect(importSrc).toContain('role="progressbar"');
  });

  it("focus-visible ring styles applied to interactive elements", () => {
    expect(portfolioSrc).toContain("focus-visible:ring-2");
    expect(importSrc).toContain("focus-visible:ring-2");
  });
});

// ---------------------------------------------------------------------------
// §13 Mobile — scrollable tables
// ---------------------------------------------------------------------------

describe("§13 — Mobile responsive", () => {
  it("holdings table wrapper has overflow-x-auto", () => {
    expect(portfolioSrc).toContain("overflow-x-auto");
  });

  it("holdings table has min-w for mobile scroll", () => {
    expect(portfolioSrc).toContain("min-w-[600px]");
  });

  it("import preview table has overflow-x-auto", () => {
    expect(importSrc).toContain("overflow-x-auto");
  });

  it("import preview table has min-w for mobile scroll", () => {
    expect(importSrc).toContain("min-w-[420px]");
  });

  it("trust banner uses responsive grid (cols-2 → sm:cols-4)", () => {
    expect(portfolioSrc).toContain("grid-cols-2");
    expect(portfolioSrc).toContain("sm:grid-cols-4");
  });

  it("sidebar uses responsive flex direction (col → sm:row)", () => {
    expect(portfolioSrc).toContain("flex-col sm:flex-row");
  });

  it("sidebar width is sm:w-56 (responsive)", () => {
    expect(portfolioSrc).toContain("sm:w-56");
  });
});

// ---------------------------------------------------------------------------
// §14 No new APIs
// ---------------------------------------------------------------------------

describe("§14 — No new APIs or backend changes", () => {
  const knownEndpoints = [
    "/api/portfolio",
    "/api/portfolio/import/csv",
    "/api/portfolio/import/xlsx",
    "/api/portfolio/import/confirm",
  ];

  it("portfolio page only uses known endpoints", () => {
    const fetchCalls = portfolioSrc.match(/fetch\("([^"]+)"/g) ?? [];
    const apiCalls   = portfolioSrc.match(/\/api\/[^"'\s]+/g) ?? [];
    apiCalls.forEach(call => {
      // Allow parameterized paths like /api/portfolio/${portfolio.id}/...
      const base = call.replace(/\$\{[^}]+\}/g, ":id");
      const isKnown = knownEndpoints.some(e => base.startsWith(e))
        || base.startsWith("/api/portfolio/:id");
      expect(isKnown).toBe(true);
    });
  });

  it("import page only uses known endpoints", () => {
    const apiCalls = importSrc.match(/\/api\/[^"'\s]+/g) ?? [];
    apiCalls.forEach(call => {
      const isKnown = knownEndpoints.some(e => call.startsWith(e));
      expect(isKnown).toBe(true);
    });
  });

  it("no new dependencies imported in portfolio.tsx beyond existing", () => {
    // No new package imports — only react, @/components, lucide-react, @tanstack/react-query, wouter
    // Regex captures bare package names (not starting with @, /, .)
    const externalImports = portfolioSrc.match(/from "([^@./][^"]+)"/g) ?? [];
    const allowed = ["react", "lucide-react", "wouter"];
    externalImports.forEach(imp => {
      const pkg = imp.match(/from "([^"]+)"/)?.[1] ?? "";
      expect(allowed.some(a => pkg.startsWith(a))).toBe(true);
    });
  });
});
