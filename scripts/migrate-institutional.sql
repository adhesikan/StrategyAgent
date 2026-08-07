-- Institutional Intelligence MVP — Schema migration
-- Sprint 2.2.5
--
-- Run order: execute this entire file in one transaction against your
-- production Postgres database.  The script is idempotent (IF NOT EXISTS).
--
-- Tables:
--   1. institutional_13f_filings       — one row per accession
--   2. institutional_13f_holdings      — one row per InfoTable holding line
--   3. institutional_security_mappings — CUSIP→ticker
--   4. institutional_quarterly_aggregates — pre-computed per (symbol, period)
--   5. institutional_ingestion_runs    — ingestion run tracking
--
-- Advisory lock key used by ingestion: 774412003

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. institutional_13f_filings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS institutional_13f_filings (
  id                 SERIAL       PRIMARY KEY,
  cik                TEXT         NOT NULL,
  filer_name         TEXT         NOT NULL,
  accession_number   TEXT         NOT NULL,         -- e.g. "000136474224000007"
  form_type          TEXT         NOT NULL,         -- "13F-HR" or "13F-HR/A"
  period_of_report   DATE         NOT NULL,         -- e.g. 2024-03-31
  filed_date         DATE,
  amendment_flag     BOOLEAN      NOT NULL DEFAULT FALSE,
  is_effective       BOOLEAN      NOT NULL DEFAULT TRUE,
  holding_count      INTEGER      NOT NULL DEFAULT 0,
  skipped_row_count  INTEGER      NOT NULL DEFAULT 0,
  has_put_call_rows  BOOLEAN      NOT NULL DEFAULT FALSE,
  has_prn_rows       BOOLEAN      NOT NULL DEFAULT FALSE,
  ingested_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT institutional_13f_filings_accession_unique UNIQUE (accession_number)
);

CREATE INDEX IF NOT EXISTS idx_inst_filings_cik
  ON institutional_13f_filings (cik);

CREATE INDEX IF NOT EXISTS idx_inst_filings_period
  ON institutional_13f_filings (period_of_report);

CREATE INDEX IF NOT EXISTS idx_inst_filings_is_effective
  ON institutional_13f_filings (is_effective)
  WHERE is_effective = TRUE;

-- ---------------------------------------------------------------------------
-- 2. institutional_13f_holdings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS institutional_13f_holdings (
  id                   SERIAL        PRIMARY KEY,
  accession_number     TEXT          NOT NULL,
  filer_cik            TEXT          NOT NULL,
  filer_name           TEXT          NOT NULL,
  period_of_report     DATE          NOT NULL,
  filing_date          DATE,
  issuer_name          TEXT          NOT NULL,
  class_title          TEXT          NOT NULL,
  cusip                TEXT          NOT NULL,
  figi                 TEXT,
  reported_value       BIGINT,                      -- USD thousands (as reported)
  reported_shares      BIGINT,
  shares_prn_type      TEXT          NOT NULL DEFAULT 'SH',
  put_call             TEXT,                        -- 'Put', 'Call', or NULL
  investment_discretion TEXT         NOT NULL DEFAULT 'SOLE',
  voting_sole          BIGINT        NOT NULL DEFAULT 0,
  voting_shared        BIGINT        NOT NULL DEFAULT 0,
  voting_none          BIGINT        NOT NULL DEFAULT 0,
  mapping_status       TEXT          NOT NULL DEFAULT 'unmapped',
  mapped_ticker        TEXT,
  ingested_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT institutional_13f_holdings_unique
    UNIQUE (accession_number, cusip, class_title, put_call)
);

CREATE INDEX IF NOT EXISTS idx_inst_holdings_cusip
  ON institutional_13f_holdings (cusip);

CREATE INDEX IF NOT EXISTS idx_inst_holdings_period
  ON institutional_13f_holdings (period_of_report);

CREATE INDEX IF NOT EXISTS idx_inst_holdings_ticker
  ON institutional_13f_holdings (mapped_ticker)
  WHERE mapped_ticker IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inst_holdings_mapping
  ON institutional_13f_holdings (mapping_status);

