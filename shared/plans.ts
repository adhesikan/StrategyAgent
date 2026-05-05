export type PersonaId = 'buyer' | 'seller' | 'complex' | 'learner';
export type TraderPersona = PersonaId;

export interface PlanLimits {
  dailyAnalyses: number;
  brokerConnections: number;
  scannerResults: number;
  automationMode: 'none' | 'alerts' | 'assisted' | 'autonomous';
  dataDelay: number;
  users: number;
}

export interface PlanFeatures {
  liveData: boolean;
  brokerConnect: boolean;
  scanner: boolean;
  automation: boolean;
  optionsFlow: boolean;
  multiLeg: boolean;
  tradeJournal: boolean;
  paperTrading: boolean;
  morningBriefing: boolean;
  alerts: boolean;
  teamSharing: boolean;
  partnerSignals: boolean;
}

export interface Plan {
  id: PlanId;
  name: string;
  price: number;
  priceAnnual: number;
  stripeMonthlyPriceId: string | null;
  stripeAnnualPriceId: string | null;
  limits: PlanLimits;
  features: PlanFeatures;
  allowedPersonas: PersonaId[];
}

export type PlanId = 'free' | 'pro' | 'edge' | 'team';
export type FeatureKey = keyof PlanFeatures;
export type LimitKey = keyof PlanLimits;

const env = (k: string): string | null => {
  if (typeof process !== 'undefined' && process.env && process.env[k]) {
    return process.env[k] as string;
  }
  return null;
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Explorer',
    price: 0,
    priceAnnual: 0,
    stripeMonthlyPriceId: null,
    stripeAnnualPriceId: null,
    limits: {
      dailyAnalyses: 5,
      brokerConnections: 0,
      scannerResults: 0,
      automationMode: 'none',
      dataDelay: 15,
      users: 1,
    },
    features: {
      liveData: false,
      brokerConnect: false,
      scanner: false,
      automation: false,
      optionsFlow: false,
      multiLeg: false,
      tradeJournal: false,
      paperTrading: true,
      morningBriefing: false,
      alerts: false,
      teamSharing: false,
      partnerSignals: false,
    },
    allowedPersonas: ['learner'],
  },
  pro: {
    id: 'pro',
    name: 'Trader',
    price: 29,
    priceAnnual: 278,
    stripeMonthlyPriceId: env('STRIPE_PRO_MONTHLY_PRICE_ID'),
    stripeAnnualPriceId: env('STRIPE_PRO_ANNUAL_PRICE_ID'),
    limits: {
      dailyAnalyses: 50,
      brokerConnections: 1,
      scannerResults: 10,
      automationMode: 'alerts',
      dataDelay: 0,
      users: 1,
    },
    features: {
      liveData: true,
      brokerConnect: true,
      scanner: true,
      automation: false,
      optionsFlow: false,
      multiLeg: false,
      tradeJournal: false,
      paperTrading: true,
      morningBriefing: true,
      alerts: true,
      teamSharing: false,
      partnerSignals: false,
    },
    allowedPersonas: ['learner', 'buyer', 'seller'],
  },
  edge: {
    id: 'edge',
    name: 'Active Trader',
    price: 79,
    priceAnnual: 758,
    stripeMonthlyPriceId: env('STRIPE_EDGE_MONTHLY_PRICE_ID'),
    stripeAnnualPriceId: env('STRIPE_EDGE_ANNUAL_PRICE_ID'),
    limits: {
      dailyAnalyses: -1,
      brokerConnections: 5,
      scannerResults: -1,
      automationMode: 'assisted',
      dataDelay: 0,
      users: 1,
    },
    features: {
      liveData: true,
      brokerConnect: true,
      scanner: true,
      automation: true,
      optionsFlow: true,
      multiLeg: true,
      tradeJournal: true,
      paperTrading: true,
      morningBriefing: true,
      alerts: true,
      teamSharing: false,
      partnerSignals: false,
    },
    allowedPersonas: ['learner', 'buyer', 'seller', 'complex'],
  },
  team: {
    id: 'team',
    name: 'Pro Desk',
    price: 199,
    priceAnnual: 1908,
    stripeMonthlyPriceId: env('STRIPE_TEAM_MONTHLY_PRICE_ID'),
    stripeAnnualPriceId: env('STRIPE_TEAM_ANNUAL_PRICE_ID'),
    limits: {
      dailyAnalyses: -1,
      brokerConnections: -1,
      scannerResults: -1,
      automationMode: 'autonomous',
      dataDelay: 0,
      users: 5,
    },
    features: {
      liveData: true,
      brokerConnect: true,
      scanner: true,
      automation: true,
      optionsFlow: true,
      multiLeg: true,
      tradeJournal: true,
      paperTrading: true,
      morningBriefing: true,
      alerts: true,
      teamSharing: true,
      partnerSignals: true,
    },
    allowedPersonas: ['learner', 'buyer', 'seller', 'complex'],
  },
};

const PLAN_ORDER: PlanId[] = ['free', 'pro', 'edge', 'team'];

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (value === 'free' || value === 'pro' || value === 'edge' || value === 'team');
}

export function isPersonaId(value: unknown): value is PersonaId {
  return typeof value === 'string' && (value === 'buyer' || value === 'seller' || value === 'complex' || value === 'learner');
}

export function getPlan(planId: PlanId | string | null | undefined): Plan {
  if (planId && isPlanId(planId)) return PLANS[planId];
  return PLANS.free;
}

export function canAccessFeature(planId: PlanId | string | null | undefined, feature: FeatureKey | string): boolean {
  const plan = getPlan(planId);
  return Boolean((plan.features as Record<string, boolean>)[feature]);
}

export function isWithinLimit(planId: PlanId | string | null | undefined, limit: LimitKey | string, current: number): boolean {
  const plan = getPlan(planId);
  const value = (plan.limits as Record<string, unknown>)[limit];
  if (typeof value !== 'number') return true;
  if (value === -1) return true;
  return current < value;
}

export function canUsePersona(planId: PlanId | string | null | undefined, persona: PersonaId | string): boolean {
  const plan = getPlan(planId);
  return plan.allowedPersonas.includes(persona as PersonaId);
}

export function getUpgradePlan(planId: PlanId | string | null | undefined): PlanId | null {
  const id = isPlanId(planId) ? planId : 'free';
  const idx = PLAN_ORDER.indexOf(id);
  if (idx < 0 || idx === PLAN_ORDER.length - 1) return null;
  return PLAN_ORDER[idx + 1];
}

export function getRequiredPlan(feature: FeatureKey | string): PlanId {
  for (const id of PLAN_ORDER) {
    if ((PLANS[id].features as Record<string, boolean>)[feature]) return id;
  }
  return 'team';
}

export function getPlanRank(planId: PlanId | string | null | undefined): number {
  const id = isPlanId(planId) ? planId : 'free';
  return PLAN_ORDER.indexOf(id);
}

export function planMeetsRequirement(planId: PlanId | string | null | undefined, required: PlanId): boolean {
  return getPlanRank(planId) >= getPlanRank(required);
}

export const PERSONA_RECOMMENDED_PLAN: Record<PersonaId, PlanId> = {
  buyer: 'pro',
  seller: 'pro',
  complex: 'edge',
  learner: 'free',
};
