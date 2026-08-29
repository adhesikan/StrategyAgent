-- Institutional Analytics — security metadata and normalized theme membership.
-- Idempotent: safe to run multiple times.
--
-- symbols remains the existing canonical company/security metadata table.
-- security_master remains the CUSIP mapping/review store.
-- security_master_themes is a many-to-many enrichment relation; no duplicate
-- company/security records are created.

BEGIN;

ALTER TABLE symbols ADD COLUMN IF NOT EXISTS sub_industry TEXT;
ALTER TABLE symbols ADD COLUMN IF NOT EXISTS country TEXT;

CREATE TABLE IF NOT EXISTS security_themes (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  theme_id              TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  description           TEXT,
  classification_method TEXT NOT NULL DEFAULT 'curated',
  active                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_themes_active
  ON security_themes (active);

CREATE TABLE IF NOT EXISTS security_master_themes (
  id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  security_master_id    TEXT NOT NULL REFERENCES security_master(id) ON DELETE CASCADE,
  theme_id              TEXT NOT NULL REFERENCES security_themes(theme_id) ON DELETE CASCADE,
  classification_method TEXT NOT NULL DEFAULT 'curated',
  source                TEXT,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT security_master_themes_unique UNIQUE (security_master_id, theme_id)
);

CREATE INDEX IF NOT EXISTS idx_security_master_themes_security
  ON security_master_themes (security_master_id);
CREATE INDEX IF NOT EXISTS idx_security_master_themes_theme
  ON security_master_themes (theme_id);

COMMIT;