import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import {
  canAccessFeature,
  getUpgradePlan,
  getPlan,
  type PlanId,
  type FeatureKey,
} from "@shared/plans";

interface BillingStatus {
  planId: PlanId;
  planName: string;
  subscriptionStatus: string;
  billingCycle: "monthly" | "annual";
  trialEndsAt: string | null;
  currentPeriodEndsAt: string | null;
  dailyAnalysesUsed: number;
  dailyAnalysesLimit: number;
  isTrialing: boolean;
  trialDaysLeft: number | null;
  resetsAt: string;
}

interface PlanContextValue {
  plan: PlanId;
  planName: string;
  status: string;
  billingCycle: "monthly" | "annual";
  isTrialing: boolean;
  trialDaysLeft: number | null;
  trialEndsAt: string | null;
  currentPeriodEndsAt: string | null;
  dailyAnalysesUsed: number;
  dailyAnalysesLimit: number;
  isWithinQuota: boolean;
  quotaPercent: number;
  upgradeTo: PlanId | null;
  isLoading: boolean;
  canAccess: (feature: FeatureKey | string) => boolean;
  refresh: () => void;
}

const PlanContext = createContext<PlanContextValue | undefined>(undefined);

export function PlanProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const { data, isLoading, refetch } = useQuery<BillingStatus>({
    queryKey: ["/api/billing/status"],
    enabled: !!user,
  });

  const value = useMemo<PlanContextValue>(() => {
    const plan: PlanId = (data?.planId as PlanId) ?? "free";
    const planMeta = getPlan(plan);
    const limit = data?.dailyAnalysesLimit ?? planMeta.limits.dailyAnalyses;
    const used = data?.dailyAnalysesUsed ?? 0;
    const isWithinQuota = limit === -1 ? true : used < limit;
    const quotaPercent = limit === -1 ? 0 : Math.min(100, Math.round((used / limit) * 100));

    return {
      plan,
      planName: data?.planName ?? planMeta.name,
      status: data?.subscriptionStatus ?? "active",
      billingCycle: data?.billingCycle ?? "monthly",
      isTrialing: data?.isTrialing ?? false,
      trialDaysLeft: data?.trialDaysLeft ?? null,
      trialEndsAt: data?.trialEndsAt ?? null,
      currentPeriodEndsAt: data?.currentPeriodEndsAt ?? null,
      dailyAnalysesUsed: used,
      dailyAnalysesLimit: limit,
      isWithinQuota,
      quotaPercent,
      upgradeTo: getUpgradePlan(plan),
      isLoading,
      canAccess: (feature: FeatureKey | string) => canAccessFeature(plan, feature),
      refresh: () => {
        void refetch();
      },
    };
  }, [data, isLoading, refetch]);

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>;
}

export function usePlan(): PlanContextValue {
  const ctx = useContext(PlanContext);
  if (!ctx) {
    return {
      plan: "free",
      planName: "Explorer",
      status: "active",
      billingCycle: "monthly",
      isTrialing: false,
      trialDaysLeft: null,
      trialEndsAt: null,
      currentPeriodEndsAt: null,
      dailyAnalysesUsed: 0,
      dailyAnalysesLimit: 5,
      isWithinQuota: true,
      quotaPercent: 0,
      upgradeTo: "pro",
      isLoading: false,
      canAccess: (feature: FeatureKey | string) => canAccessFeature("free", feature),
      refresh: () => {},
    };
  }
  return ctx;
}
