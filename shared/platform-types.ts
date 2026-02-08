import type { RiskProfile, TickerUniverse } from "./schema";

export interface PlatformRiskProfile {
  id: string;
  risk_mode: string;
  risk_per_trade: number;
  max_deploy: number;
  protections_enabled: boolean;
  guardrails_json: unknown;
  protections_json: unknown;
}

export interface PlatformUniverse {
  id: string;
  name: string;
  count: number;
  description?: string | null;
}

export function toRiskProfileResponse(rp: RiskProfile): PlatformRiskProfile {
  return {
    id: rp.id,
    risk_mode: rp.riskMode,
    risk_per_trade: rp.riskPerTrade,
    max_deploy: rp.maxDeploy,
    protections_enabled: rp.protectionsEnabled,
    guardrails_json: rp.guardrailsJson,
    protections_json: rp.protectionsJson,
  };
}

export interface PlatformContext {
  riskProfile: PlatformRiskProfile;
  universes: PlatformUniverse[];
}

export function toUniverseResponse(
  u: TickerUniverse,
  memberCount: number,
): PlatformUniverse {
  return {
    id: u.id,
    name: u.name,
    count: memberCount,
    description: u.description,
  };
}
