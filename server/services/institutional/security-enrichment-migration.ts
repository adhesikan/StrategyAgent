import { sql } from "drizzle-orm";
import { db } from "../../db";

/**
 * Runtime-safe counterpart to migrations/030_institutional_security_enrichment.sql.
 * Railway cannot reach PostgreSQL during build, so startup must ensure this
 * schema before repository reads or theme synchronization occur.
 */
export async function ensureInstitutionalSecurityEnrichmentSchema(): Promise<void> {
  // 031 is included here because deployments can start before migrations run.
  // Keep this list in lockstep with migrations/031_institutional_security_reference_persistence.sql.
  await db.execute(sql`CREATE TABLE IF NOT EXISTS institutional_security_lookup_states (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, provider TEXT NOT NULL, cusip TEXT NOT NULL,
    provider_outcome TEXT NOT NULL, outcome TEXT NOT NULL, resolved_symbol TEXT, candidate_count INTEGER NOT NULL DEFAULT 0,
    fingerprint TEXT NOT NULL, error_code TEXT, retry_after_at TIMESTAMP,
    first_observed_at TIMESTAMP NOT NULL DEFAULT NOW(), last_observed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    provenance TEXT NOT NULL, CONSTRAINT institutional_security_lookup_states_provider_cusip_unique UNIQUE (provider, cusip)
  );`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_iss_lookup_outcome
    ON institutional_security_lookup_states (outcome, last_observed_at);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_iss_lookup_retry
    ON institutional_security_lookup_states (retry_after_at);`);
  await db.execute(sql`CREATE TABLE IF NOT EXISTS institutional_security_candidate_observations (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, provider TEXT NOT NULL, cusip TEXT NOT NULL,
    figi TEXT, composite_figi TEXT, share_class_figi TEXT, ticker TEXT, name TEXT, exchange_code TEXT,
    market_sector TEXT, security_type TEXT, security_type2 TEXT, supported BOOLEAN NOT NULL DEFAULT FALSE,
    candidate_fingerprint TEXT NOT NULL, first_observed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_observed_at TIMESTAMP NOT NULL DEFAULT NOW(), is_current BOOLEAN NOT NULL DEFAULT TRUE,
    valid_from TIMESTAMP, valid_to TIMESTAMP, relationship TEXT,
    CONSTRAINT institutional_security_candidate_provider_cusip_fp_unique UNIQUE (provider, cusip, candidate_fingerprint)
  );`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_iss_candidate_current
    ON institutional_security_candidate_observations (provider, cusip, is_current);`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_iss_candidate_ticker
    ON institutional_security_candidate_observations (ticker);`);
  await db.execute(sql`
    ALTER TABLE symbols ADD COLUMN IF NOT EXISTS sub_industry TEXT;
  `);
  await db.execute(sql`ALTER TABLE institutional_security_lookup_states ADD COLUMN IF NOT EXISTS provider_outcome TEXT;`);
  await db.execute(sql`UPDATE institutional_security_lookup_states SET provider_outcome = outcome WHERE provider_outcome IS NULL;`);
  await db.execute(sql`ALTER TABLE institutional_security_lookup_states ALTER COLUMN provider_outcome SET NOT NULL;`);
  await db.execute(sql`
    ALTER TABLE symbols ADD COLUMN IF NOT EXISTS country TEXT;
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS security_themes (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      theme_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      classification_method TEXT NOT NULL DEFAULT 'curated',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_security_themes_active
      ON security_themes (active);
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS security_master_themes (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      security_master_id TEXT NOT NULL
        REFERENCES security_master(id) ON DELETE CASCADE,
      theme_id TEXT NOT NULL
        REFERENCES security_themes(theme_id) ON DELETE CASCADE,
      classification_method TEXT NOT NULL DEFAULT 'curated',
      source TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT security_master_themes_unique
        UNIQUE (security_master_id, theme_id)
    );
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_security_master_themes_security
      ON security_master_themes (security_master_id);
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_security_master_themes_theme
      ON security_master_themes (theme_id);
  `);
}