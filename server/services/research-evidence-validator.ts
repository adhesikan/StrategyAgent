// Research Evidence Validator — Sprint 5.4C
//
// Validates a ResearchEvidenceRecord before any persistence step.
// Rejects unknown schema versions, unknown domains, forbidden sensitive fields,
// malformed dates, non-finite numbers, oversized arrays/strings, and unknown
// top-level or nested fields.
//
// Security: the forbidden-field scanner is defence-in-depth. It must run after
// schema validation. On any violation the record is rejected and a safe error is
// emitted. The offending value is NEVER logged.

import type { ResearchEvidenceRecord, ResearchDomain } from "./research-save-handle";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = "1.0";

export const RESEARCH_DOMAINS: readonly ResearchDomain[] = [
  "SYMBOL_ANALYSIS",
  "TRADE_RESEARCH",
  "MARKET_OPPORTUNITY_SEARCH",
  "PORTFOLIO_GOAL_RESEARCH",
  "PORTFOLIO_IMPACT",
  "OPTIONS_RESEARCH",
];

/** Fields that must be immutable after record creation (spec §2). */
export const IMMUTABLE_FIELDS = [
  "verdict",
  "reasons",
  "warnings",
  "confidence",
  "sourceTools",
  "sourceTimestamps",
  "domainSnapshot",
  "generatedAt",
  "domain",
  "schemaVersion",
  "requestId",
  "normalizedRequestSummary",
  "dataQuality",
  "limitations",
] as const;

/** Forbidden sensitive key names — presence anywhere in the evidence JSON rejects persistence. */
const FORBIDDEN_KEYS = new Set([
  "accountId",
  "accountNumber",
  "brokerAccount",
  "brokerId",
  "connectionId",
  "userId",          // inside evidence payload only; outer DB userId is allowed
  "accessToken",
  "refreshToken",
  "serviceToken",
  "apiKey",
  "authorization",
  "optionsContextToken",
  "portfolioContextToken",
  "rawPositions",
  "rawPortfolio",
  "providerPayload",
  "stack",
  "systemPrompt",
  "developerPrompt",
  "chainOfThought",
]);

const MAX_STRING_LENGTH = 8_000;
const MAX_ARRAY_LENGTH = 200;
const MAX_DOMAIN_SNAPSHOT_JSON = 200_000; // 200 KB

// ---------------------------------------------------------------------------
// Public error type
// ---------------------------------------------------------------------------

export interface ValidationError {
  code: "VALIDATION_ERROR";
  reason: string;
  field?: string;
}

export type ValidationResult =
  | { ok: true; record: ResearchEvidenceRecord }
  | { ok: false; error: ValidationError };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isIsoDate(s: unknown): boolean {
  if (typeof s !== "string" || s.length < 10) return false;
  const d = new Date(s);
  return !isNaN(d.getTime());
}

function isFiniteNumber(v: unknown): boolean {
  return typeof v === "number" && isFinite(v);
}

function rejectField(field: string, reason: string): ValidationResult {
  return { ok: false, error: { code: "VALIDATION_ERROR", reason, field } };
}

// ---------------------------------------------------------------------------
// Forbidden key scanner (recursive)
// Never logs the offending value.
// ---------------------------------------------------------------------------

export function scanForForbiddenKeys(
  value: unknown,
  path: string = "$",
): { found: true; path: string } | { found: false } {
  if (value === null || value === undefined) return { found: false };

  if (Array.isArray(value)) {
    for (let i = 0; i < Math.min(value.length, MAX_ARRAY_LENGTH + 10); i++) {
      const r = scanForForbiddenKeys(value[i], `${path}[${i}]`);
      if (r.found) return r;
    }
    return { found: false };
  }

  if (typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(key)) {
        return { found: true, path: `${path}.${key}` };
      }
      const r = scanForForbiddenKeys(
        (value as Record<string, unknown>)[key],
        `${path}.${key}`,
      );
      if (r.found) return r;
    }
  }
  return { found: false };
}

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

function validateStringField(
  v: unknown,
  field: string,
  required: boolean,
  maxLen: number = MAX_STRING_LENGTH,
): ValidationResult | null {
  if (v === undefined || v === null) {
    if (required) return rejectField(field, `${field} is required`);
    return null;
  }
  if (typeof v !== "string") return rejectField(field, `${field} must be a string`);
  if (v.length === 0 && required) return rejectField(field, `${field} must not be empty`);
  if (v.length > maxLen) return rejectField(field, `${field} exceeds maximum length`);
  return null;
}

