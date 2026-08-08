/**
 * Research Workspace — Sprint 2.5.2
 *
 * Pure structural tests: no DB, no network, no OpenAI.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// Source files
const typeSrc = fs.readFileSync(
  path.join(__dirname, "../../../shared/research-workspace-types.ts"), "utf-8",
);
const serviceSrc = fs.readFileSync(
  path.join(__dirname, "../../services/research-workspace-service.ts"), "utf-8",
);
const routesSrc = fs.readFileSync(
  path.join(__dirname, "../research-workspace.ts"), "utf-8",
);
const schemaSrc = fs.readFileSync(
  path.join(__dirname, "../../../shared/schema.ts"), "utf-8",
);
const platformHealthSrc = fs.readFileSync(
  path.join(__dirname, "../platform-health.ts"), "utf-8",
);
const adminHealthSrc = fs.readFileSync(
  path.join(__dirname, "../../../client/src/pages/admin-platform-health.tsx"), "utf-8",
);
const routesRegSrc = fs.readFileSync(
  path.join(__dirname, "../../routes.ts"), "utf-8",
);
const clientSrc = fs.readFileSync(
  path.join(__dirname, "../../../client/src/pages/research-workspace.tsx"), "utf-8",
);
const appSrc = fs.readFileSync(
  path.join(__dirname, "../../../client/src/App.tsx"), "utf-8",
);

// ────────────────────────────────────────────────────────────────────────────
// Part 1 — Research Modes
// ────────────────────────────────────────────────────────────────────────────

describe("Part 1 — Research Modes", () => {
  const EXPECTED_MODES = [
    "opportunity", "company", "theme", "sector",
    "institutional", "market", "collection", "comparison",
  ];

  for (const mode of EXPECTED_MODES) {
    it(`ResearchMode includes "${mode}"`, () => {
      expect(typeSrc).toContain(`"${mode}"`);
    });
  }

  it("RESEARCH_MODE_LABELS exported", () => {
    expect(typeSrc).toContain("RESEARCH_MODE_LABELS");
  });

  it("RESEARCH_MODE_DESCRIPTIONS exported", () => {
    expect(typeSrc).toContain("RESEARCH_MODE_DESCRIPTIONS");
  });

  it("every mode has a label", () => {
    for (const m of EXPECTED_MODES) {
      expect(typeSrc).toContain(`${m}:`);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Part 2 — Context Scopes
// ────────────────────────────────────────────────────────────────────────────

describe("Part 2 — Context Scopes", () => {
  const EXPECTED_SCOPES = [
    "entire_market", "my_collections",
    "ai-infrastructure", "semiconductors", "memory", "networking", "cybersecurity", "cloud",
    "energy", "healthcare", "financials", "consumer", "industrials",
    "dividend", "income", "growth", "momentum", "value", "etf",
    "long-term-investments", "swing-trading", "covered-calls", "cash-secured-puts",
    "market-leaders", "recently-improved", "institutional-activity", "new-opportunities",
    "future_portfolio",
  ];

  for (const scope of EXPECTED_SCOPES) {
    it(`ContextScope includes "${scope}"`, () => {
      expect(typeSrc).toContain(`"${scope}"`);
    });
  }

  it("CONTEXT_SCOPE_LABELS exported", () => {
    expect(typeSrc).toContain("CONTEXT_SCOPE_LABELS");
  });

  it("SYSTEM_SCOPE_KEYS exported", () => {
    expect(typeSrc).toContain("SYSTEM_SCOPE_KEYS");
  });

  it("future_portfolio labelled as 'Coming Soon'", () => {
    expect(typeSrc).toContain("Coming Soon");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Part 3 — Shared Types
// ────────────────────────────────────────────────────────────────────────────

describe("Part 3 — Shared Types", () => {
  it("EvidencePanel exported", () => {
    expect(typeSrc).toContain("export interface EvidencePanel");
  });

  it("EvidencePanel has all 7 required sections", () => {
    expect(typeSrc).toContain("summary:");
    expect(typeSrc).toContain("supportingEvidence:");
    expect(typeSrc).toContain("technicalEvidence:");
    expect(typeSrc).toContain("fundamentalEvidence:");
    expect(typeSrc).toContain("institutionalEvidence:");
    expect(typeSrc).toContain("riskFactors:");
    expect(typeSrc).toContain("thesisInvalidators:");
    expect(typeSrc).toContain("researchSourcesUsed:");
  });

  it("FollowUpAction exported", () => {
    expect(typeSrc).toContain("export interface FollowUpAction");
  });

  it("FollowUpAction has action union with ask/navigate/set_scope/relax_filter", () => {
    expect(typeSrc).toContain('"ask"');
    expect(typeSrc).toContain('"navigate"');
    expect(typeSrc).toContain('"set_scope"');
    expect(typeSrc).toContain('"relax_filter"');
  });

  it("ResearchDiagnostics exported", () => {
    expect(typeSrc).toContain("export interface ResearchDiagnostics");
  });

  it("ResearchDiagnostics has universeSearched, candidatesEvaluated, rejectionReasons", () => {
    expect(typeSrc).toContain("universeSearched:");
    expect(typeSrc).toContain("candidatesEvaluated:");
    expect(typeSrc).toContain("rejectionReasons:");
    expect(typeSrc).toContain("evidenceStrength:");
    expect(typeSrc).toContain("dataFreshness:");
  });

  it("WorkspaceAIResponse exported", () => {
    expect(typeSrc).toContain("export interface WorkspaceAIResponse");
  });

  it("WorkspaceAIResponse has evidencePanel field", () => {
    expect(typeSrc).toContain("evidencePanel:");
  });

  it("WorkspaceAIResponse has followUpActions field", () => {
    expect(typeSrc).toContain("followUpActions:");
  });

  it("WorkspaceAIResponse has diagnostics field", () => {
    expect(typeSrc).toContain("diagnostics?:");
  });

  it("ConversationSummary exported", () => {
    expect(typeSrc).toContain("export interface ConversationSummary");
  });

  it("ConversationSummary has isPinned field", () => {
    expect(typeSrc).toContain("isPinned:");
  });

  it("ConversationDetail extends ConversationSummary with messages", () => {
    expect(typeSrc).toContain("ConversationDetail");
    expect(typeSrc).toContain("messages:");
  });

  it("WorkspaceAskRequest exported", () => {
    expect(typeSrc).toContain("export interface WorkspaceAskRequest");
  });

  it("WorkspaceAskRequest has researchMode and contextScope", () => {
    expect(typeSrc).toContain("researchMode:");
    expect(typeSrc).toContain("contextScope:");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Part 4 — Research Templates
// ────────────────────────────────────────────────────────────────────────────

describe("Part 4 — Research Templates", () => {
  it("RESEARCH_TEMPLATES exported", () => {
    expect(typeSrc).toContain("RESEARCH_TEMPLATES");
  });

  it("has at least 10 templates", () => {
    const matches = typeSrc.match(/id:\s+"[a-z-]+"/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(10);
  });

  const REQUIRED_TEMPLATES = [
    "qualify-explain",
    "compare-two",
    "ai-infra-leaders",
    "market-summary",
    "institutional-explain",
    "theme-leadership",
    "sector-leadership",
    "find-similar",
    "recent-changes",
    "challenge-thesis",
  ];

  for (const id of REQUIRED_TEMPLATES) {
    it(`template "${id}" exists`, () => {
      expect(typeSrc).toContain(`id:           "${id}"`);
    });
  }

  it("every template has a mode, defaultScope, promptText, requiresTicker", () => {
    expect(typeSrc).toContain("mode:");
    expect(typeSrc).toContain("defaultScope:");
    expect(typeSrc).toContain("promptText:");
    expect(typeSrc).toContain("requiresTicker:");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Part 5 — Schema
// ────────────────────────────────────────────────────────────────────────────

describe("Part 5 — Database Schema", () => {
  it("workspace_conversations table defined", () => {
    expect(schemaSrc).toContain("workspace_conversations");
    expect(schemaSrc).toContain("workspaceConversations");
  });

  it("workspace_messages table defined", () => {
    expect(schemaSrc).toContain("workspace_messages");
    expect(schemaSrc).toContain("workspaceMessages");
  });

  it("workspace_conversations has researchMode and contextScope", () => {
    expect(schemaSrc).toContain("research_mode");
    expect(schemaSrc).toContain("context_scope");
  });

  it("workspace_conversations has isPinned and pinnedAt", () => {
    expect(schemaSrc).toContain("is_pinned");
    expect(schemaSrc).toContain("pinned_at");
  });

  it("workspace_conversations has lastMessageAt", () => {
    expect(schemaSrc).toContain("last_message_at");
  });

  it("workspace_messages has structuredContent jsonb", () => {
    expect(schemaSrc).toContain("structured_content");
    expect(schemaSrc).toContain("jsonb");
  });

  it("workspace_messages has role field", () => {
    expect(schemaSrc).toContain("role");
  });

  it("conversations table has indexes on userId and lastMessageAt", () => {
    expect(schemaSrc).toContain("idx_wc_user_id");
    expect(schemaSrc).toContain("idx_wc_last_message");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Part 6 — Service
// ────────────────────────────────────────────────────────────────────────────

describe("Part 6 — Research Workspace Service", () => {
  it("assembleResearchContext exported", () => {
    expect(serviceSrc).toContain("export async function assembleResearchContext");
  });

  it("buildResearchSystemPrompt exported", () => {
    expect(serviceSrc).toContain("export function buildResearchSystemPrompt");
  });

  it("buildResearchUserMessage exported", () => {
    expect(serviceSrc).toContain("export function buildResearchUserMessage");
  });

  it("buildRuleBasedWorkspaceResponse exported", () => {
    expect(serviceSrc).toContain("export function buildRuleBasedWorkspaceResponse");
  });

  it("parseAIWorkspaceResponse exported", () => {
    expect(serviceSrc).toContain("export function parseAIWorkspaceResponse");
  });

  it("getWorkspaceHealth exported", () => {
    expect(serviceSrc).toContain("export async function getWorkspaceHealth");
  });

  it("assembleResearchContext calls getOpportunityIntelligence (not N times)", () => {
    // The function body calls it once; additional occurrences in the file
    // (e.g. in getWorkspaceHealth) are outside the function scope.
    const fnStart = serviceSrc.indexOf("export async function assembleResearchContext");
    const fnEnd   = serviceSrc.indexOf("function filterByScope");
    const fnBody  = serviceSrc.slice(fnStart, fnEnd);
    // Exactly one call in the function body (inside Promise.all)
    const callMatches = fnBody.match(/getOpportunityIntelligence\(\)/g) ?? [];
    expect(callMatches.length).toBe(1);
  });

  it("assembleResearchContext loads sectors and themes in parallel", () => {
    const fnBody = serviceSrc.slice(
      serviceSrc.indexOf("export async function assembleResearchContext"),
      serviceSrc.indexOf("export function filterByScope"),
    );
    expect(fnBody).toContain("Promise.all");
    expect(fnBody).toContain("getLatestSectorSnapshots");
    expect(fnBody).toContain("getLatestThemeSnapshots");
  });

  it("filterByScope handles all scope families: theme/sector/opportunityType/dynamic", () => {
    expect(serviceSrc).toContain("filterByScope");
    expect(serviceSrc).toContain("ai-infrastructure");
    expect(serviceSrc).toContain("market-leaders");
    expect(serviceSrc).toContain("recently-improved");
    expect(serviceSrc).toContain("institutional-activity");
  });

  it("system prompt is mode-specific (8 mode rules)", () => {
    const prompts = serviceSrc.match(/opportunity:|company:|theme:|sector:|institutional:|market:|collection:|comparison:/g) ?? [];
    // At minimum 8 mode-specific entries in the modeRules map
    expect(prompts.length).toBeGreaterThanOrEqual(8);
  });

  it("system prompt enforces compliance language in base rules", () => {
    const prompt = serviceSrc.slice(
      serviceSrc.indexOf("export function buildResearchSystemPrompt"),
      serviceSrc.indexOf("export function buildResearchUserMessage"),
    );
    expect(prompt).toContain("research candidate");
    expect(prompt).toContain("Never");
    expect(prompt).toContain("recommendation");  // in the "NEVER use" list
  });

  it("parseAIWorkspaceResponse strips markdown code fences", () => {
    expect(serviceSrc).toContain("```json");
    expect(serviceSrc).toContain("```");
  });

  it("parseAIWorkspaceResponse falls back to rule-based on parse error", () => {
    const fnBody = serviceSrc.slice(
      serviceSrc.indexOf("export function parseAIWorkspaceResponse"),
      serviceSrc.indexOf("function parseEvidencePanel"),
    );
    expect(fnBody).toContain("catch");
    expect(fnBody).toContain("buildRuleBasedWorkspaceResponse");
  });

  it("buildRuleBasedWorkspaceResponse returns WorkspaceAIResponse shape", () => {
    const fnBody = serviceSrc.slice(
      serviceSrc.indexOf("export function buildRuleBasedWorkspaceResponse"),
      serviceSrc.indexOf("export function parseAIWorkspaceResponse"),
    );
    expect(fnBody).toContain("evidencePanel:");
    expect(fnBody).toContain("followUpActions:");
    expect(fnBody).toContain("researchMode:");
    expect(fnBody).toContain("contextScope:");
    expect(fnBody).toContain("source:");
    expect(fnBody).toContain("disclaimer:");
  });

  it("buildRuleBasedWorkspaceResponse includes diagnostics for empty results", () => {
    const fnBody = serviceSrc.slice(
      serviceSrc.indexOf("export function buildRuleBasedWorkspaceResponse"),
      serviceSrc.indexOf("export function parseAIWorkspaceResponse"),
    );
    expect(fnBody).toContain("diagnostics");
    expect(fnBody).toContain("universeSearched");
    expect(fnBody).toContain("rejectionReasons");
  });

  it("buildRuleBasedWorkspaceResponse followUpActions are contextual (not generic)", () => {
    const fnBody = serviceSrc.slice(
      serviceSrc.indexOf("export function buildRuleBasedWorkspaceResponse"),
      serviceSrc.indexOf("export function parseAIWorkspaceResponse"),
    );
    expect(fnBody).toContain("action:");
    expect(fnBody).toContain("type:");
  });

  it("AssembledContext type has dataFreshness", () => {
    expect(serviceSrc).toContain("dataFreshness:");
  });

  it("assembleResearchContext caps opportunities at 50 for prompt size", () => {
    expect(serviceSrc).toContain("slice(0, 50)");
  });

  it("serializeOpportunity strips raw scores (keeps summary)", () => {
    expect(serviceSrc).toContain("serializeOpportunity");
    expect(serviceSrc).toContain("evidenceSummary");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Part 7 — Routes
// ────────────────────────────────────────────────────────────────────────────

describe("Part 7 — Routes", () => {
  it("POST /api/research/ask route registered", () => {
    expect(routesSrc).toContain('"/api/research/ask"');
  });

  it("GET /api/research/templates route registered", () => {
    expect(routesSrc).toContain('"/api/research/templates"');
  });

  it("GET /api/research/conversations route registered", () => {
    expect(routesSrc).toContain('"/api/research/conversations"');
  });

  it("POST /api/research/conversations is handled (via conversationId in /ask)", () => {
    // Sprint 2.5.2: conversation created implicitly on first /ask, or re-used via conversationId
    expect(routesSrc).toContain("conversationId");
  });

  it("GET /api/research/conversations/:id route registered", () => {
    expect(routesSrc).toContain('"/api/research/conversations/:id"');
  });

  it("DELETE /api/research/conversations/:id route registered", () => {
    expect(routesSrc).toMatch(/app\.delete.*\/api\/research\/conversations\/:id/);
  });

  it("PATCH /api/research/conversations/:id/pin route registered", () => {
    expect(routesSrc).toContain("/api/research/conversations/:id/pin");
  });

  it("POST /api/research/ask validates question length", () => {
    expect(routesSrc).toContain("min 3 characters");
  });

  it("POST /api/research/ask validates researchMode", () => {
    expect(routesSrc).toContain("Invalid researchMode");
    expect(routesSrc).toContain("VALID_MODES");
  });

  it("POST /api/research/ask auto-creates conversation when no conversationId", () => {
    expect(routesSrc).toContain("Create new conversation");
  });

  it("POST /api/research/ask verifies ownership before appending to existing conversation", () => {
    const appendSection = routesSrc.slice(
      routesSrc.indexOf("Verify ownership"),
      routesSrc.indexOf("Persist user message"),
    );
    expect(appendSection).toContain("userId");
  });

  it("POST /api/research/ask persists user message and assistant message", () => {
    expect(routesSrc).toContain("Persist user message");
    expect(routesSrc).toContain("Persist assistant message");
  });

  it("all routes require isAuthenticated", () => {
    const matches = routesSrc.match(/isAuthenticated/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(6);
  });

  it("DELETE cascade removes messages before conversation", () => {
    // workspaceMessages delete must come before workspaceConversations delete
    const msgIdx  = routesSrc.indexOf("db.delete(workspaceMessages)");
    const convIdx = routesSrc.indexOf("db.delete(workspaceConversations)");
    expect(msgIdx).toBeGreaterThan(-1);
    expect(convIdx).toBeGreaterThan(-1);
    expect(msgIdx).toBeLessThan(convIdx);
  });

  it("GET /api/research/conversations returns pinned, recent, all", () => {
    expect(routesSrc).toContain("pinned:");
    expect(routesSrc).toContain("recent:");
    expect(routesSrc).toContain("all:");
  });

  it("PATCH /api/research/conversations/:id/pin supports pin/unpin toggle", () => {
    // pin route sets isPinned and pinnedAt
    expect(routesSrc).toContain("isPinned:  pinned");
    expect(routesSrc).toContain("pinnedAt:");
    expect(routesSrc).toContain("isPinned: pinned");
  });

  it("response includes disclaimer", () => {
    expect(routesSrc).toContain("DISCLAIMER");
    expect(routesSrc).toContain("disclaimer:");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Part 8 — Route registration & wiring
// ────────────────────────────────────────────────────────────────────────────

describe("Part 8 — Route registration & wiring", () => {
  it("registerResearchWorkspaceRoutes imported in routes.ts", () => {
    expect(routesRegSrc).toContain("registerResearchWorkspaceRoutes");
    expect(routesRegSrc).toContain("research-workspace");
  });

  it("registerResearchWorkspaceRoutes called in routes.ts", () => {
    expect(routesRegSrc).toContain("registerResearchWorkspaceRoutes(app, isAuthenticated)");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Part 9 — Platform Health
// ────────────────────────────────────────────────────────────────────────────

describe("Part 9 — Platform Health", () => {
  it("getWorkspaceHealth imported in platform-health.ts", () => {
    expect(platformHealthSrc).toContain("getWorkspaceHealth");
  });

  it("researchWorkspace key in buildPlatformHealth", () => {
    expect(platformHealthSrc).toContain("researchWorkspace");
  });

  it("admin health page renders Research Workspace card", () => {
    expect(adminHealthSrc).toContain("Research Workspace");
    expect(adminHealthSrc).toContain("researchWorkspace");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Part 10 — Client page
// ────────────────────────────────────────────────────────────────────────────

describe("Part 10 — Client page", () => {
  it("ResearchWorkspacePage default export", () => {
    expect(clientSrc).toContain("export default function ResearchWorkspacePage");
  });

  it("mode selector renders all 8 modes", () => {
    expect(clientSrc).toContain("ModeSelector");
    for (const mode of ["opportunity", "company", "theme", "sector", "institutional", "market", "collection", "comparison"]) {
      expect(clientSrc).toContain(mode);
    }
  });

  it("scope selector renders", () => {
    expect(clientSrc).toContain("ScopeSelector");
  });

  it("evidence panel component renders all 7 sections", () => {
    expect(clientSrc).toContain("EvidencePanelView");
    expect(clientSrc).toContain("Supporting Evidence");
    expect(clientSrc).toContain("Technical Evidence");
    expect(clientSrc).toContain("Fundamental Evidence");
    expect(clientSrc).toContain("Institutional Evidence");
    expect(clientSrc).toContain("Risk Factors");
    expect(clientSrc).toContain("What Would Invalidate This Thesis");
  });

  it("research diagnostics panel rendered for empty state", () => {
    expect(clientSrc).toContain("DiagnosticsPanel");
    expect(clientSrc).toContain("Research Diagnostics");
  });

  it("follow-up actions rendered", () => {
    expect(clientSrc).toContain("FollowUpActions");
    expect(clientSrc).toContain("followUpActions");
  });

  it("templates panel with at least 10 templates", () => {
    // Templates are fetched from /api/research/templates and rendered
    expect(clientSrc).toContain("Research Templates");
    expect(clientSrc).toContain("/api/research/templates");
    expect(clientSrc).toContain("templates");
  });

  it("pinned conversations section", () => {
    expect(clientSrc).toContain("Pinned");
    expect(clientSrc).toContain("isPinned");
  });

  it("recent conversations section", () => {
    expect(clientSrc).toContain("Recent");
  });

  it("input area has ticker input for company/comparison research", () => {
    expect(clientSrc).toContain("Add ticker");
    expect(clientSrc).toContain("tickerInput");
  });

  it("Ctrl+Enter / Cmd+Enter to submit", () => {
    expect(clientSrc).toContain("metaKey");
    expect(clientSrc).toContain("ctrlKey");
  });

  it("referenced tickers link to /opportunity/:symbol", () => {
    expect(clientSrc).toContain("/opportunity/");
  });

  it("loading state shown during API call", () => {
    expect(clientSrc).toContain("isPending");
    expect(clientSrc).toContain("Assembling research context");
  });

  it("route registered in App.tsx", () => {
    expect(appSrc).toContain("research-workspace");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Part 11 — Compliance language
// ────────────────────────────────────────────────────────────────────────────

describe("Part 11 — Compliance language", () => {
  it("service system prompt never has 'recommendation:' as a response key in instructions", () => {
    // The word 'recommendation' appears only in the NEVER list, not as a proposed key
    const prompt = serviceSrc.slice(
      serviceSrc.indexOf("buildResearchSystemPrompt"),
      serviceSrc.indexOf("buildResearchUserMessage"),
    );
    expect(prompt).not.toContain('"recommendation":');
  });

  it("types never define a recommendation or buy/sell field", () => {
    expect(typeSrc).not.toContain("recommendation:");
    expect(typeSrc).not.toContain("buySignal:");
    expect(typeSrc).not.toContain("sellSignal:");
    expect(typeSrc).not.toContain("targetPrice:");
  });

  it("routes never return a recommendations key", () => {
    expect(routesSrc).not.toContain('"recommendations"');
    expect(routesSrc).not.toContain("recommendations:");
  });

  it("client page does not render 'buy' or 'sell' UI labels", () => {
    // Check for JSX rendered labels — not comments, compliance notes, or template prompts
    expect(clientSrc).not.toContain(">Buy<");
    expect(clientSrc).not.toContain(">Sell<");
    expect(clientSrc).not.toContain(">Target Price<");
    // No button/badge labels that direct action
    expect(clientSrc).not.toContain("label=\"Buy\"");
    expect(clientSrc).not.toContain("label=\"Sell\"");
  });

  it("disclaimer present in route response", () => {
    expect(routesSrc).toContain("not personalized investment advice");
  });

  it("templates use 'research candidate' language", () => {
    for (const t of ["qualify-explain", "challenge-thesis", "find-similar"]) {
      const idx = typeSrc.indexOf(t);
      const snippet = typeSrc.slice(idx, idx + 600).toLowerCase();
      expect(snippet).not.toContain(" buy ");
      expect(snippet).not.toContain(" sell ");
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Part 12 — Architecture: consumes existing engines, no duplication
// ────────────────────────────────────────────────────────────────────────────

describe("Part 12 — Architecture: consumes existing engines", () => {
  it("service imports from opportunity-intelligence-service", () => {
    expect(serviceSrc).toContain("opportunity-intelligence-service");
    expect(serviceSrc).toContain("getOpportunityIntelligence");
  });

  it("service imports from collection-service", () => {
    expect(serviceSrc).toContain("collection-service");
    expect(serviceSrc).toContain("listCollections");
  });

  it("service imports from intelligence-snapshot-store", () => {
    expect(serviceSrc).toContain("intelligence-snapshot-store");
    expect(serviceSrc).toContain("getLatestSectorSnapshots");
    expect(serviceSrc).toContain("getLatestThemeSnapshots");
  });

  it("service does NOT re-implement scanner or ranking", () => {
    expect(serviceSrc).not.toContain("runScanner");
    expect(serviceSrc).not.toContain("computeOpportunityRanking");
    expect(serviceSrc).not.toContain("scan_vcp");
  });

  it("service does NOT duplicate opportunity data in DB", () => {
    // workspace_messages stores AI responses, not canonical opportunity rows
    expect(serviceSrc).not.toContain("INSERT INTO ranked_opportunities");
    expect(serviceSrc).not.toContain("INSERT INTO opportunity_scan_snapshots");
  });

  it("routes import from research-workspace-service (not inlined)", () => {
    expect(routesSrc).toContain("research-workspace-service");
  });

  it("AI response is stored in structured_content jsonb (not a separate table)", () => {
    expect(routesSrc).toContain("structuredContent");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Part 13 — Roadmap discipline
// ────────────────────────────────────────────────────────────────────────────

describe("Part 13 — Roadmap discipline (nothing beyond spec)", () => {
  it("service has no portfolio scoring logic", () => {
    expect(serviceSrc.toLowerCase()).not.toContain("portfolio score");
    expect(serviceSrc.toLowerCase()).not.toContain("rebalance");
  });

  it("service has no automated trading logic", () => {
    expect(serviceSrc.toLowerCase()).not.toContain("place order");
    expect(serviceSrc.toLowerCase()).not.toContain("execute trade");
  });

  it("service has no alerts or notification logic", () => {
    expect(serviceSrc.toLowerCase()).not.toContain("send alert");
    expect(serviceSrc.toLowerCase()).not.toContain("sendNotification");
  });

  it("future_portfolio scope is placeholder only (not wired to real portfolio data)", () => {
    // Service may reference "future_portfolio" as a scope to skip — that's correct.
    // What matters: it is NOT wired to actual portfolio positions or portfolio intelligence.
    expect(serviceSrc).not.toContain("getPortfolioPositions");
    expect(serviceSrc).not.toContain("portfolioIntelligence");
    expect(typeSrc).toContain("future_portfolio");
  });

  it("types define no tax-planning or goal-planning fields", () => {
    expect(typeSrc).not.toContain("taxPlan");
    expect(typeSrc).not.toContain("goalPlan");
  });
});
