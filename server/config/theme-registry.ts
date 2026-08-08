// Theme Registry — Sprint 2.3.3
//
// Canonical curated theme definitions for the Sector & Theme Intelligence layer.
//
// KEY PRINCIPLES:
//   - Classification method: curated (explicit symbol membership, no AI)
//   - Themes are many-to-many: a symbol can belong to multiple themes
//   - Symbol lists reflect publicly known business models, not predictions
//   - Adding a symbol here does NOT imply a recommendation to buy or sell it
//   - Do NOT hardcode symbols inside scoring logic — scoring uses this registry
//   - classificationMethod must always be "curated" until AI classification is implemented

export type ClassificationMethod = "curated";

export interface ThemeDefinition {
  themeId: string;
  name: string;
  description: string;
  active: boolean;
  /** Curated member symbols — uppercase tickers */
  symbols: string[];
  classificationMethod: ClassificationMethod;
}

// ---------------------------------------------------------------------------
// Curated theme → symbol membership
// ---------------------------------------------------------------------------
// Only add a symbol when its primary business clearly fits the theme description.
// Source: publicly available business descriptions, GICS classifications, SEC filings.

const THEMES: ThemeDefinition[] = [
  {
    themeId: "ai-infrastructure",
    name: "AI Infrastructure",
    description: "Companies providing hardware, software, and networking infrastructure enabling AI model training and inference.",
    active: true,
    symbols: ["NVDA", "AMD", "AVGO", "MRVL", "TSM", "ASML", "SMCI", "ARM", "INTC", "ANET", "MCHP"],
    classificationMethod: "curated",
  },
  {
    themeId: "semiconductors",
    name: "Semiconductors",
    description: "Designers and manufacturers of semiconductor chips, equipment, and related components.",
    active: true,
    symbols: ["NVDA", "AMD", "AVGO", "ASML", "MRVL", "ON", "KLAC", "LRCX", "AMAT", "MU", "INTC", "TXN", "QCOM", "TSM", "MPWR", "MCHP", "STM", "SWKS"],
    classificationMethod: "curated",
  },
  {
    themeId: "memory",
    name: "Memory",
    description: "Companies designing or manufacturing DRAM, NAND, and HBM memory products.",
    active: true,
    symbols: ["MU", "NVDA", "WDC", "STX"],
    classificationMethod: "curated",
  },
  {
    themeId: "cloud",
    name: "Cloud",
    description: "Companies providing cloud computing infrastructure, platforms, and software-as-a-service.",
    active: true,
    symbols: ["MSFT", "AMZN", "GOOGL", "CRM", "SNOW", "NET", "DDOG", "ORCL", "NOW", "WDAY", "ZM", "MNDY"],
    classificationMethod: "curated",
  },
  {
    themeId: "cybersecurity",
    name: "Cybersecurity",
    description: "Companies providing network security, endpoint protection, identity, and threat intelligence solutions.",
    active: true,
    symbols: ["PANW", "CRWD", "ZS", "NET", "FTNT", "S", "OKTA", "VRNS", "CYBR"],
    classificationMethod: "curated",
  },
  {
    themeId: "robotics",
    name: "Robotics",
    description: "Companies developing industrial robots, autonomous systems, and robotic process automation.",
    active: true,
    symbols: ["TSLA", "NVDA", "ABB", "FANUY", "IRBT", "ISRG", "ROP"],
    classificationMethod: "curated",
  },
  {
    themeId: "quantum-computing",
    name: "Quantum Computing",
    description: "Companies researching, developing, or commercializing quantum computing hardware and software.",
    active: true,
    symbols: ["GOOGL", "IBM", "IONQ", "RGTI", "QUBT", "MSFT"],
    classificationMethod: "curated",
  },
  {
    themeId: "nuclear-power-infrastructure",
    name: "Nuclear & Power Infrastructure",
    description: "Companies involved in nuclear energy generation, power grid infrastructure, and next-generation power technology.",
    active: true,
    symbols: ["CEG", "VST", "NRG", "ETN", "GEV", "OKLO", "SMR", "LEU", "CCJ"],
    classificationMethod: "curated",
  },
  {
    themeId: "data-centers",
    name: "Data Centers",
    description: "Companies that own, operate, or supply critical infrastructure for data center facilities.",
    active: true,
    symbols: ["EQIX", "DLR", "SMCI", "VRT", "AMT", "NVDA", "ANET"],
    classificationMethod: "curated",
  },
  {
    themeId: "defense",
    name: "Defense",
    description: "Defense contractors and aerospace companies serving military and government clients.",
    active: true,
    symbols: ["LMT", "RTX", "NOC", "GD", "BA", "HII", "LHX", "KTOS", "PLTR"],
    classificationMethod: "curated",
  },
  {
    themeId: "fintech",
    name: "Fintech",
    description: "Companies providing financial technology services including payments, trading platforms, and digital assets.",
    active: true,
    symbols: ["PYPL", "SQ", "V", "MA", "COIN", "MSTR", "AFRM", "NU", "SOFI", "HOOD"],
    classificationMethod: "curated",
  },
  {
    themeId: "biotechnology",
    name: "Biotechnology",
    description: "Companies developing novel therapies, diagnostics, and medical technologies using biological systems.",
    active: true,
    symbols: ["MRNA", "ABBV", "REGN", "GILD", "BMY", "PFE", "ILMN", "VRTX", "ALNY", "BIIB"],
    classificationMethod: "curated",
  },
];

// ---------------------------------------------------------------------------
// Registry API
// ---------------------------------------------------------------------------

const THEME_MAP = new Map<string, ThemeDefinition>(
  THEMES.map(t => [t.themeId, t]),
);

// Map from symbol → set of theme IDs it belongs to (for fast lookup)
const SYMBOL_TO_THEMES = new Map<string, Set<string>>();
for (const theme of THEMES) {
  for (const sym of theme.symbols) {
    if (!SYMBOL_TO_THEMES.has(sym)) SYMBOL_TO_THEMES.set(sym, new Set());
    SYMBOL_TO_THEMES.get(sym)!.add(theme.themeId);
  }
}

export function getAllThemes(): ThemeDefinition[] {
  return THEMES.filter(t => t.active);
}

export function getTheme(themeId: string): ThemeDefinition | undefined {
  return THEME_MAP.get(themeId);
}

export function getThemesForSymbol(symbol: string): string[] {
  return Array.from(SYMBOL_TO_THEMES.get(symbol.toUpperCase()) ?? []);
}

export function isSymbolInTheme(symbol: string, themeId: string): boolean {
  return SYMBOL_TO_THEMES.get(symbol.toUpperCase())?.has(themeId) ?? false;
}

export function getThemeSymbols(themeId: string): string[] {
  return THEME_MAP.get(themeId)?.symbols ?? [];
}

export function getThemeCount(): number {
  return THEMES.filter(t => t.active).length;
}
