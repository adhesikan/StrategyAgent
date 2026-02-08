import { storage } from "../storage";
import type { RiskProfile } from "@shared/schema";

const DEFAULT_BALANCED_PROFILE = {
  riskMode: "balanced" as const,
  riskPerTrade: 2.0,
  maxDeploy: 50.0,
  deltaMin: 0.20,
  deltaMax: 0.40,
  lossCutoffMult: 2.0,
  minPremiumPct: 0.5,
  vixPause: 35,
  protectionsEnabled: true,
  guardrailsJson: {},
  protectionsJson: {},
};

export async function getDefaultRiskProfile(userId: string): Promise<RiskProfile> {
  const existing = await storage.getRiskProfile(userId);
  if (existing) return existing;

  return storage.createRiskProfile({
    userId,
    ...DEFAULT_BALANCED_PROFILE,
  });
}