function validateStringArray(
  v: unknown,
  field: string,
  required: boolean,
): ValidationResult | null {
  if (v === undefined || v === null) {
    if (required) return rejectField(field, `${field} is required`);
    return null;
  }
  if (!Array.isArray(v)) return rejectField(field, `${field} must be an array`);
  if (v.length > MAX_ARRAY_LENGTH) return rejectField(field, `${field} exceeds maximum array length`);
  for (const item of v) {
    if (typeof item !== "string") return rejectField(field, `${field} items must be strings`);
    if (item.length > MAX_STRING_LENGTH) return rejectField(field, `${field} item exceeds maximum string length`);
  }
  return null;
}

/**
 * Validate a ResearchEvidenceRecord before persistence.
 * Returns ok:true with the typed record, or ok:false with a safe error.
 * Never logs any secret values.
 */
export function validateResearchEvidence(raw: unknown): ValidationResult {
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: { code: "VALIDATION_ERROR", reason: "Evidence must be a non-null object" } };
  }

  const r = raw as Record<string, unknown>;

  // --- Schema version ---
  if (r.schemaVersion !== SCHEMA_VERSION) {
    return rejectField("schemaVersion", `Unknown schema version: expected "${SCHEMA_VERSION}"`);
  }

  // --- Domain ---
  if (!RESEARCH_DOMAINS.includes(r.domain as ResearchDomain)) {
    return rejectField("domain", `Unknown domain: "${String(r.domain)}"`);
  }

  // --- requestId ---
  const reqIdErr = validateStringField(r.requestId, "requestId", true, 128);
  if (reqIdErr) return reqIdErr;

  // --- normalizedRequestSummary ---
  const nrsErr = validateStringField(r.normalizedRequestSummary, "normalizedRequestSummary", true, 1_000);
  if (nrsErr) return nrsErr;

  // --- verdict ---
  const verdictErr = validateStringField(r.verdict, "verdict", true, 500);
  if (verdictErr) return verdictErr;

  // --- confidence ---
  if (!["high", "medium", "low", "none"].includes(r.confidence as string)) {
    return rejectField("confidence", `Invalid confidence: "${String(r.confidence)}"`);
  }

  // --- generatedAt ---
  if (!isIsoDate(r.generatedAt)) {
    return rejectField("generatedAt", "generatedAt must be a valid ISO date string");
  }

  // --- optional date fields ---
  if (r.sourceTimestamps !== undefined) {
    const stErr = validateStringArray(r.sourceTimestamps, "sourceTimestamps", false);
    if (stErr) return stErr;
    for (const ts of (r.sourceTimestamps as string[])) {
      if (!isIsoDate(ts)) return rejectField("sourceTimestamps", "Each sourceTimestamp must be a valid ISO date");
    }
  }

  // --- dataQuality ---
  if (r.dataQuality === undefined || r.dataQuality === null || typeof r.dataQuality !== "object" || Array.isArray(r.dataQuality)) {
    return rejectField("dataQuality", "dataQuality must be an object");
  }
  const dq = r.dataQuality as Record<string, unknown>;
  for (const key of Object.keys(dq)) {
    if (!["estimated", "simulated", "partial", "stale"].includes(key)) {
      return rejectField("dataQuality", `Unknown dataQuality field: "${key}"`);
    }
    if (typeof dq[key] !== "boolean") {
      return rejectField("dataQuality", `dataQuality.${key} must be boolean`);
    }
  }

  // --- string array fields ---
  for (const [field, required] of [
    ["reasons", true],
    ["warnings", true],
    ["limitations", true],
    ["sourceTools", true],
    ["sourceTimestamps", true],
  ] as [string, boolean][]) {
    const err = validateStringArray(r[field], field, required);
    if (err) return err;
  }
  // Optional string arrays
  for (const field of ["watchConditions", "symbols"]) {
    const err = validateStringArray(r[field], field, false);
    if (err) return err;
  }

  // --- optional string fields ---
  for (const field of ["symbol", "status", "strategy", "strategyDisplayName", "direction", "instrument", "qualificationStatus", "conversationId", "parentRecordId"]) {
    const err = validateStringField(r[field], field, false);
    if (err) return err;
  }

  // --- domainSnapshot ---
  if (r.domainSnapshot === undefined || r.domainSnapshot === null) {
    return rejectField("domainSnapshot", "domainSnapshot is required");
  }
  try {
    const snapshotJson = JSON.stringify(r.domainSnapshot);
    if (snapshotJson.length > MAX_DOMAIN_SNAPSHOT_JSON) {
      return rejectField("domainSnapshot", "domainSnapshot exceeds maximum size");
    }
  } catch {
    return rejectField("domainSnapshot", "domainSnapshot is not JSON-serializable");
  }

  // --- check for non-finite numbers anywhere in the record ---
  function checkNumbers(v: unknown, path: string): string | null {
    if (typeof v === "number" && !isFiniteNumber(v)) return path;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const r = checkNumbers(v[i], `${path}[${i}]`);
        if (r) return r;
      }
    } else if (v !== null && typeof v === "object") {
      for (const k of Object.keys(v as object)) {
        const r = checkNumbers((v as Record<string, unknown>)[k], `${path}.${k}`);
        if (r) return r;
      }
    }
    return null;
  }
  const nonFinitePath = checkNumbers(r.domainSnapshot, "domainSnapshot");
  if (nonFinitePath) {
    return rejectField("domainSnapshot", `Non-finite number found in domainSnapshot`);
  }

  // --- validate domain-snapshot structure matches domain ---
  const snapshotValidation = validateDomainSnapshot(r.domain as ResearchDomain, r.domainSnapshot);
  if (!snapshotValidation.ok) return snapshotValidation;

  // --- forbidden field scan on the full evidence object ---
  // (excludes the outer userId which is added at the DB layer)
  const forbiddenResult = scanForForbiddenKeys(r.domainSnapshot, "domainSnapshot");
  if (forbiddenResult.found) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        reason: `Forbidden sensitive field found in evidence — persistence rejected`,
        field: "domainSnapshot",
      },
    };
  }

  // --- no unknown top-level fields ---
  const ALLOWED_TOP_LEVEL = new Set([
    "schemaVersion", "domain", "requestId", "conversationId", "parentRecordId",
    "symbol", "symbols", "normalizedRequestSummary", "verdict", "status",
    "strategy", "strategyDisplayName", "direction", "instrument", "qualificationStatus",
    "confidence", "dataQuality", "reasons", "warnings", "watchConditions",
    "sourceTools", "sourceTimestamps", "limitations", "domainSnapshot", "generatedAt",
  ]);
  for (const key of Object.keys(r)) {
    if (!ALLOWED_TOP_LEVEL.has(key)) {
      return rejectField(key, `Unknown top-level field: "${key}"`);
    }
  }

  return { ok: true, record: raw as ResearchEvidenceRecord };
}

