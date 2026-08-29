import { sql } from "drizzle-orm";
import { db } from "../../db";

/** Runtime-safe schema initialization for curated manager cohorts. */
export async function ensureInstitutionalManagerCohortSchema(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS institutional_manager_cohorts (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      manager_id TEXT NOT NULL,
      cohort TEXT NOT NULL,
      classification_method TEXT NOT NULL,
      confidence INTEGER,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      source TEXT,
      notes TEXT,
      rule_id TEXT,
      last_reviewed_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT institutional_manager_cohorts_unique UNIQUE (manager_id, cohort),
      CONSTRAINT institutional_manager_cohorts_confidence
        CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100)),
      CONSTRAINT institutional_manager_cohorts_method
        CHECK (classification_method IN ('MANUAL', 'VERIFIED', 'RULE_BASED')),
      CONSTRAINT institutional_manager_cohorts_status
        CHECK (status IN ('ACTIVE', 'INACTIVE', 'NEEDS_REVIEW')),
      CONSTRAINT institutional_manager_cohorts_cohort
        CHECK (cohort IN (
          'hedge_fund', 'pension', 'sovereign', 'endowment', 'asset_manager',
          'quantitative', 'technology_specialist', 'healthcare_specialist',
          'concentrated', 'broad_diversified'
        )),
      CONSTRAINT institutional_manager_cohorts_rule
        CHECK (classification_method <> 'RULE_BASED' OR rule_id IS NOT NULL)
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_institutional_manager_cohorts_manager
      ON institutional_manager_cohorts (manager_id);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_institutional_manager_cohorts_cohort_status
      ON institutional_manager_cohorts (cohort, status);
  `);
}