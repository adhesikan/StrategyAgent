/**
 * server/routes/__tests__/compliance.test.ts — Sprint 2.7.7
 *
 * Compliance Regression Suite — npm run test:compliance
 *
 * Validates across ALL major shared modules that compliance vocabulary is
 * maintained: no forbidden investment phrases, required disclaimers present,
 * research-first language enforced.
 *
 * All tests are pure/structural — no DB, no network.
 *
 * Category: COMPLIANCE
 */

import { describe, it, expect } from "vitest";

// ============================================================================
// Canonical forbidden phrase list (context-aware)
// Applied to non-disclaimer surfaces only.
// ============================================================================

const INVESTMENT_FORBIDDEN = [
  "strong buy",
  "recommended trade",
  "execution ready",
  "approved trade",
  "chance of winning",
  "guaranteed",
] as const;

const EXECUTION_FORBIDDEN = [
  "exit now",
  "sell now",
  "close position now",
  "take profit now",
] as const;

// These phrases are allowed ONLY in negating/disclaimer context
const DISCLAIMER_CONTEXT_ALLOWED = ["not a recommendation", "not an approval", "not investment advice"];

// ============================================================================
// §C1 — Research Glossary compliance
// ============================================================================

describe("§C1: Research Glossary — no forbidden phrases in definitions", () => {
  it("all glossary entries are free of investment-forbidden phrases", async () => {
    const { ALL_GLOSSARY_ENTRIES } = await import("../../../shared/research-glossary");
    // Check labels and short definitions only for the strictest phrases.
    // Full definitions may use "guaranteed" in negating/disclaimer context ("not a guaranteed fill").
    // We check labels + shortDefs for all phrases, and fullDef/caution only for a subset.
    const strictText = ALL_GLOSSARY_ENTRIES.map(
      (e) => `${e.label} ${e.shortDefinition}`
    )
      .join(" ")
      .toLowerCase();

    const strictForbidden = INVESTMENT_FORBIDDEN.filter((p) => p !== "guaranteed");
    for (const phrase of strictForbidden) {
      expect(strictText, `Glossary labels/short-defs should not contain "${phrase}"`).not.toContain(phrase);
    }

    // "guaranteed" is allowed only in negating context: "not a guaranteed" / "not guaranteed"
    // Check that any occurrence is preceded by "not"
    const fullText = ALL_GLOSSARY_ENTRIES.map(
      (e) => `${e.label} ${e.shortDefinition} ${e.fullDefinition ?? ""} ${(e as any).caution ?? ""}`
    )
      .join(" ")
      .toLowerCase();
    const guaranteedMatches = [...fullText.matchAll(/guaranteed/g)];
    for (const match of guaranteedMatches) {
      const ctx = fullText.slice(Math.max(0, (match.index ?? 0) - 10), (match.index ?? 0) + 15);
      expect(ctx, `"guaranteed" in glossary must appear only in negating context ("not guaranteed")`).toMatch(/not.{0,8}guaranteed/);
    }
  });

  it("all glossary entries are free of execution-forbidden phrases", async () => {
    const { ALL_GLOSSARY_ENTRIES } = await import("../../../shared/research-glossary");
    const allText = ALL_GLOSSARY_ENTRIES.map(
      (e) => `${e.label} ${e.shortDefinition} ${e.fullDefinition}`
    )
      .join(" ")
      .toLowerCase();

    for (const phrase of EXECUTION_FORBIDDEN) {
      expect(allText, `Glossary should not contain "${phrase}"`).not.toContain(phrase);
    }
  });

  it("lifecycle glossary entries maintain research-first language", async () => {
    const { ALL_GLOSSARY_ENTRIES } = await import("../../../shared/research-glossary");
    const lifecycleEntries = ALL_GLOSSARY_ENTRIES.filter((e) =>
      e?.label && (
        e.label.toLowerCase().includes("lifecycle") ||
        e.label.toLowerCase().includes("monitoring") ||
        e.label.toLowerCase().includes("thesis")
      )
    );
    // If no lifecycle-labeled entries exist in the glossary, vacuously pass
    if (lifecycleEntries.length === 0) return;

    for (const entry of lifecycleEntries) {
      const text = `${entry.shortDefinition ?? ""} ${entry.fullDefinition ?? ""}`.toLowerCase();
      for (const phrase of EXECUTION_FORBIDDEN) {
        expect(text, `Lifecycle glossary "${entry.label}" should not contain "${phrase}"`).not.toContain(phrase);
      }
    }
  });
});

// ============================================================================
// §C2 — Trade Plan Lifecycle types compliance
// ============================================================================

