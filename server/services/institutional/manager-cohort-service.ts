import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { institutionalManagerCohorts } from "@shared/schema";
import {
  INSTITUTIONAL_MANAGER_COHORTS,
  MANAGER_COHORT_CLASSIFICATION_METHODS,
  MANAGER_COHORT_STATUSES,
  type InstitutionalManagerCohort,
  type ManagerCohortMembership,
  type ManagerCohortSeedInput,
  type ManagerCohortStatus,
} from "./manager-cohort-types";

/**
 * RULE_BASED entries are accepted only when a deterministic rule is registered
 * here with stable criteria. No rules are registered in this version.
 */
export const REGISTERED_MANAGER_COHORT_RULES: Readonly<
  Record<string, { cohort: InstitutionalManagerCohort; description: string }>
> = Object.freeze({});

export const managerCohortSeedInputSchema = z
  .object({
    managerId: z.string().trim().regex(/^\d{1,10}$/),
    cohort: z.enum(INSTITUTIONAL_MANAGER_COHORTS),
    classificationMethod: z.enum(MANAGER_COHORT_CLASSIFICATION_METHODS),
    confidence: z.number().int().min(0).max(100).nullable().optional(),
    status: z.enum(MANAGER_COHORT_STATUSES).optional(),
    source: z.string().trim().min(1).max(500).nullable().optional(),
    notes: z.string().trim().min(1).max(2_000).nullable().optional(),
    ruleId: z.string().trim().min(1).max(100).nullable().optional(),
    lastReviewedAt: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.classificationMethod === "VERIFIED" &&
      !value.source?.trim()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source"],
        message: "VERIFIED classifications require a source.",
      });
    }
    if (value.classificationMethod === "RULE_BASED") {
      const rule = value.ruleId
        ? REGISTERED_MANAGER_COHORT_RULES[value.ruleId]
        : undefined;
      if (!rule || rule.cohort !== value.cohort) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ruleId"],
          message:
            "RULE_BASED classifications require a registered deterministic rule for this cohort.",
        });
      }
    } else if (value.ruleId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ruleId"],
        message: "ruleId is valid only for RULE_BASED classifications.",
      });
    }
  });

export interface ManagerCohortListFilters {
  managerId?: string;
  cohort?: InstitutionalManagerCohort;
  status?: ManagerCohortStatus;
}

export interface ManagerCohortStore {
  upsertMany(records: ManagerCohortMembership[]): Promise<ManagerCohortMembership[]>;
  list(filters?: ManagerCohortListFilters): Promise<ManagerCohortMembership[]>;
  activeManagerIds(cohort: InstitutionalManagerCohort): Promise<string[]>;
}

function toMembership(
  row: typeof institutionalManagerCohorts.$inferSelect,
): ManagerCohortMembership {
  return {
    managerId: row.managerId,
    cohort: row.cohort as InstitutionalManagerCohort,
    classificationMethod: row.classificationMethod as ManagerCohortMembership["classificationMethod"],
    confidence: row.confidence,
    status: row.status as ManagerCohortStatus,
    source: row.source,
    notes: row.notes,
    ruleId: row.ruleId,
    lastReviewedAt: row.lastReviewedAt.toISOString(),
  };
}

export const managerCohortStore: ManagerCohortStore = {
  async upsertMany(records) {
    if (records.length === 0) return [];
    const now = new Date();
    const rows = await db
      .insert(institutionalManagerCohorts)
      .values(
        records.map((record) => ({
          ...record,
          lastReviewedAt: new Date(record.lastReviewedAt),
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [
          institutionalManagerCohorts.managerId,
          institutionalManagerCohorts.cohort,
        ],
        set: {
          classificationMethod: sql`excluded.classification_method`,
          confidence: sql`excluded.confidence`,
          status: sql`excluded.status`,
          source: sql`excluded.source`,
          notes: sql`excluded.notes`,
          ruleId: sql`excluded.rule_id`,
          lastReviewedAt: sql`excluded.last_reviewed_at`,
          updatedAt: now,
        },
      })
      .returning();
    return rows.map(toMembership);
  },
  async list(filters = {}) {
    const conditions = [];
    if (filters.managerId) {
      conditions.push(
        eq(
          institutionalManagerCohorts.managerId,
          normalizeManagerId(filters.managerId),
        ),
      );
    }
    if (filters.cohort) {
      conditions.push(eq(institutionalManagerCohorts.cohort, filters.cohort));
    }
    if (filters.status) {
      conditions.push(eq(institutionalManagerCohorts.status, filters.status));
    }
    const rows = await db
      .select()
      .from(institutionalManagerCohorts)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(
        asc(institutionalManagerCohorts.managerId),
        asc(institutionalManagerCohorts.cohort),
      );
    return rows.map(toMembership);
  },
  async activeManagerIds(cohort) {
    const rows = await db
      .select({ managerId: institutionalManagerCohorts.managerId })
      .from(institutionalManagerCohorts)
      .where(
        and(
          eq(institutionalManagerCohorts.cohort, cohort),
          eq(institutionalManagerCohorts.status, "ACTIVE"),
        ),
      )
      .orderBy(asc(institutionalManagerCohorts.managerId));
    return rows.map((row) => row.managerId);
  },
};

export function normalizeManagerId(managerId: string): string {
  const normalized = managerId.trim();
  if (!/^\d{1,10}$/.test(normalized)) {
    throw new Error("managerId must be a numeric SEC CIK with at most 10 digits.");
  }
  return normalized.padStart(10, "0");
}

export function validateManagerCohortSeedInput(
  input: ManagerCohortSeedInput,
  now = new Date(),
): ManagerCohortMembership {
  const parsed = managerCohortSeedInputSchema.parse(input);
  return {
    managerId: normalizeManagerId(parsed.managerId),
    cohort: parsed.cohort,
    classificationMethod: parsed.classificationMethod,
    confidence: parsed.confidence ?? null,
    status: parsed.status ?? "ACTIVE",
    source: parsed.source?.trim() ?? null,
    notes: parsed.notes?.trim() ?? null,
    ruleId: parsed.ruleId?.trim() ?? null,
    lastReviewedAt: parsed.lastReviewedAt ?? now.toISOString(),
  };
}

export async function seedManagerCohorts(
  inputs: ManagerCohortSeedInput[],
  store: ManagerCohortStore = managerCohortStore,
  now = new Date(),
): Promise<ManagerCohortMembership[]> {
  const records = inputs.map((input) =>
    validateManagerCohortSeedInput(input, now),
  );
  const seen = new Set<string>();
  for (const record of records) {
    const key = `${record.managerId}:${record.cohort}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate manager/cohort membership in seed: ${key}`);
    }
    seen.add(key);
  }
  return store.upsertMany(records);
}

export async function listManagerCohorts(
  filters: ManagerCohortListFilters = {},
  store: ManagerCohortStore = managerCohortStore,
): Promise<ManagerCohortMembership[]> {
  return store.list(filters);
}

export async function getActiveManagerIdsForCohort(
  cohort: InstitutionalManagerCohort | undefined,
  store: ManagerCohortStore = managerCohortStore,
): Promise<Set<string> | null> {
  if (!cohort) return null;
  return new Set(await store.activeManagerIds(cohort));
}

export function filterByCohortManagerIds<T extends { managerId: string }>(
  rows: T[],
  managerIds: Set<string> | null,
): T[] {
  return managerIds === null
    ? rows
    : rows.filter((row) => managerIds.has(row.managerId));
}