import { useQuery } from "@tanstack/react-query";

export interface PublicPricing {
  foundingActive: boolean;
  foundingEndsAt: string | null;
  monthlyPrice: number;
  standardMonthlyPrice: number;
}

const FALLBACK: PublicPricing = {
  foundingActive: true,
  foundingEndsAt: null,
  monthlyPrice: 99,
  standardMonthlyPrice: 149,
};

export function usePricing(): PublicPricing {
  const { data } = useQuery<PublicPricing>({
    queryKey: ["/api/billing/pricing"],
    staleTime: 5 * 60 * 1000,
  });
  return data ?? FALLBACK;
}