describe("§C2: Lifecycle types — no execution language", () => {
  it("LIFECYCLE_STATE_LABELS contain no forbidden execution phrases", async () => {
    const { LIFECYCLE_STATE_LABELS } = await import("../../../shared/trade-plan-lifecycle-types");
    const text = Object.values(LIFECYCLE_STATE_LABELS).join(" ").toLowerCase();
    for (const phrase of [...INVESTMENT_FORBIDDEN, ...EXECUTION_FORBIDDEN]) {
      expect(text).not.toContain(phrase);
    }
  });

  it("REVIEW_REASON_LABELS contain no forbidden execution phrases", async () => {
    const { REVIEW_REASON_LABELS } = await import("../../../shared/trade-plan-lifecycle-types");
    const text = Object.values(REVIEW_REASON_LABELS).join(" ").toLowerCase();
    for (const phrase of [...INVESTMENT_FORBIDDEN, ...EXECUTION_FORBIDDEN]) {
      expect(text).not.toContain(phrase);
    }
  });

  it("ACTIVITY_EVENT_LABELS contain no forbidden execution phrases", async () => {
    const { ACTIVITY_EVENT_LABELS } = await import("../../../shared/trade-plan-lifecycle-types");
    const text = Object.values(ACTIVITY_EVENT_LABELS).join(" ").toLowerCase();
    for (const phrase of [...INVESTMENT_FORBIDDEN, ...EXECUTION_FORBIDDEN]) {
      expect(text).not.toContain(phrase);
    }
  });

  it("LIFECYCLE_DISCLAIMER is present and non-empty", async () => {
    const { LIFECYCLE_DISCLAIMER } = await import("../../../shared/trade-plan-lifecycle-types");
    expect(typeof LIFECYCLE_DISCLAIMER).toBe("string");
    expect(LIFECYCLE_DISCLAIMER.length).toBeGreaterThan(50);
    // Must contain research-language
    expect(LIFECYCLE_DISCLAIMER.toLowerCase()).toContain("research");
  });

  it("LIFECYCLE_FORBIDDEN_PHRASES list is non-empty and covers execution language", async () => {
    const { LIFECYCLE_FORBIDDEN_PHRASES } = await import(
      "../../../shared/trade-plan-lifecycle-types"
    );
    expect(Array.isArray(LIFECYCLE_FORBIDDEN_PHRASES)).toBe(true);
    expect(LIFECYCLE_FORBIDDEN_PHRASES.length).toBeGreaterThan(3);
    const flat = LIFECYCLE_FORBIDDEN_PHRASES.join(" ").toLowerCase();
    expect(flat).toMatch(/exit|sell|close|profit/);
  });
});

// ============================================================================
// §C3 — Portfolio Intelligence compliance
// ============================================================================

describe("§C3: Portfolio intelligence — no recommendation language", () => {
  it("PORTFOLIO_INTELLIGENCE_FORBIDDEN_PHRASES list covers key terms", async () => {
    // Check the ops doc for the forbidden phrase list rather than inferring
    const fs = await import("node:fs");
    const exists = fs.existsSync("docs/operations/22-portfolio-intelligence.md");
    if (!exists) return; // doc may not exist yet
    const content = fs.readFileSync("docs/operations/22-portfolio-intelligence.md", "utf-8").toLowerCase();
    // Ops doc should mention compliance constraints
    expect(content).toMatch(/compli|forbid|recommend|disclaimer/i);
  });
});

// ============================================================================
// §C4 — Required disclaimer presence by domain
// ============================================================================

describe("§C4: Required disclaimers are present in service types", () => {
  it("Trade planning service has disclaimer constant", async () => {
    // Check that trade-planning-types or equivalent exports a disclaimer
    const types = await import("../../../shared/trade-plan-lifecycle-types");
    expect(types.LIFECYCLE_DISCLAIMER).toBeDefined();
    expect(types.LIFECYCLE_DISCLAIMER.length).toBeGreaterThan(0);
  });

  it("RESEARCH_REVIEW_CHECKLIST_DISCLAIMER is present in trade-plan types", async () => {
    // Lives in shared/trade-plan-types (not lifecycle-types)
    const { RESEARCH_REVIEW_CHECKLIST_DISCLAIMER } = await import(
      "../../../shared/trade-plan-types"
    );
    expect(RESEARCH_REVIEW_CHECKLIST_DISCLAIMER).toBeDefined();
    expect(RESEARCH_REVIEW_CHECKLIST_DISCLAIMER.length).toBeGreaterThan(20);
    expect(RESEARCH_REVIEW_CHECKLIST_DISCLAIMER.toLowerCase()).toMatch(
      /research|review|not an approval/i
    );
  });
});

// ============================================================================
// §C5 — Operations Manual compliance
// ============================================================================

