// Barrel export for AI Trading Workspace components — Sprint 2.2.3

export {
  // Pure helpers (exported for testing)
  deriveLifecycleSummary,
  buildEvidenceSummaryRows,
  buildRiskGroups,
  deriveInstaTradePrepState,
  buildAssistantPrompts,
  // Section components
  WorkspaceLifecycleSection,
  WorkspaceDecisionSummary,
  WorkspaceEvidenceSummary,
  WorkspaceStockPlanSummary,
  WorkspaceOptionsPlanSummary,
  WorkspaceRiskSummary,
  WorkspaceCongressNewsCatalystSummary,
  WorkspaceInstaTradePrepPanel,
  WorkspaceBrokerStatusBadge,
} from "./workspace-sections";

export type {
  LifecycleSummary,
  LifecycleSummaryKind,
  EvidenceStrength,
  EvidenceSummaryRow,
  RiskSeverity,
  RiskItem,
  RiskGroup,
  InstaTradePrepStateKind,
  SentimentResponseMin,
  SentimentArticleMin,
  SentimentSnapshotAgg,
} from "./workspace-sections";

export {
  WorkspaceNav,
  WORKSPACE_NAV_SECTIONS,
  WS_SCROLL_MARGIN_TOP,
  findActiveSectionId,
  scrollToSection,
  useActiveSection,
} from "./workspace-nav";

export type { WorkspaceNavSection } from "./workspace-nav";

export {
  WorkspaceAssistantPanel,
  WorkspaceAssistantDrawer,
  WorkspaceAssistantTrigger,
  WorkspaceAssistantInlineSection,
  buildSafeAssistantPayload,
  isPromptRelevant,
} from "./workspace-assistant";

export type { AssistantAskPayload, AssistantResponse } from "./workspace-assistant";
