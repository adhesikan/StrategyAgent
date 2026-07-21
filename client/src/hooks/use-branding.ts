import { useQuery } from "@tanstack/react-query";
import {
  buildBrandingInfo,
  DEFAULT_TRADEMARK_STATUS,
  type BrandingInfo,
} from "@shared/branding";

const FALLBACK: BrandingInfo = buildBrandingInfo(DEFAULT_TRADEMARK_STATUS);

/**
 * Centralized trademark/branding info served by GET /api/branding.
 * Controlled by the TRADEMARK_INSTATRADE_STATUS env var on the server, so
 * switching InstaTrade™ → InstaTrade® is a configuration-only change.
 * Falls back safely to pending_registration (™) while loading or on error.
 */
export function useBranding(): BrandingInfo {
  const { data } = useQuery<BrandingInfo>({
    queryKey: ["/api/branding"],
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });
  return data ?? FALLBACK;
}

export function useInstaTradeName(): string {
  return useBranding().instaTradeName;
}
