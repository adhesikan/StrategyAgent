import { sql } from "drizzle-orm";
import { db } from "../../db";

/**
 * Runtime-safe counterpart to migrations/030_institutional_security_enrichment.sql.
 * Railway cannot reach PostgreSQL during build, so startup must ensure this
 * schema before repository reads or theme synchronization occur.
 */
export async function ensureInstitutionalSecurityEnrichmentSchema(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE symbols ADD COLUMN IF NOT EXISTS sub_industry TEXT;
  `);
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