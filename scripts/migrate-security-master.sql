-- Institutional Intelligence — security_master migration
-- Idempotent: safe to run multiple times.
-- Creates the security_master table and upgrades any existing partial schema.
--
-- security_master is the canonical CUSIP → ticker reference store.
-- The mapping engine populates it; the review queue UI reads and writes to it.
-- Approved entries are synced back to institutional_security_mappings.
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/migrate-security-master.sql

BEGIN;

CREATE TABLE IF NOT EXISTS security_master (
  id              TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  cusip           TEXT         NOT NULL,
  ticker          TEXT,
  issuer_name     TEXT,
  exchange        TEXT,
  asset_type      TEXT,
  figi            TEXT,
  confidence      INTEGER      NOT NULL DEFAULT 0,
  mapping_method  TEXT         NOT NULL DEFAULT 'unmapped',
  review_status   TEXT         NOT NULL DEFAULT 'unmapped',
  first_seen      TIMESTAMP    NOT NULL DEFAULT NOW(),
  last_verified   TIMESTAMP    NOT NULL DEFAULT NOW(),
  notes           TEXT,
  holding_count   INTEGER      NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sm_cusip          ON security_master (cusip);
CREATE INDEX       IF NOT EXISTS idx_sm_ticker          ON security_master (ticker);
CREATE INDEX       IF NOT EXISTS idx_sm_review_status   ON security_master (review_status);
CREATE INDEX       IF NOT EXISTS idx_sm_confidence      ON security_master (confidence);
CREATE INDEX       IF NOT EXISTS idx_sm_holding_count   ON security_master (holding_count);

-- Upgrade path: add columns that may be missing from an earlier partial install
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='security_master' AND column_name='holding_count') THEN
    ALTER TABLE security_master ADD COLUMN holding_count INTEGER NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='security_master' AND column_name='exchange') THEN
    ALTER TABLE security_master ADD COLUMN exchange TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='security_master' AND column_name='asset_type') THEN
    ALTER TABLE security_master ADD COLUMN asset_type TEXT;
  END IF;
END $$;

COMMIT;
