export const INSTITUTIONAL_MANAGER_COHORTS = [
  "hedge_fund",
  "pension",
  "sovereign",
  "endowment",
  "asset_manager",
  "quantitative",
  "technology_specialist",
  "healthcare_specialist",
  "concentrated",
  "broad_diversified",
] as const;

export type InstitutionalManagerCohort =
  (typeof INSTITUTIONAL_MANAGER_COHORTS)[number];

export const MANAGER_COHORT_CLASSIFICATION_METHODS = [
  "MANUAL",
  "VERIFIED",
  "RULE_BASED",
] as const;
export type ManagerCohortClassificationMethod =
  (typeof MANAGER_COHORT_CLASSIFICATION_METHODS)[number];

export const MANAGER_COHORT_STATUSES = [
  "ACTIVE",
  "INACTIVE",
  "NEEDS_REVIEW",
] as const;
export type ManagerCohortStatus = (typeof MANAGER_COHORT_STATUSES)[number];

export interface ManagerCohortMembership {
  managerId: string;
  cohort: InstitutionalManagerCohort;
  classificationMethod: ManagerCohortClassificationMethod;
  confidence: number | null;
  status: ManagerCohortStatus;
  source: string | null;
  notes: string | null;
  ruleId: string | null;
  lastReviewedAt: string;
}

export interface ManagerCohortSeedInput {
  managerId: string;
  cohort: InstitutionalManagerCohort;
  classificationMethod: ManagerCohortClassificationMethod;
  confidence?: number | null;
  status?: ManagerCohortStatus;
  source?: string | null;
  notes?: string | null;
  ruleId?: string | null;
  lastReviewedAt?: string;
}