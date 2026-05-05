import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import type { PersonaId } from "@shared/plans";

interface UserSettingsResponse {
  traderPersona?: PersonaId | null;
  planId?: string;
}

interface PersonaContextValue {
  persona: PersonaId | null;
  isLearner: boolean;
  isBuyer: boolean;
  isSeller: boolean;
  isComplex: boolean;
  isLoading: boolean;
  setPersona: (p: PersonaId) => Promise<void>;
}

const PersonaContext = createContext<PersonaContextValue | undefined>(undefined);

export function PersonaProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const { data, isLoading } = useQuery<UserSettingsResponse>({
    queryKey: ["/api/user/settings"],
    enabled: !!user,
  });

  const mutation = useMutation({
    mutationFn: async (persona: PersonaId) => {
      await apiRequest("PATCH", "/api/user/settings", { traderPersona: persona });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user/settings"] });
    },
  });

  const value = useMemo<PersonaContextValue>(() => {
    const persona = (data?.traderPersona ?? null) as PersonaId | null;
    return {
      persona,
      isLearner: persona === "learner",
      isBuyer: persona === "buyer",
      isSeller: persona === "seller",
      isComplex: persona === "complex",
      isLoading,
      setPersona: async (p: PersonaId) => {
        await mutation.mutateAsync(p);
      },
    };
  }, [data?.traderPersona, isLoading, mutation]);

  return <PersonaContext.Provider value={value}>{children}</PersonaContext.Provider>;
}

export function usePersona(): PersonaContextValue {
  const ctx = useContext(PersonaContext);
  if (!ctx) {
    return {
      persona: null,
      isLearner: false,
      isBuyer: false,
      isSeller: false,
      isComplex: false,
      isLoading: false,
      setPersona: async () => {},
    };
  }
  return ctx;
}