-- ---------------------------------------------------------------------------
-- 3. institutional_security_mappings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS institutional_security_mappings (
  id              SERIAL       PRIMARY KEY,
  cusip           TEXT         NOT NULL,
  ticker          TEXT,
  issuer_name     TEXT         NOT NULL,
  status          TEXT         NOT NULL DEFAULT 'unmapped',
  -- status values: exact | reviewed | probable | ambiguous | unmapped | rejected
  source          TEXT,        -- 'sec_header' | 'manual' | 'external_api'
  confidence      REAL,        -- 0.0–1.0
  notes           TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT institutional_security_mappings_cusip_unique UNIQUE (cusip)
);

CREATE INDEX IF NOT EXISTS idx_inst_mappings_ticker
  ON institutional_security_mappings (ticker)
  WHERE ticker IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inst_mappings_status
  ON institutional_security_mappings (status);

-- ---------------------------------------------------------------------------
-- 4. institutional_quarterly_aggregates
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS institutional_quarterly_aggregates (
  id                           SERIAL        PRIMARY KEY,
  symbol                       TEXT          NOT NULL,
  period_of_report             DATE          NOT NULL,
  period_label                 TEXT          NOT NULL,  -- e.g. '2024-Q1'
  reporting_manager_count      INTEGER       NOT NULL DEFAULT 0,
  aggregate_reported_shares    BIGINT,
  aggregate_reported_value     BIGINT,
  prev_period_of_report        DATE,
  previous_quarter_shares      BIGINT,
  previous_quarter_value       BIGINT,
  reported_shares_change       BIGINT,
  reported_shares_change_pct   REAL,                   -- fractional; +0.05 = +5%
  new_position_count           INTEGER       NOT NULL DEFAULT 0,
  increased_position_count     INTEGER       NOT NULL DEFAULT 0,
  reduced_position_count       INTEGER       NOT NULL DEFAULT 0,
  exited_position_count        INTEGER       NOT NULL DEFAULT 0,
  unchanged_count              INTEGER       NOT NULL DEFAULT 0,
  top_holder_pct               REAL,
  top5_holder_pct              REAL,
  top10_holder_pct             REAL,
  concentration_classification TEXT,                   -- low | moderate | high | unavailable
  eligible_holding_count       INTEGER       NOT NULL DEFAULT 0,
  excluded_holding_count       INTEGER       NOT NULL DEFAULT 0,
  coverage_status              TEXT          NOT NULL DEFAULT 'insufficient',
  amendment_status             TEXT          NOT NULL DEFAULT 'clean',
  -- clean | amended | pending_amendments
  largest_holders_json         JSONB,                  -- serialized top-N holder list
  generated_at                 TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT institutional_quarterly_aggregates_unique
    UNIQUE (symbol, period_of_report)
);

CREATE INDEX IF NOT EXISTS idx_inst_agg_symbol
  ON institutional_quarterly_aggregates (symbol);

CREATE INDEX IF NOT EXISTS idx_inst_agg_period
  ON institutional_quarterly_aggregates (period_of_report DESC);

-- ---------------------------------------------------------------------------
-- 5. institutional_ingestion_runs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS institutional_ingestion_runs (
  id               SERIAL        PRIMARY KEY,
  quarter          TEXT          NOT NULL,            -- e.g. 'QTR2/2024'
  status           TEXT          NOT NULL DEFAULT 'pending',
  -- pending | running | completed | partial | failed | skipped_locked | skipped_disabled
  filing_count     INTEGER       NOT NULL DEFAULT 0,
  holding_count    INTEGER       NOT NULL DEFAULT 0,
  mapped_count     INTEGER       NOT NULL DEFAULT 0,
  skipped_count    INTEGER       NOT NULL DEFAULT 0,
  error_code       TEXT,
  error_message    TEXT,
  duration_ms      INTEGER,
  started_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,

  CONSTRAINT institutional_ingestion_runs_quarter_started_unique
    UNIQUE (quarter, started_at)
);

CREATE INDEX IF NOT EXISTS idx_inst_runs_status
  ON institutional_ingestion_runs (status);

CREATE INDEX IF NOT EXISTS idx_inst_runs_quarter
  ON institutional_ingestion_runs (quarter);

COMMIT;

-- ---------------------------------------------------------------------------
-- Advisory lock key reference (informational comment — not executable SQL)
-- ---------------------------------------------------------------------------
-- Opportunity engine lock: 774412002  (pg_try_advisory_lock)
-- Institutional ingestion: 774412003  (pg_try_advisory_lock)
