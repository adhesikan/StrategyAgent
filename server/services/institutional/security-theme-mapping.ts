export interface CuratedThemeDefinitionInput {
  themeId: string;
  symbols: string[];
}

export interface TrustedSecurityMasterInput {
  id: string;
  ticker: string | null;
}

export interface CuratedSecurityThemeMembership {
  securityMasterId: string;
  themeId: string;
  classificationMethod: "curated";
  source: "theme-registry";
}

/**
 * Build zero-to-many memberships from explicit registry entries only.
 * No issuer-name, sector, or keyword inference is permitted.
 */
export function buildCuratedSecurityThemeMemberships(
  masters: TrustedSecurityMasterInput[],
  themes: CuratedThemeDefinitionInput[],
): CuratedSecurityThemeMembership[] {
  const themesBySymbol = new Map<string, string[]>();
  for (const theme of themes) {
    for (const rawSymbol of theme.symbols) {
      const symbol = rawSymbol.trim().toUpperCase();
      if (!symbol) continue;
      const memberships = themesBySymbol.get(symbol) ?? [];
      memberships.push(theme.themeId);
      themesBySymbol.set(symbol, memberships);
    }
  }

  return masters.flatMap((master) => {
    const symbol = master.ticker?.trim().toUpperCase();
    if (!symbol) return [];
    return (themesBySymbol.get(symbol) ?? []).map((themeId) => ({
      securityMasterId: master.id,
      themeId,
      classificationMethod: "curated" as const,
      source: "theme-registry" as const,
    }));
  });
}