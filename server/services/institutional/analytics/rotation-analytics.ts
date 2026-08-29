/**
 * Sector, industry, and theme institutional rotation analytics.
 *
 * Reported value is exposure at filing time. It must not be presented as
 * buying or selling because price movements also change reported value.
 */

import {
  classifySecurityPositionType,
  type InstitutionalSecurityPositionType,
} from "../security-position";
import { crossFundInstitutionalRepository } from "./cross-fund-analytics-repository";
import type {
  CrossFundInstitutionalRepository,
} from "./repository";
import type {
  AnalyticsDataQuality,
  EnrichedInstitutionalHolding,
  InstitutionalRotationClassification,
  InstitutionalRotationKind,
  InstitutionalRotationOptions,
  InstitutionalRotationResult,
  InstitutionalQuarter,
  ModelVersion,
} from "./types";
import type { InstitutionalActivityRankingOptions } from "./types";

export const INSTITUTIONAL_ROTATION_MODEL_VERSION: ModelVersion = {
  name: "institutional-rotation",
  version: "1.0.0",
};

export interface RotationCalculationInput {
  quarter: InstitutionalQuarter;
  previousQuarter: InstitutionalQuarter | null;
  currentHoldings: EnrichedInstitutionalHolding[];
  previousHoldings: EnrichedInstitutionalHolding[];
  comparableManagerIds: string[];
}

export interface InstitutionalRotationService {
  getSectorRotation(
    options?: InstitutionalRotationOptions,
  ): Promise<InstitutionalRotationResult | null>;
  getIndustryRotation(
    options?: InstitutionalRotationOptions,
  ): Promise<InstitutionalRotationResult | null>;
  getThemeRotation(
    options?: InstitutionalRotationOptions,
  ): Promise<InstitutionalRotationResult | null>;
}

interface Position {
  managerId: string;
  symbol: string;
  shares: number | null;
  value: number | null;
}