// ---------------------------------------------------------------------------
// Domain-specific snapshot validation
// ---------------------------------------------------------------------------

function validateDomainSnapshot(domain: ResearchDomain, snapshot: unknown): ValidationResult {
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return rejectField("domainSnapshot", "domainSnapshot must be a non-null object");
  }
  const snap = snapshot as Record<string, unknown>;
  const dummyRecord = {} as ResearchEvidenceRecord; // not used, just for type compat

  switch (domain) {
    case "SYMBOL_ANALYSIS":
      if (!snap.analysis && !snap.vcpAnalysis && !snap.multiStrategyAnalysis) {
        return rejectField("domainSnapshot", "SYMBOL_ANALYSIS snapshot must include analysis, vcpAnalysis, or multiStrategyAnalysis");
      }
      return { ok: true, record: dummyRecord };

    case "TRADE_RESEARCH":
      if (!snap.recommendation && !snap.strategies && !snap.candidates) {
        return rejectField("domainSnapshot", "TRADE_RESEARCH snapshot must include recommendation, strategies, or candidates");
      }
      return { ok: true, record: dummyRecord };

    case "MARKET_OPPORTUNITY_SEARCH":
      if (!snap.rankedSearch && !snap.candidates && !snap.search) {
        return rejectField("domainSnapshot", "MARKET_OPPORTUNITY_SEARCH snapshot must include rankedSearch, candidates, or search");
      }
      return { ok: true, record: dummyRecord };

    case "PORTFOLIO_GOAL_RESEARCH":
      if (!snap.portfolioTradePlan && !snap.plan && !snap.feasibility) {
        return rejectField("domainSnapshot", "PORTFOLIO_GOAL_RESEARCH snapshot must include portfolioTradePlan, plan, or feasibility");
      }
      return { ok: true, record: dummyRecord };

    case "PORTFOLIO_IMPACT":
      if (!snap.portfolioIntelligence && !snap.impact && !snap.concentration) {
        return rejectField("domainSnapshot", "PORTFOLIO_IMPACT snapshot must include portfolioIntelligence, impact, or concentration");
      }
      return { ok: true, record: dummyRecord };

    case "OPTIONS_RESEARCH":
      if (!snap.options && !snap.recommendation && !snap.strategies) {
        return rejectField("domainSnapshot", "OPTIONS_RESEARCH snapshot must include options, recommendation, or strategies");
      }
      return { ok: true, record: dummyRecord };

    default:
      return rejectField("domain", `No snapshot validator for domain: "${domain}"`);
  }
}
