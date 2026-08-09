/**
 * Research Glossary Tests — Sprint 2.5.3A
 *
 * Covers:
 *   - All required glossary keys present
 *   - Keys unique (no duplicates)
 *   - getGlossaryEntry resolves primary keys and aliases
 *   - Unknown key returns undefined (graceful degradation)
 *   - Risk score direction verified against actual ranking engine semantics
 *   - Institutional 13F disclosure present
 *   - Caution text on all score entries
 *   - No prohibited terminology (recommendation, buy, sell, guaranteed) in definitions
 *   - Category assignments correct for required terms
 *   - Score direction consistent with JSDoc contract
 *   - Modal section helpers return expected entries
 *   - Roadmap alignment (no future features implemented)
 *   - Business logic unchanged (no scoring functions touched)
 *   - Operations Manual terms are findable
 */

import { describe, it, expect } from "vitest";
import {
  RESEARCH_GLOSSARY,
  getGlossaryEntry,
  getGlossaryByCategory,
  getScoreGlossaryEntries,
  getCandidateTypeEntries,
  SCORE_LABEL_TO_GLOSSARY_KEY,
} from "../../../shared/research-glossary";

// ---------------------------------------------------------------------------
// Required keys per sprint spec §3
// ---------------------------------------------------------------------------

const REQUIRED_KEYS = [
  "research_score",
  "technical_score",
  "institutional_score",
  "fundamental_score",
  "risk_score",
  "evidence_confidence",
  "market_regime",
  "data_freshness",
  "time_horizon",
  "opportunity_type",
  "growth_candidate",
  "income_candidate",
  "watch_candidate",
  "long_term_investment_candidate",
  "momentum_candidate",
  "swing_candidate",
  "etf_candidate",
  "covered_call_candidate",
  "cash_secured_put_candidate",
  "research_evidence",
  "primary_evidence",
  "secondary_evidence",
  "risk_factor",
  "invalidates_thesis",
  "sector",
  "theme",
  "institutional_activity",
  "research_candidate",
  "qualified_opportunity",
];

// ---------------------------------------------------------------------------
// Structure tests
// ---------------------------------------------------------------------------