interface Group {
  classification: string;
  classificationId?: string;
  current: Map<string, Position>;
  previous: Map<string, Position>;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function sumNullable(values: Array<number | null>): number | null {
  if (values.length === 0) return 0;
  if (values.some((value) => value === null)) return null;
  let total = 0;
  for (const value of values) total += value ?? 0;
  return total;
}

function positionTypeMatches(
  holding: EnrichedInstitutionalHolding,
  positionType: InstitutionalSecurityPositionType,
): boolean {
  try {
    if (classifySecurityPositionType(holding.putCall) !== positionType) {
      return false;
    }
  } catch {
    return false;
  }
  return !(
    positionType === "COMMON_EQUITY" &&
    holding.sharesPrnType?.trim().toUpperCase() === "PRN"
  );
}

function isTrustedMappedHolding(
  holding: EnrichedInstitutionalHolding,
): boolean {
  return (
    holding.mappingResolution === "reliably_mapped" &&
    Boolean(holding.metadata?.symbol.trim())
  );
}

function positionIsReported(position: Position): boolean {
  return position.shares !== null
    ? position.shares > 0
    : position.value !== null;
}

function mergePosition(
  positions: Map<string, Position>,
  holding: EnrichedInstitutionalHolding,
): void {
  const symbol = holding.metadata!.symbol.trim().toUpperCase();
  const key = `${holding.filerCik}:${symbol}`;
  const existing = positions.get(key);
  if (!existing) {
    positions.set(key, {
      managerId: holding.filerCik,
      symbol,
      shares: holding.reportedShares,
      value: holding.reportedValueDollars,
    });
    return;
  }
  existing.shares = sumNullable([existing.shares, holding.reportedShares]);
  existing.value = sumNullable([
    existing.value,
    holding.reportedValueDollars,
  ]);
}

function groupsForHolding(
  kind: InstitutionalRotationKind,
  holding: EnrichedInstitutionalHolding,
): Array<{ classification: string; classificationId?: string }> {
  const metadata = holding.metadata;
  if (!metadata) return [];
  if (kind === "SECTOR") {
    const classification = metadata.sector?.trim();
    return classification ? [{ classification }] : [];
  }
  if (kind === "INDUSTRY") {
    const classification = metadata.industry?.trim();
    return classification ? [{ classification }] : [];
  }
  return holding.themes
    .filter((theme) => theme.themeName.trim() && theme.themeId.trim())
    .map((theme) => ({
      classification: theme.themeName.trim(),
      classificationId: theme.themeId.trim(),
    }));
}

function buildGroups(
  kind: InstitutionalRotationKind,
  holdings: EnrichedInstitutionalHolding[],
  positionType: InstitutionalSecurityPositionType,
  side: "current" | "previous",
  groups: Map<string, Group>,
): void {
  for (const holding of holdings) {
    if (!positionTypeMatches(holding, positionType)) continue;
    if (!isTrustedMappedHolding(holding)) continue;
    for (const groupIdentity of groupsForHolding(kind, holding)) {
      const key = groupIdentity.classificationId
        ? `${groupIdentity.classificationId}\u0000${groupIdentity.classification}`
        : groupIdentity.classification.toUpperCase();
      const group = groups.get(key) ?? {
        ...groupIdentity,
        current: new Map(),
        previous: new Map(),
      };
      groups.set(key, group);
      mergePosition(group[side], holding);
    }
  }
}

function classifyPositionChanges(
  current: Map<string, Position>,
  previous: Map<string, Position>,
  comparable: Set<string>,
): {
  newly: number;
  increased: number;
  reduced: number;
  exited: number;
} {
  const keys = new Set([
    ...Array.from(current.keys()),
    ...Array.from(previous.keys()),
  ]);
  let newly = 0;
  let increased = 0;
  let reduced = 0;
  let exited = 0;
  for (const key of Array.from(keys).sort()) {
    const now = current.get(key);
    const before = previous.get(key);
    const managerId = now?.managerId ?? before?.managerId;
    if (!managerId || !comparable.has(managerId)) continue;
    const nowReported = now ? positionIsReported(now) : false;
    const beforeReported = before ? positionIsReported(before) : false;
    if (nowReported && !beforeReported) newly++;
    else if (!nowReported && beforeReported) exited++;
    else if (
      nowReported &&
      beforeReported &&
      now?.shares !== null &&
      now?.shares !== undefined &&
      before?.shares !== null &&
      before?.shares !== undefined
    ) {
      if (now.shares > before.shares) increased++;
      else if (now.shares < before.shares) reduced++;
    }
  }
  return { newly, increased, reduced, exited };
}

function comparisonComplete(
  current: Map<string, Position>,
  previousQuarter: InstitutionalQuarter | null,
  comparable: Set<string>,
): boolean {
  return (
    previousQuarter !== null &&
    Array.from(current.values()).every((position) =>
      comparable.has(position.managerId),
    )
  );
}

function buildClassification(
  group: Group,
  kind: InstitutionalRotationKind,
  positionType: InstitutionalSecurityPositionType,
  quarter: InstitutionalQuarter,
  previousQuarter: InstitutionalQuarter | null,
  comparable: Set<string>,
): InstitutionalRotationClassification {
  const currentValue = sumNullable(
    Array.from(group.current.values()).map((position) => position.value),
  );
  const previousValue =
    previousQuarter === null
      ? null
      : sumNullable(
          Array.from(group.previous.values()).map((position) => position.value),
        );
  const complete = comparisonComplete(
    group.current,
    previousQuarter,
    comparable,
  );
  const valueChange =
    complete && currentValue !== null && previousValue !== null
      ? currentValue - previousValue
      : null;
  const valueChangePct =
    valueChange !== null && previousValue !== null && previousValue > 0
      ? round((valueChange / previousValue) * 100)
      : null;
  const changes = previousQuarter !== null
    ? classifyPositionChanges(group.current, group.previous, comparable)
    : { newly: 0, increased: 0, reduced: 0, exited: 0 };
  const currentShares =
    positionType === "COMMON_EQUITY"
      ? sumNullable(
          Array.from(group.current.values()).map((position) => position.shares),
        )
      : null;
  const currentManagers = new Set(
    Array.from(group.current.values()).map((position) => position.managerId),
  );
  const previousManagers =
    previousQuarter === null
      ? null
      : new Set(
          Array.from(group.previous.values()).map(
            (position) => position.managerId,
          ),
        );
  return {
    quarter,
    classification: group.classification,
    ...(kind === "THEME" && group.classificationId
      ? { classificationId: group.classificationId }
      : {}),
    currentReportedValue: currentValue,
    previousReportedValue: previousValue,
    reportedValueChange: valueChange,
    reportedValueChangePct: valueChangePct,
    currentReportedShares: currentShares,
    managerCount: currentManagers.size,
    previousManagerCount: previousManagers?.size ?? null,
    managerCountChange:
      complete && previousManagers !== null
        ? currentManagers.size - previousManagers.size
        : null,
    newlyReportedPositionCount: changes.newly,
    increasedReportedPositionCount: changes.increased,
    reducedReportedPositionCount: changes.reduced,
    noLongerReportedPositionCount: changes.exited,
  };
}

function dataQuality(
  input: RotationCalculationInput,
  positionType: InstitutionalSecurityPositionType,
): AnalyticsDataQuality {
  const candidates = [
    ...input.currentHoldings,
    ...input.previousHoldings,
  ].filter((holding) => positionTypeMatches(holding, positionType));
  const mapped = candidates.filter(isTrustedMappedHolding);
  const coveragePercent =
    candidates.length === 0 ? 0 : round((mapped.length / candidates.length) * 100);
  const comparable = new Set(input.comparableManagerIds);
  const currentMapped = input.currentHoldings.filter(
    (holding) =>
      positionTypeMatches(holding, positionType) &&
      isTrustedMappedHolding(holding),
  );
  const complete =
    input.previousQuarter !== null &&
    currentMapped.every((holding) => comparable.has(holding.filerCik));
  const warnings = [
    "Reported value reflects filing-time exposure and may change because of security price movements; it is not a buying or selling signal.",
    "Position counts compare reported filings, not exact institutional trades.",
  ];
  if (!input.previousQuarter) {
    warnings.push("No adjacent effective prior quarter is available for comparison.");
  } else if (!complete) {
    warnings.push(
      "Some current managers lack an equivalent prior filing; affected comparison metrics are unavailable.",
    );
  }
  if (coveragePercent < 100) {
    warnings.push(
      "Unmapped or ambiguous holdings were excluded from classification groups.",
    );
  }
  return {
    status:
      mapped.length === 0
        ? "insufficient"
        : coveragePercent === 100 && complete
          ? "complete"
          : "partial",
    coveragePercent,
    warnings,
  };
}

export function computeInstitutionalRotation(
  kind: InstitutionalRotationKind,
  input: RotationCalculationInput,
  options: Pick<InstitutionalRotationOptions, "positionType"> = {},
): InstitutionalRotationResult {
  const positionType = options.positionType ?? "COMMON_EQUITY";
  const groups = new Map<string, Group>();
  buildGroups(kind, input.currentHoldings, positionType, "current", groups);
  if (input.previousQuarter !== null) {
    buildGroups(kind, input.previousHoldings, positionType, "previous", groups);
  }
  const comparable = new Set(input.comparableManagerIds);
  const classifications = Array.from(groups.values())
    .map((group) =>
      buildClassification(
        group,
        kind,
        positionType,
        input.quarter,
        input.previousQuarter,
        comparable,
      ),
    )
    .sort(
      (left, right) =>
        left.classification.localeCompare(right.classification) ||
        (left.classificationId ?? "").localeCompare(
          right.classificationId ?? "",
        ),
    );
  return {
    kind,
    quarter: input.quarter,
    previousQuarter: input.previousQuarter,
    classifications,
    dataQuality: dataQuality(input, positionType),
    modelVersion: INSTITUTIONAL_ROTATION_MODEL_VERSION,
  };
}

async function getRotation(
  kind: InstitutionalRotationKind,
  options: InstitutionalRotationOptions = {},
  repository: CrossFundInstitutionalRepository = crossFundInstitutionalRepository,
): Promise<InstitutionalRotationResult | null> {
  const source = await repository.getCrossFundInstitutionalSource({
    quarter: options.quarter ?? "latest",
    options: {
      ...(options as InstitutionalActivityRankingOptions),
      quarter: options.quarter ?? "latest",
    },
  });
  if (!source) return null;
  return computeInstitutionalRotation(kind, source, options);
}

export const getSectorRotation = (
  options?: InstitutionalRotationOptions,
  repository?: CrossFundInstitutionalRepository,
) => getRotation("SECTOR", options, repository);

export const getIndustryRotation = (
  options?: InstitutionalRotationOptions,
  repository?: CrossFundInstitutionalRepository,
) => getRotation("INDUSTRY", options, repository);

export const getThemeRotation = (
  options?: InstitutionalRotationOptions,
  repository?: CrossFundInstitutionalRepository,
) => getRotation("THEME", options, repository);

export const institutionalRotationService: InstitutionalRotationService = {
  getSectorRotation,
  getIndustryRotation,
  getThemeRotation,
};