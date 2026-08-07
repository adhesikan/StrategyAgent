-- Institutional Intelligence — Comprehensive Schema Migration
-- Exact match to shared/schema.ts institutional table definitions.
-- Idempotent: safe to run multiple times on any existing database state.
--
-- Handles three installation states:
--   A) Fresh database → CREATE TABLE with full schema
--   B) Old v1 migration (SERIAL ids, wrong column names) → drop+recreate if empty
--   C) Partially-migrated database → ADD COLUMN IF NOT EXISTS for any gaps
--
-- Tables:
--   1. institutional_13f_filings
--   2. institutional_13f_holdings
--   3. institutional_security_mappings
--   4. institutional_quarterly_aggregates
--   5. institutional_ingestion_runs
--
-- Advisory lock key: 774412003
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/migrate-institutional.sql

BEGIN;

-- ---------------------------------------------------------------------------
-- Helper: detect old-v1 schema by checking for integer/serial id column type
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  tbl   TEXT;
  id_dt TEXT;
  cnt   BIGINT;
BEGIN
  -- For each institutional table, if id column is integer/bigint (old SERIAL),
  -- drop and recreate only if the table is empty (no production data at risk).
  FOREACH tbl IN ARRAY ARRAY[
    'institutional_13f_filings',
    'institutional_13f_holdings',
    'institutional_security_mappings',
    'institutional_quarterly_aggregates',
    'institutional_ingestion_runs'
  ] LOOP
    SELECT data_type INTO id_dt
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = tbl
       AND column_name = 'id';

    IF id_dt IN ('integer', 'bigint') THEN
      EXECUTE format('SELECT COUNT(*) FROM %I', tbl) INTO cnt;
      IF cnt > 0 THEN
        RAISE EXCEPTION
          'Table % has % rows with old SERIAL schema and cannot be auto-migrated. '
          'Clear the table manually or contact engineering.', tbl, cnt;
      END IF;
      EXECUTE format('DROP TABLE %I CASCADE', tbl);
      RAISE NOTICE 'Dropped old SERIAL-id table: %', tbl;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 1. institutional_13f_filings