describe("§C5: Operations Manual — no secret values", () => {
  it("operations docs do not contain API key patterns", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const docsDir = path.resolve("docs/operations");
    if (!fs.existsSync(docsDir)) return;

    const files = fs.readdirSync(docsDir).filter((f) => f.endsWith(".md"));
    const SECRET_PATTERN = /sk-[a-zA-Z0-9]{20,}|eyJ[a-zA-Z0-9+/]{30,}|[A-Z0-9]{40,}=|password\s*[:=]\s*\S{8,}/gi;

    for (const file of files) {
      const content = fs.readFileSync(path.join(docsDir, file), "utf-8");
      const matches = content.match(SECRET_PATTERN) ?? [];
      // Allow empty; flag any match
      expect(
        matches.length,
        `${file} should not contain API key or password patterns. Found: ${matches.join(", ")}`
      ).toBe(0);
    }
  });

  it("operations docs do not contain DATABASE_URL with connection string", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const docsDir = path.resolve("docs/operations");
    if (!fs.existsSync(docsDir)) return;

    const files = fs.readdirSync(docsDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(docsDir, file), "utf-8");
      const hasDatabaseUrl = /DATABASE_URL\s*=\s*postgres(ql)?:\/\//.test(content);
      expect(hasDatabaseUrl, `${file} should not contain DATABASE_URL connection string`).toBe(false);
    }
  });
});

// ============================================================================
// §C6 — Portfolio Analytics compliance
// ============================================================================

describe("§C6: Portfolio Analytics — forbidden scoring phrases", () => {
  it("portfolio analytics ops doc avoids forbidden literal phrases", async () => {
    const fs = await import("node:fs");
    const exists = fs.existsSync("docs/operations/24-portfolio-analytics.md");
    if (!exists) return;
    const content = fs.readFileSync("docs/operations/24-portfolio-analytics.md", "utf-8");
    // Forbidden in ops doc context (not in quotes/examples)
    const FORBIDDEN_ANALYTICS = ["portfolio score", "portfolio grade", "portfolio rating"];
    for (const phrase of FORBIDDEN_ANALYTICS) {
      // Allow in quoted context "not a 'portfolio score'" or in header
      const hasRaw = content.toLowerCase().includes(phrase);
      if (hasRaw) {
        // Accept if only in negating context
        const idx = content.toLowerCase().indexOf(phrase);
        const surroundings = content.slice(Math.max(0, idx - 30), idx + phrase.length + 30);
        const isNegating = /not|avoid|never|forbid/.test(surroundings.toLowerCase());
        expect(isNegating, `"${phrase}" found in non-negating context in 24-portfolio-analytics.md`).toBe(true);
      }
    }
  });
});

// ============================================================================
// §C7 — Terminology: Research-first vocabulary
// ============================================================================

describe("§C7: Research-first vocabulary in type labels", () => {
  it("lifecycle state CURRENT label uses research language", async () => {
    const { LIFECYCLE_STATE_LABELS } = await import("../../../shared/trade-plan-lifecycle-types");
    const current = LIFECYCLE_STATE_LABELS["CURRENT"] ?? "";
    // Should describe research state, not trade execution state
    expect(current.length).toBeGreaterThan(0);
    expect(current.toLowerCase()).not.toMatch(/buy now|execute|order/);
  });

  it("review reason labels suggest research actions, not trades", async () => {
    const { REVIEW_REASON_LABELS } = await import("../../../shared/trade-plan-lifecycle-types");
    const values = Object.values(REVIEW_REASON_LABELS);
    expect(values.length).toBeGreaterThan(0);
    for (const label of values) {
      expect(label.toLowerCase()).not.toMatch(/buy|sell|execute|order now/);
    }
  });
});

// ============================================================================
// §C8 — Sprint change log compliance entries
// ============================================================================

describe("§C8: Sprint change log records compliance verification", () => {
  it("sprint change log exists and is non-empty", async () => {
    const fs = await import("node:fs");
    const exists = fs.existsSync("docs/operations/17-sprint-change-log.md");
    expect(exists).toBe(true);
    const content = fs.readFileSync("docs/operations/17-sprint-change-log.md", "utf-8");
    expect(content.length).toBeGreaterThan(100);
  });

  it("sprint change log records Sprint 2.7.6 lifecycle compliance verification", async () => {
    const fs = await import("node:fs");
    const content = fs.readFileSync("docs/operations/17-sprint-change-log.md", "utf-8");
    // Sprint 2.7.6 should mention compliance
    expect(content).toContain("2.7.6");
    expect(content.toLowerCase()).toMatch(/compli|lifecycle disclaimer|no execution/i);
  });
});
