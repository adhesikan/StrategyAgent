// Presentation helpers for the structured VCP analysis returned by /api/ask
// (optional `vcpAnalysis` field). All display strings are derived here so they
// can be unit-tested without a DOM.
//
// CRITICAL SEMANTICS: majorHigh is historical context only and must never be
// presented as a pivot, breakout, buy point, or entry. Only actionablePivot is
// an actionable VCP pivot; when it is null/absent we show "None".

export type VcpStage = "no-setup" | "early" | "developing" | "contraction" | "pivot-ready";

export interface VcpAnalysis {
  analysisSummary: {
    vcpScore: number | null;
    stage: VcpStage | null;
    trend: string | null;
  };
  vcpStructure: {
    stage: string | null;
    base: string;
    contractions: string | null;
    volatility: string | null;
    volume: string | null;
    higherLows: string | null;
    actionablePivot: { detected: boolean; price: number | null; source: string | null; distancePercent: number | null };
    majorHigh: { price: number | null; date: string | null; distancePercent: number | null; note: string };
    baseSupport: number | null;
    baseResistance: number | null;
  };
  setupAssessment: {
    qualifies: boolean;
    strengths: string[];
    weaknesses: string[];
    improvementConditions: string[];
    watchConditions: string[];
  };
}

export const VCP_STAGE_LABELS: Record<VcpStage, string> = {
  "no-setup": "No Setup",
  early: "Early",
  developing: "Developing",
  contraction: "Contraction",
  "pivot-ready": "Pivot Ready",
};

export function stageLabel(stage: string | null | undefined): string {
  if (!stage) return "Unknown";
  return VCP_STAGE_LABELS[stage as VcpStage] ?? stage;
}

/** Tailwind accent classes reusing the page's existing emerald/sky/amber tones. */
export function stageTone(stage: string | null | undefined): string {
  switch (stage) {
    case "pivot-ready":
      return "border-emerald-500/40 text-emerald-300 bg-emerald-500/10";
    case "contraction":
    case "developing":
      return "border-sky-500/40 text-sky-300 bg-sky-500/10";
    case "early":
      return "border-amber-500/40 text-amber-300 bg-amber-500/10";
    default:
      return "border-rose-500/40 text-rose-300 bg-rose-500/10";
  }
}

export function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "None" when no actionable pivot exists — null price is valid data, never fabricated. */
export function pivotDisplay(p: VcpAnalysis["vcpStructure"]["actionablePivot"] | null | undefined): string {
  if (!p || !p.detected || p.price === null) return "None";
  let s = fmtUsd(p.price);
  if (p.distancePercent !== null && Number.isFinite(p.distancePercent)) {
    s += ` (${Math.abs(p.distancePercent).toFixed(1)}% away)`;
  }
  return s;
}

/** Always suffixed with the historical-context label; never an entry level. */
export function majorHighDisplay(mh: VcpAnalysis["vcpStructure"]["majorHigh"] | null | undefined): string | null {
  if (!mh || mh.price === null) return null;
  let s = fmtUsd(mh.price);
  if (mh.date) s += ` on ${mh.date}`;
  if (mh.distancePercent !== null && Number.isFinite(mh.distancePercent)) {
    s += `, ${Math.abs(mh.distancePercent).toFixed(1)}% below`;
  }
  return `${s} — historical context only`;
}

export interface StructureRow {
  label: string;
  value: string;
  /** extra emphasis for the historical-context caveat */
  muted?: boolean;
}

/** Rows for the Structure card. Fields the scanner didn't supply are omitted, never invented. */
export function structureRows(vs: VcpAnalysis["vcpStructure"]): StructureRow[] {
  const rows: StructureRow[] = [];
  if (vs.base) rows.push({ label: "Base", value: vs.base });
  if (vs.contractions) rows.push({ label: "Contractions", value: vs.contractions });
  if (vs.volatility) rows.push({ label: "Volatility", value: vs.volatility });
  if (vs.volume) rows.push({ label: "Volume", value: vs.volume });
  if (vs.higherLows) rows.push({ label: "Higher lows", value: vs.higherLows });
  rows.push({ label: "Actionable pivot", value: pivotDisplay(vs.actionablePivot) });
  const mh = majorHighDisplay(vs.majorHigh);
  if (mh) rows.push({ label: "Major high", value: mh, muted: true });
  if (vs.baseSupport !== null) rows.push({ label: "Base support", value: fmtUsd(vs.baseSupport) });
  if (vs.baseResistance !== null) rows.push({ label: "Base resistance", value: fmtUsd(vs.baseResistance) });
  return rows;
}

/** Why card: strengths when the setup qualifies, otherwise weaknesses. */
export function assessmentItems(sa: VcpAnalysis["setupAssessment"]): { title: string; items: string[]; positive: boolean } {
  return sa.qualifies
    ? { title: "Why this setup qualifies", items: sa.strengths, positive: true }
    : { title: "Why this doesn't qualify", items: sa.weaknesses, positive: false };
}

/** Defensive: render nothing when the payload is unusable rather than fabricate. */
export function isRenderableVcpAnalysis(a: unknown): a is VcpAnalysis {
  if (!a || typeof a !== "object") return false;
  const x = a as VcpAnalysis;
  return !!x.analysisSummary && !!x.vcpStructure && !!x.setupAssessment && !!x.vcpStructure.actionablePivot;
}