-- Exact match to institutionalFilings in shared/schema.ts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS institutional_13f_filings (
  id                TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  accession_number  TEXT         NOT NULL,
  filer_cik         TEXT         NOT NULL,
  filer_name        TEXT         NOT NULL,
  filing_type       TEXT         NOT NULL,       -- "13F-HR" | "13F-HR/A"
  filing_date       DATE         NOT NULL,
  accepted_at       TIMESTAMP,
  period_of_report  DATE         NOT NULL,
  amendment_flag    BOOLEAN      NOT NULL DEFAULT FALSE,
  amendment_number  INTEGER,
  amendment_type    TEXT,                        -- "RESTATEMENT" | "NEW_AMENDMENT" | null
  is_effective      BOOLEAN      NOT NULL DEFAULT TRUE,
  source_url        TEXT,
  ingested_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
  source_checksum   TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_13f_filings_accession
  ON institutional_13f_filings (accession_number);

CREATE INDEX IF NOT EXISTS idx_13f_filings_cik_period
  ON institutional_13f_filings (filer_cik, period_of_report);

CREATE INDEX IF NOT EXISTS idx_13f_filings_period_date
  ON institutional_13f_filings (period_of_report, filing_date);

CREATE INDEX IF NOT EXISTS idx_13f_filings_filing_date
  ON institutional_13f_filings (filing_date);

CREATE INDEX IF NOT EXISTS idx_13f_filings_effective
  ON institutional_13f_filings (is_effective, period_of_report);

-- ---------------------------------------------------------------------------
-- 2. institutional_13f_holdings
-- Exact match to institutional13fHoldings in shared/schema.ts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS institutional_13f_holdings (
  id                    TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  accession_number      TEXT         NOT NULL,
  filer_cik             TEXT         NOT NULL,
  filer_name            TEXT         NOT NULL,
  issuer_name           TEXT         NOT NULL,
  class_title           TEXT         NOT NULL,
  cusip                 TEXT         NOT NULL,
  figi                  TEXT,
  reported_value        BIGINT,                 -- USD thousands
  reported_shares       BIGINT,
  shares_prn_type       TEXT,                   -- "SH" | "PRN"
  put_call              TEXT,                   -- "Put" | "Call" | null
  investment_discretion TEXT,                   -- "SOLE" | "SHARED" | "OTHER"
  other_manager         TEXT,
  voting_sole           BIGINT,
  voting_shared         BIGINT,
  voting_none           BIGINT,
  period_of_report      DATE         NOT NULL,
  filing_date           DATE         NOT NULL,
  mapped_symbol         TEXT,                   -- internal VCP Trader symbol
  mapping_status        TEXT         NOT NULL DEFAULT 'unmapped',
  ingested_at           TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_13f_holdings_unique
  ON institutional_13f_holdings (accession_number, cusip, class_title, put_call);

CREATE INDEX IF NOT EXISTS idx_13f_holdings_cusip_period
  ON institutional_13f_holdings (cusip, period_of_report);

CREATE INDEX IF NOT EXISTS idx_13f_holdings_symbol_period
  ON institutional_13f_holdings (mapped_symbol, period_of_report);

CREATE INDEX IF NOT EXISTS idx_13f_holdings_filer_period
  ON institutional_13f_holdings (filer_cik, period_of_report);

CREATE INDEX IF NOT EXISTS idx_13f_holdings_filing_date
  ON institutional_13f_holdings (filing_date);

CREATE INDEX IF NOT EXISTS idx_13f_holdings_mapping
  ON institutional_13f_holdings (mapping_status, period_of_report);

-- ---------------------------------------------------------------------------
-- 3. institutional_security_mappings
-- Exact match to institutionalSecurityMappings in shared/schema.ts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS institutional_security_mappings (
  id              TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  cusip           TEXT         NOT NULL,
  figi            TEXT,
  issuer_name     TEXT,
  class_title     TEXT,
  mapped_symbol   TEXT,                        -- VCP Trader internal symbol
  mapping_status  TEXT         NOT NULL,       -- exact|reviewed|probable|ambiguous|unmapped|rejected
  mapping_method  TEXT         NOT NULL,       -- cusip_exact|figi_exact|reviewed|name_match|manual
  created_at      TIMESTAMP    NOT NULL DEFAULT NOW(),
  last_verified_at TIMESTAMP   NOT NULL DEFAULT NOW(),
  notes           TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sec_mappings_cusip
  ON institutional_security_mappings (cusip);

CREATE INDEX IF NOT EXISTS idx_sec_mappings_symbol
  ON institutional_security_mappings (mapped_symbol);

CREATE INDEX IF NOT EXISTS idx_sec_mappings_status
  ON institutional_security_mappings (mapping_status);

-- ---------------------------------------------------------------------------
-- 4. institutional_quarterly_aggregates
-- Exact match to institutionalQuarterlyAggregates in shared/schema.ts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS institutional_quarterly_aggregates (
  id                           TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  symbol                       TEXT         NOT NULL,
  period_of_report             DATE         NOT NULL,
  period_label                 TEXT         NOT NULL,
  reporting_manager_count      INTEGER      NOT NULL DEFAULT 0,
  aggregate_reported_shares    BIGINT,
  aggregate_reported_value     BIGINT,
  prev_period_of_report        DATE,
  previous_quarter_shares      BIGINT,
  previous_quarter_value       BIGINT,
  reported_shares_change       BIGINT,
  reported_shares_change_percent REAL,
  new_position_count           INTEGER      NOT NULL DEFAULT 0,
  increased_position_count     INTEGER      NOT NULL DEFAULT 0,
  reduced_position_count       INTEGER      NOT NULL DEFAULT 0,
  exited_position_count        INTEGER      NOT NULL DEFAULT 0,
  unchanged_count              INTEGER      NOT NULL DEFAULT 0,
  top_holder_percent           REAL,
  top5_holder_percent          REAL,
  top10_holder_percent         REAL,
  concentration_classification TEXT,
  trend                        TEXT         NOT NULL DEFAULT 'unavailable',
  largest_holders              JSONB        NOT NULL DEFAULT '[]',
  eligible_holding_count       INTEGER      NOT NULL DEFAULT 0,
  excluded_holding_count       INTEGER      NOT NULL DEFAULT 0,
  coverage_status              TEXT         NOT NULL DEFAULT 'insufficient',
  amendment_status             TEXT         NOT NULL DEFAULT 'clean',
  generated_at                 TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_iqa_symbol_period
  ON institutional_quarterly_aggregates (symbol, period_of_report);

CREATE INDEX IF NOT EXISTS idx_iqa_period
  ON institutional_quarterly_aggregates (period_of_report);

CREATE INDEX IF NOT EXISTS idx_iqa_symbol
  ON institutional_quarterly_aggregates (symbol);

CREATE INDEX IF NOT EXISTS idx_iqa_generated
  ON institutional_quarterly_aggregates (generated_at);

-- ---------------------------------------------------------------------------
-- 5. institutional_ingestion_runs
-- Exact match to institutionalIngestionRuns in shared/schema.ts
-- Includes Sprint 2.2.5 checkpoint columns.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS institutional_ingestion_runs (
  id                   TEXT         PRIMARY KEY DEFAULT gen_random_uuid()::text,
  quarter              TEXT         NOT NULL,
  period_of_report     DATE         NOT NULL,
  status               TEXT         NOT NULL DEFAULT 'pending',
  filing_count         INTEGER      NOT NULL DEFAULT 0,
  holding_count        INTEGER      NOT NULL DEFAULT 0,
  mapped_count         INTEGER      NOT NULL DEFAULT 0,
  unmapped_count       INTEGER      NOT NULL DEFAULT 0,
  error_code           TEXT,
  error_summary        TEXT,
  started_at           TIMESTAMP    NOT NULL DEFAULT NOW(),
  completed_at         TIMESTAMP,
  duration_ms          INTEGER,
  initiated_by         TEXT         NOT NULL DEFAULT 'scheduler',
  -- Sprint 2.2.5 checkpoint fields
  total_accessions     INTEGER,
  processed_accessions INTEGER,
  last_heartbeat_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_iir_quarter_status
  ON institutional_ingestion_runs (quarter, status);

CREATE INDEX IF NOT EXISTS idx_iir_status
  ON institutional_ingestion_runs (status);

CREATE INDEX IF NOT EXISTS idx_iir_started
  ON institutional_ingestion_runs (started_at);

CREATE INDEX IF NOT EXISTS idx_iir_period
  ON institutional_ingestion_runs (period_of_report);

CREATE INDEX IF NOT EXISTS idx_iir_heartbeat
  ON institutional_ingestion_runs (last_heartbeat_at)
  WHERE status = 'running';

-- ---------------------------------------------------------------------------
-- Upgrade path: add any columns missing from existing correct-schema tables
-- (for databases that were created with an intermediate correct schema but
-- are missing Sprint 2.2.5 checkpoint columns or other additions)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  -- institutional_ingestion_runs: Sprint 2.2.5 checkpoint columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='institutional_ingestion_runs' AND column_name='total_accessions') THEN
    ALTER TABLE institutional_ingestion_runs ADD COLUMN total_accessions INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='institutional_ingestion_runs' AND column_name='processed_accessions') THEN
    ALTER TABLE institutional_ingestion_runs ADD COLUMN processed_accessions INTEGER;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='institutional_ingestion_runs' AND column_name='last_heartbeat_at') THEN
    ALTER TABLE institutional_ingestion_runs ADD COLUMN last_heartbeat_at TIMESTAMPTZ;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='institutional_ingestion_runs' AND column_name='unmapped_count') THEN
    ALTER TABLE institutional_ingestion_runs ADD COLUMN unmapped_count INTEGER NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='institutional_ingestion_runs' AND column_name='error_summary') THEN
    ALTER TABLE institutional_ingestion_runs ADD COLUMN error_summary TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='institutional_ingestion_runs' AND column_name='initiated_by') THEN
    ALTER TABLE institutional_ingestion_runs ADD COLUMN initiated_by TEXT NOT NULL DEFAULT 'scheduler';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='institutional_ingestion_runs' AND column_name='period_of_report') THEN
    ALTER TABLE institutional_ingestion_runs ADD COLUMN period_of_report DATE NOT NULL DEFAULT '1970-01-01';
  END IF;

  -- institutional_quarterly_aggregates: add any new aggregate columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='institutional_quarterly_aggregates' AND column_name='period_label') THEN
    ALTER TABLE institutional_quarterly_aggregates ADD COLUMN period_label TEXT NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='institutional_quarterly_aggregates' AND column_name='amendment_status') THEN
    ALTER TABLE institutional_quarterly_aggregates ADD COLUMN amendment_status TEXT NOT NULL DEFAULT 'clean';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='institutional_quarterly_aggregates' AND column_name='coverage_status') THEN
    ALTER TABLE institutional_quarterly_aggregates ADD COLUMN coverage_status TEXT NOT NULL DEFAULT 'insufficient';
  END IF;
END $$;

COMMIT;

-- ---------------------------------------------------------------------------
-- Advisory lock key reference
-- ---------------------------------------------------------------------------
-- Opportunity engine lock:  774412002  (pg_try_advisory_lock)
-- Institutional ingestion:  774412003  (pg_try_advisory_lock)
