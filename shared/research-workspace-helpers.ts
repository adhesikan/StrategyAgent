/**
 * Research Workspace Pure Helpers — Sprint 2.6.4
 *
 * Pure functions for URL param parsing and context derivation.
 * Shared between the client page and server tests.
 * No browser or server dependencies.
 */

import type {
  ResearchMode,
  ResearchContextType,
  WorkspaceAction,
  ContextScope,
} from "./research-workspace-types";
import {
  ACTION_MODE_MAP,
  ACTION_QUESTIONS,
} from "./research-workspace-types";

const MODES: ResearchMode[] = [
  "opportunity", "company", "theme", "sector",
  "institutional", "market", "collection", "comparison",
];

const VALID_ACTIONS: WorkspaceAction[] = [
  "explain_concept", "challenge", "explain_change", "risk", "institutional", "compare",
];

// ---------------------------------------------------------------------------
// URL params shape
// ---------------------------------------------------------------------------

export interface WorkspaceParams {
  mode:         ResearchMode | null;
  scope:        ContextScope | null;
  symbol:       string | null;
  symbols:      string[];
  themeId:      string | null;
  sector:       string | null;
  collectionId: string | null;
  portfolioId:  string | null;
  watchId:      string | null;
  reportId:     string | null;
  action:       WorkspaceAction | null;
  conversation: string | null;
  sourceRoute:  string | null;
  q:            string | null;
}

// ---------------------------------------------------------------------------
// parseWorkspaceParams
// ---------------------------------------------------------------------------

export function parseWorkspaceParams(search: string): WorkspaceParams {
  const empty: WorkspaceParams = {
    mode: null, scope: null, symbol: null, symbols: [], themeId: null,
    sector: null, collectionId: null, portfolioId: null, watchId: null,
    reportId: null, action: null, conversation: null, sourceRoute: null, q: null,
  };
  if (!search) return empty;

  const p = new URLSearchParams(search);
  const rawMode   = p.get("mode") as ResearchMode;
  const rawScope  = p.get("scope") as ContextScope;
  const rawAction = p.get("action") as WorkspaceAction;
  const rawSymbols = p.get("symbols")
    ? p.get("symbols")!.split(",").map(s => s.trim().toUpperCase()).filter(Boolean)
    : [];

  return {
    mode:         MODES.includes(rawMode) ? rawMode : null,
    scope:        rawScope || null,
    symbol:       p.get("symbol")?.toUpperCase() ?? null,
    symbols:      rawSymbols,
    themeId:      p.get("themeId") ?? null,
    sector:       p.get("sector") ?? null,
    collectionId: p.get("collectionId") ?? null,
    portfolioId:  p.get("portfolioId") ?? null,
    watchId:      p.get("watchId") ?? null,
    reportId:     p.get("reportId") ?? null,
    action:       VALID_ACTIONS.includes(rawAction) ? rawAction : null,
    conversation: p.get("conversation") ?? null,
    sourceRoute:  p.get("sourceRoute") ?? null,
    q:            p.get("q") ?? null,
  };
}

// ---------------------------------------------------------------------------
// deriveContextLabel
// ---------------------------------------------------------------------------

export function deriveContextLabel(params: WorkspaceParams): string {
  if (params.symbols.length >= 2)
    return `Comparing: ${params.symbols.slice(0, 5).join(" vs ")}`;
  if (params.symbol)       return `Researching: ${params.symbol}`;
  if (params.themeId)      return `Theme: ${params.themeId}`;
  if (params.sector)       return `Sector: ${params.sector}`;
  if (params.collectionId) return `Collection Research`;
  if (params.portfolioId)  return `Portfolio Research`;
  if (params.watchId)      return `Monitor Research`;
  if (params.reportId)     return `Report Research`;
  return "";
}

// ---------------------------------------------------------------------------
// deriveContextType
// ---------------------------------------------------------------------------

export function deriveContextType(params: WorkspaceParams): ResearchContextType {
  if (params.symbols.length >= 2) return "comparison";
  if (params.symbol) {
    if (params.action === "compare") return "comparison";
    return params.mode === "opportunity" ? "opportunity" : "company";
  }
  if (params.themeId)      return "theme";
  if (params.sector)       return "sector";
  if (params.collectionId) return "collection";
  if (params.portfolioId)  return "portfolio";
  if (params.watchId)      return "monitor";
  if (params.reportId)     return "report";
  return "market";
}

// ---------------------------------------------------------------------------
// deriveInitialMode
// ---------------------------------------------------------------------------

export function deriveInitialMode(params: WorkspaceParams): ResearchMode {
  if (params.mode)              return params.mode;
  if (params.action)            return ACTION_MODE_MAP[params.action];
  if (params.symbols.length >= 2) return "comparison";
  if (params.symbol)            return "company";
  if (params.themeId)           return "theme";
  if (params.sector)            return "sector";
  if (params.collectionId)      return "collection";
  return "opportunity";
}

// ---------------------------------------------------------------------------
// derivePrefillQuestion
// ---------------------------------------------------------------------------

export function derivePrefillQuestion(params: WorkspaceParams): string {
  if (params.q) return params.q;
  if (params.action && params.symbol && ACTION_QUESTIONS[params.action]) {
    return ACTION_QUESTIONS[params.action](params.symbol);
  }
  return "";
}