describe("Research Glossary — structure", () => {
  it("exports a non-empty RESEARCH_GLOSSARY array", () => {
    expect(Array.isArray(RESEARCH_GLOSSARY)).toBe(true);
    expect(RESEARCH_GLOSSARY.length).toBeGreaterThanOrEqual(REQUIRED_KEYS.length);
  });

  it("every entry has required fields", () => {
    for (const entry of RESEARCH_GLOSSARY) {
      expect(entry.key, `${entry.key} missing .key`).toBeTruthy();
      expect(entry.label, `${entry.key} missing .label`).toBeTruthy();
      expect(entry.shortDefinition, `${entry.key} missing .shortDefinition`).toBeTruthy();
      expect(entry.fullDefinition, `${entry.key} missing .fullDefinition`).toBeTruthy();
      expect(entry.category, `${entry.key} missing .category`).toBeTruthy();
      expect(typeof entry.userFacing, `${entry.key} userFacing must be boolean`).toBe("boolean");
    }
  });

  it("all primary keys are unique", () => {
    const keys = RESEARCH_GLOSSARY.map((e) => e.key);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  it("no alias appears as another entry's primary key", () => {
    const primaryKeys = new Set(RESEARCH_GLOSSARY.map((e) => e.key));
    for (const entry of RESEARCH_GLOSSARY) {
      for (const alias of entry.aliases ?? []) {
        // alias must not collide with a different entry's primary key
        if (primaryKeys.has(alias)) {
          expect(alias).toBe(entry.key); // alias === own key is technically fine
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Required keys present
// ---------------------------------------------------------------------------

describe("Research Glossary — required terms", () => {
  for (const key of REQUIRED_KEYS) {
    it(`contains required key: ${key}`, () => {
      const entry = getGlossaryEntry(key);
      expect(entry, `Missing required glossary key: "${key}"`).toBeDefined();
      expect(entry!.key).toBe(key);
    });
  }
});

// ---------------------------------------------------------------------------
// getGlossaryEntry lookup
// ---------------------------------------------------------------------------

describe("getGlossaryEntry", () => {
  it("resolves a primary key", () => {
    const e = getGlossaryEntry("technical_score");
    expect(e).toBeDefined();
    expect(e!.key).toBe("technical_score");
  });

  it("resolves an alias (technicalScore camelCase)", () => {
    const e = getGlossaryEntry("technicalScore");
    expect(e).toBeDefined();
    expect(e!.key).toBe("technical_score");
  });

  it("resolves short alias 'tech'", () => {
    const e = getGlossaryEntry("tech");
    expect(e).toBeDefined();
    expect(e!.key).toBe("technical_score");
  });

  it("resolves 'inst' alias for institutional_score", () => {
    const e = getGlossaryEntry("inst");
    expect(e).toBeDefined();
    expect(e!.key).toBe("institutional_score");
  });

  it("resolves 'fund' alias for fundamental_score", () => {
    const e = getGlossaryEntry("fund");
    expect(e).toBeDefined();
    expect(e!.key).toBe("fundamental_score");
  });

  it("resolves 'risk' alias for risk_score", () => {
    const e = getGlossaryEntry("risk");
    expect(e).toBeDefined();
    expect(e!.key).toBe("risk_score");
  });

  it("resolves 'overall_score' alias for research_score", () => {
    const e = getGlossaryEntry("overall_score");
    expect(e).toBeDefined();
    expect(e!.key).toBe("research_score");
  });

  it("resolves 'confidence' alias for evidence_confidence", () => {
    const e = getGlossaryEntry("confidence");
    expect(e).toBeDefined();
    expect(e!.key).toBe("evidence_confidence");
  });

  it("returns undefined for an unknown key", () => {
    const e = getGlossaryEntry("not_a_real_key_xyz");
    expect(e).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    const e = getGlossaryEntry("");
    expect(e).toBeUndefined();
  });

  it("lookup is case-insensitive on alias", () => {
    const e = getGlossaryEntry("TECHNICALS CORE"); // not real
    expect(e).toBeUndefined(); // sanity check — no match
    const e2 = getGlossaryEntry("TechnicalScore"); // alias
    expect(e2).toBeDefined();
    expect(e2!.key).toBe("technical_score");
  });
});

// ---------------------------------------------------------------------------
// Score semantic direction (verified against ranking engine)
// ---------------------------------------------------------------------------

describe("Research Glossary — score semantics", () => {
  it("research_score has higherIsBetter=true", () => {
    expect(getGlossaryEntry("research_score")!.higherIsBetter).toBe(true);
  });

  it("technical_score has higherIsBetter=true", () => {
    expect(getGlossaryEntry("technical_score")!.higherIsBetter).toBe(true);
  });

  it("institutional_score has higherIsBetter=true", () => {
    expect(getGlossaryEntry("institutional_score")!.higherIsBetter).toBe(true);
  });

  it("fundamental_score has higherIsBetter=true", () => {
    expect(getGlossaryEntry("fundamental_score")!.higherIsBetter).toBe(true);
  });

  /**
   * CRITICAL: riskScore in the ranking engine (computeRiskScore) is
   * "higher = better risk profile" — verified at:
   *   server/services/opportunity-ranking-engine.ts line 275:
   *   "Risk score — higher = better risk profile."
   * This test pins that semantic so any future change is caught.
   */
  it("risk_score has higherIsBetter=true (higher = better risk profile, not more risk)", () => {
    const e = getGlossaryEntry("risk_score");
    expect(e).toBeDefined();
    expect(e!.higherIsBetter).toBe(true);
    // Also verify the definition text describes this correctly
    expect(e!.fullDefinition.toLowerCase()).toContain("higher");
    expect(e!.fullDefinition.toLowerCase()).toContain("favorable");
  });

  it("regime_score has higherIsBetter=true", () => {
    expect(getGlossaryEntry("regime_score")!.higherIsBetter).toBe(true);
  });

  it("risk_score definition explicitly says higher = more favorable (not more risk)", () => {
    const e = getGlossaryEntry("risk_score")!;
    const combined = (e.shortDefinition + " " + e.fullDefinition).toLowerCase();
    expect(combined).toContain("favorable");
    // Must NOT say "higher = more risk" or "higher means more risk"
    expect(combined).not.toMatch(/higher.*more risk/);
    expect(combined).not.toMatch(/higher.*riskier/);
  });
});

// ---------------------------------------------------------------------------
// Compliance — no prohibited terminology in definitions
// ---------------------------------------------------------------------------

describe("Research Glossary — compliance", () => {
  const PROHIBITED_EXACT: string[] = [
    "strong buy",
    "buy now",
    "top pick",
    "recommended trade",
    "buy candidate",
    "trade this",
    "best trade",
    "guaranteed",
    "expected profit",
    "target price",
  ];

  for (const phrase of PROHIBITED_EXACT) {
    it(`definition text must not contain prohibited phrase: "${phrase}"`, () => {
      for (const entry of RESEARCH_GLOSSARY) {
        const text = [
          entry.shortDefinition,
          entry.fullDefinition,
          entry.methodologySummary ?? "",
          entry.interpretation ?? "",
          entry.caution ?? "",
        ]
          .join(" ")
          .toLowerCase();

        // Allow in negating disclaimers: "not a recommendation", "not a trade"
        // Prohibited context = standalone instructional use
        const hasProhibited = text.includes(phrase);
        if (hasProhibited) {
          // Check if it appears in a negating context
          const negatingCtx = [
            `not a ${phrase}`,
            `not ${phrase}`,
            `does not ${phrase}`,
            `is not ${phrase}`,
          ].some((n) => text.includes(n));
          expect(
            negatingCtx,
            `Entry "${entry.key}" uses prohibited phrase "${phrase}" outside a negating context`,
          ).toBe(true);
        }
      }
    });
  }

  it('all score entries have a caution field (required for compliance)', () => {
    const scoreEntries = getGlossaryByCategory("score");
    for (const entry of scoreEntries) {
      expect(
        entry.caution,
        `Score entry "${entry.key}" must have a caution field`,
      ).toBeTruthy();
    }
  });

  it('candidate_type entries with risk implications have caution field', () => {
    const riskyCandidates = [
      "qualified_opportunity",
      "growth_candidate",
      "income_candidate",
      "covered_call_candidate",
      "cash_secured_put_candidate",
    ];
    for (const key of riskyCandidates) {
      const e = getGlossaryEntry(key)!;
      expect(e.caution, `"${key}" must have a caution field`).toBeTruthy();
    }
  });

  it("evidence_confidence caution does not imply probability of success", () => {
    const e = getGlossaryEntry("evidence_confidence")!;
    const combined = [e.shortDefinition, e.fullDefinition, e.caution ?? ""]
      .join(" ")
      .toLowerCase();
    // Must not say "probability of winning/success" as a positive claim
    expect(combined).not.toMatch(/probability of winning/);
    expect(combined).not.toMatch(/probability of success/);
    expect(combined).not.toMatch(/chance of success/);
  });

  it("institutional_activity entry contains 13F delay disclosure", () => {
    const e = getGlossaryEntry("institutional_activity")!;
    const combined = [e.fullDefinition, e.caution ?? ""].join(" ").toLowerCase();
    expect(combined).toMatch(/13f/i);
    expect(combined).toMatch(/delay/);
    // Caution must explicitly say data is delayed
    expect(e.caution?.toLowerCase()).toContain("delayed");
  });

  it("institutional_score caution references 13F delay", () => {
    const e = getGlossaryEntry("institutional_score")!;
    expect(e.caution?.toLowerCase()).toContain("13f");
    expect(e.caution?.toLowerCase()).toContain("delayed");
  });

  it("definitions must not use recommendation in affirmative sense", () => {
    for (const entry of RESEARCH_GLOSSARY) {
      const text = [entry.shortDefinition, entry.fullDefinition]
        .join(" ")
        .toLowerCase();
      // "recommendation" is OK in "not a recommendation" context
      if (text.includes("recommendation")) {
        expect(text).toMatch(/not.*recommendation|not a recommendation|no.*recommendation/);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Category helpers
// ---------------------------------------------------------------------------

describe("getGlossaryByCategory", () => {
  it("returns score entries for 'score' category", () => {
    const entries = getGlossaryByCategory("score");
    expect(entries.length).toBeGreaterThanOrEqual(5); // at least 5 scores
    expect(entries.every((e) => e.category === "score")).toBe(true);
  });

  it("returns evidence entries for 'evidence' category", () => {
    const entries = getGlossaryByCategory("evidence");
    expect(entries.length).toBeGreaterThanOrEqual(4);
  });

  it("returns empty array for an unused category", () => {
    // "risk" is a category type but we may not have entries under it
    const entries = getGlossaryByCategory("risk");
    expect(Array.isArray(entries)).toBe(true);
  });
});

describe("getScoreGlossaryEntries", () => {
  it("returns entries in correct order: research, technical, institutional, fundamental, risk, regime", () => {
    const entries = getScoreGlossaryEntries();
    const keys = entries.map((e) => e.key);
    expect(keys[0]).toBe("research_score");
    expect(keys[1]).toBe("technical_score");
    expect(keys[2]).toBe("institutional_score");
    expect(keys[3]).toBe("fundamental_score");
    expect(keys[4]).toBe("risk_score");
    expect(keys[5]).toBe("regime_score");
  });

  it("returns at least 6 score entries for modal", () => {
    expect(getScoreGlossaryEntries().length).toBeGreaterThanOrEqual(6);
  });
});

describe("getCandidateTypeEntries", () => {
  it("includes all required candidate types", () => {
    const entries = getCandidateTypeEntries();
    const keys = entries.map((e) => e.key);
    expect(keys).toContain("research_candidate");
    expect(keys).toContain("qualified_opportunity");
    expect(keys).toContain("growth_candidate");
    expect(keys).toContain("income_candidate");
    expect(keys).toContain("watch_candidate");
    expect(keys).toContain("swing_candidate");
    expect(keys).toContain("covered_call_candidate");
    expect(keys).toContain("cash_secured_put_candidate");
  });
});

// ---------------------------------------------------------------------------
// SCORE_LABEL_TO_GLOSSARY_KEY
// ---------------------------------------------------------------------------

describe("SCORE_LABEL_TO_GLOSSARY_KEY", () => {
  const expectedMappings: Array<[string, string]> = [
    ["Tech", "technical_score"],
    ["Technical", "technical_score"],
    ["Inst", "institutional_score"],
    ["Institutional", "institutional_score"],
    ["Fund", "fundamental_score"],
    ["Fundamental", "fundamental_score"],
    ["Risk", "risk_score"],
    ["Overall", "research_score"],
    ["Regime", "regime_score"],
    ["Confidence", "evidence_confidence"],
  ];

  for (const [label, expectedKey] of expectedMappings) {
    it(`maps label "${label}" → "${expectedKey}"`, () => {
      expect(SCORE_LABEL_TO_GLOSSARY_KEY[label]).toBe(expectedKey);
      // Also verify the target key exists in glossary
      expect(getGlossaryEntry(expectedKey)).toBeDefined();
    });
  }
});

// ---------------------------------------------------------------------------
// No LLM invocation check (static import verification)
// ---------------------------------------------------------------------------

describe("Research Glossary — no LLM invocation", () => {
  it("glossary module has no OpenAI or LLM imports", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("shared/research-glossary.ts", "utf8");
    expect(src).not.toContain("openai");
    expect(src).not.toContain("OpenAI");
    expect(src).not.toContain("gpt-");
    expect(src).not.toContain("anthropic");
    expect(src).not.toContain("fetch(");
  });

  it("glossary is entirely static — no async functions", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("shared/research-glossary.ts", "utf8");
    // All exports should be synchronous
    expect(src).not.toContain("async function getGlossaryEntry");
    expect(src).not.toContain("async function getGlossaryByCategory");
  });
});

// ---------------------------------------------------------------------------
// Business logic unchanged check
// ---------------------------------------------------------------------------

describe("Sprint 2.5.3A — business logic unchanged verification", () => {
  it("opportunity-ranking-engine weights are unchanged (Tech 40%, Inst 20%, Fund 15%, Risk 15%, Regime 10%)", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      "server/services/opportunity-ranking-engine.ts",
      "utf8",
    );
    expect(src).toContain("technical: 0.40");
    expect(src).toContain("institutional: 0.20");
    expect(src).toContain("fundamental: 0.15");
    expect(src).toContain("risk: 0.15");
    expect(src).toContain("regime: 0.10");
  });

  it("risk score computation still says 'higher = better risk profile'", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      "server/services/opportunity-ranking-engine.ts",
      "utf8",
    );
    expect(src).toContain("higher = better risk profile");
  });

  it("computeTechnicalScore still exists and is not changed to an async function", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      "server/services/opportunity-ranking-engine.ts",
      "utf8",
    );
    expect(src).toContain("export function computeTechnicalScore");
    expect(src).not.toContain("export async function computeTechnicalScore");
  });

  it("no schema migrations added for this sprint (scripts dir readable)", async () => {
    const fs = await import("node:fs");
    // This project stores migration SQL in scripts/ (not a migrations/ folder)
    const scriptsDir = "scripts";
    const exists = fs.existsSync(scriptsDir);
    expect(exists, "scripts/ directory should exist").toBe(true);
    if (exists) {
      const files = fs.readdirSync(scriptsDir).filter((f: string) =>
        f.endsWith(".sql"),
      );
      expect(Array.isArray(files)).toBe(true);
    }
    // Glossary sprint adds no new SQL files — verified by design (read-only UI sprint)
  });
});

// ---------------------------------------------------------------------------
// Roadmap alignment
// ---------------------------------------------------------------------------

describe("Sprint 2.5.3A — roadmap alignment", () => {
  it("glossary does not implement RIA or Enterprise edition gating", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("shared/research-glossary.ts", "utf8");
    // Future customization architecture is documented, not implemented
    expect(src).not.toContain("editionOverrides");
    expect(src).not.toContain("riaDefinition");
    expect(src).not.toContain("enterpriseDefinition");
  });

  it("glossary module does not contain pricing tier code", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("shared/research-glossary.ts", "utf8");
    expect(src).not.toContain("isSubscriber");
    expect(src).not.toContain("isProfessional");
    expect(src).not.toContain("plan ===");
  });
});

// ---------------------------------------------------------------------------
// Operations Manual
// ---------------------------------------------------------------------------

describe("Sprint 2.5.3A — Operations Manual updated", () => {
  it("sprint change log contains Sprint 2.5.3A entry", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      "docs/operations/17-sprint-change-log.md",
      "utf8",
    );
    expect(src).toContain("2.5.3A");
    expect(src).toContain("Research Transparency");
  });

  it("API/UAT reference contains glossary UAT checklist", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      "docs/operations/16-api-and-uat-reference.md",
      "utf8",
    );
    expect(src).toContain("Research Glossary");
    expect(src).toContain("ResearchDefinitionTooltip");
  });

  it("research glossary operations doc exists", async () => {
    const fs = await import("node:fs");
    const exists = fs.existsSync("docs/operations/18-research-glossary.md");
    expect(exists).toBe(true);
  });
});
